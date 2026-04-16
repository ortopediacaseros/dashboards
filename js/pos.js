import { supabase, buscarPorEAN, buscarPorTexto, registrarVenta, getCajaHoy, formatMoney, showToast } from './supabase.js';
import { Scanner } from './scanner.js';
import { checkAuth } from './auth.js';

let carrito = [];
let scanner = null;
let cajaId = null;

// ── DOM refs ──
const videoEl = document.getElementById('scanner-video');
const scannerSection = document.getElementById('scanner-section');
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const carritoList = document.getElementById('carrito-list');
const totalEl = document.getElementById('total-display');
const descuentoInput = document.getElementById('descuento-input');
const btnConfirmar = document.getElementById('btn-confirmar');
const medioPagoEl = document.getElementById('medio-pago');
const obsEl = document.getElementById('observaciones');
const modalNuevo = document.getElementById('modal-nuevo');
const formNuevo = document.getElementById('form-nuevo-producto');

// ── Init ──
async function init() {
  const session = await checkAuth();
  if (!session) return;

  const { data: caja } = await getCajaHoy();
  if (caja && caja.estado === 'abierta') {
    cajaId = caja.id;
  }
  renderCarrito();
}

// ── Scanner ──
document.getElementById('btn-escanear').addEventListener('click', async () => {
  if (scanner && scanner.active) {
    await scanner.stop();
    scannerSection.classList.add('hidden');
    document.getElementById('btn-escanear').textContent = '📷 Escanear código';
    return;
  }
  scannerSection.classList.remove('hidden');
  document.getElementById('btn-escanear').textContent = '⏹ Detener cámara';
  scanner = new Scanner('scanner-video', onCodigoEscaneado);
  try {
    await scanner.start();
  } catch (err) {
    showToast('Error al acceder a la cámara: ' + (err?.message || String(err)), 'error');
    scannerSection.classList.add('hidden');
    document.getElementById('btn-escanear').textContent = '📷 Escanear código';
  }
});

async function onCodigoEscaneado(codigo) {
  await scanner.stop();
  scannerSection.classList.add('hidden');
  document.getElementById('btn-escanear').textContent = '📷 Escanear código';
  await procesarCodigo(codigo);
}

async function procesarCodigo(ean) {
  const { data, error } = await buscarPorEAN(ean);
  if (data) {
    agregarAlCarrito(data);
  } else {
    abrirModalNuevo(ean);
  }
}

// ── Búsqueda manual ──
document.getElementById('btn-buscar').addEventListener('click', () => {
  const section = document.getElementById('search-section');
  section.classList.toggle('hidden');
  if (!section.classList.contains('hidden')) searchInput.focus();
});

let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (!q) { searchResults.innerHTML = ''; return; }
  searchTimer = setTimeout(() => buscar(q), 300);
});

async function buscar(q) {
  const { data } = await buscarPorTexto(q);
  searchResults.innerHTML = '';
  if (!data || data.length === 0) {
    searchResults.innerHTML = `
      <div class="search-no-result">
        No encontrado.
        <button class="btn btn-secondary" onclick="window.abrirModalNuevo('')" style="margin-left:8px;padding:4px 10px;font-size:12px">+ Crear producto</button>
      </div>`;
    return;
  }
  data.forEach(p => {
    const item = document.createElement('div');
    item.className = 'search-item';
    item.innerHTML = `
      <div>
        <div class="search-item-name">${p.nombre}</div>
        <div class="search-item-meta">${p.sku} · Stock: ${p.stock_actual}</div>
      </div>
      <div class="search-item-price">${formatMoney(p.precio_venta)}</div>`;
    item.addEventListener('click', () => {
      agregarAlCarrito(p);
      searchInput.value = '';
      searchResults.innerHTML = '';
      document.getElementById('search-section').classList.add('hidden');
    });
    searchResults.appendChild(item);
  });
}

// ── Carrito ──
function agregarAlCarrito(producto) {
  const existente = carrito.find(i => i.producto_id === producto.id);
  if (existente) {
    existente.cantidad++;
    existente.subtotal = existente.cantidad * existente.precio_unitario;
  } else {
    carrito.push({
      producto_id: producto.id,
      nombre: producto.nombre,
      cantidad: 1,
      precio_unitario: Number(producto.precio_venta),
      subtotal: Number(producto.precio_venta)
    });
  }
  renderCarrito();
  showToast(`${producto.nombre} agregado`, 'success', 1500);
}

function renderCarrito() {
  if (carrito.length === 0) {
    carritoList.innerHTML = `<div class="empty-state"><div class="icon">🛒</div><p>El carrito está vacío</p></div>`;
    btnConfirmar.disabled = true;
    totalEl.textContent = '$0';
    return;
  }

  carritoList.innerHTML = carrito.map((item, idx) => `
    <div class="carrito-item">
      <div class="carrito-nombre">${item.nombre}</div>
      <div class="carrito-controls">
        <button class="qty-btn" onclick="window.cambiarCantidad(${idx}, -1)">−</button>
        <span class="qty-val">${item.cantidad}</span>
        <button class="qty-btn" onclick="window.cambiarCantidad(${idx}, 1)">+</button>
      </div>
      <div class="carrito-precio">${formatMoney(item.precio_unitario)}</div>
      <div class="carrito-subtotal">${formatMoney(item.subtotal)}</div>
      <button class="carrito-remove" onclick="window.eliminarItem(${idx})">✕</button>
    </div>
  `).join('');

  btnConfirmar.disabled = false;
  actualizarTotal();
}

function actualizarTotal() {
  const subtotal = carrito.reduce((s, i) => s + i.subtotal, 0);
  const desc = parseFloat(descuentoInput.value) || 0;
  const total = subtotal * (1 - desc / 100);
  totalEl.textContent = formatMoney(total);
  btnConfirmar.textContent = `Confirmar venta — ${formatMoney(total)}`;
}

window.cambiarCantidad = (idx, delta) => {
  carrito[idx].cantidad = Math.max(1, carrito[idx].cantidad + delta);
  carrito[idx].subtotal = carrito[idx].cantidad * carrito[idx].precio_unitario;
  renderCarrito();
};

window.eliminarItem = (idx) => {
  carrito.splice(idx, 1);
  renderCarrito();
};

descuentoInput.addEventListener('input', actualizarTotal);

// ── Confirmar venta ──
btnConfirmar.addEventListener('click', async () => {
  const subtotal = carrito.reduce((s, i) => s + i.subtotal, 0);
  const desc = parseFloat(descuentoInput.value) || 0;
  const total = subtotal * (1 - desc / 100);
  const medio_pago = medioPagoEl.value;
  const observaciones = obsEl.value.trim();

  btnConfirmar.disabled = true;
  btnConfirmar.textContent = 'Procesando...';

  const venta = {
    total: Math.round(total * 100) / 100,
    medio_pago,
    descuento_pct: desc,
    observaciones: observaciones || null,
    caja_id: cajaId || null
  };

  const items = carrito.map(i => ({
    producto_id: i.producto_id,
    cantidad: i.cantidad,
    precio_unitario: i.precio_unitario,
    subtotal: i.subtotal
  }));

  const { data, error } = await registrarVenta(venta, items);

  if (error) {
    showToast('Error al registrar venta: ' + error.message, 'error');
    btnConfirmar.disabled = false;
    actualizarTotal();
    return;
  }

  // Success — mostrar modal con ticket comprobante
  const carritoSnapshot = [...carrito];
  const medioSnapshot   = medio_pago;
  carrito = [];
  descuentoInput.value = '';
  obsEl.value = '';
  medioPagoEl.value = 'efectivo';
  renderCarrito();
  abrirModalWA(data.numero_ticket, carritoSnapshot, total, desc, medioSnapshot);
});

// ── Modal nuevo producto ──
window.abrirModalNuevo = (ean) => {
  document.getElementById('nuevo-ean').value = ean || '';
  modalNuevo.classList.remove('hidden');
};

document.getElementById('btn-cerrar-modal').addEventListener('click', () => {
  modalNuevo.classList.add('hidden');
});

modalNuevo.addEventListener('click', (e) => {
  if (e.target === modalNuevo) modalNuevo.classList.add('hidden');
});

formNuevo.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(formNuevo);
  const ean = fd.get('ean').trim() || null;

  // Generar SKU si no hay EAN
  const sku = ean ? `EAN-${ean}` : `SKU-${Date.now()}`;

  const producto = {
    ean,
    sku,
    nombre: fd.get('nombre'),
    categoria: fd.get('categoria'),
    precio_venta: parseFloat(fd.get('precio_venta')),
    precio_costo: parseFloat(fd.get('precio_costo')),
    stock_actual: parseInt(fd.get('stock_inicial')) || 0,
    stock_minimo: parseInt(fd.get('stock_minimo')) || 5
  };

  const submitBtn = formNuevo.querySelector('[type=submit]');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Guardando...';

  const { data, error } = await supabase.from('productos').insert(producto).select().single();

  submitBtn.disabled = false;
  submitBtn.textContent = 'Guardar y agregar al carrito';

  if (error) {
    showToast('Error: ' + (error.message || 'No se pudo guardar'), 'error');
    return;
  }

  modalNuevo.classList.add('hidden');
  formNuevo.reset();
  agregarAlCarrito(data);
});

init();

// ══════════════════════════════════════════════════════════
// TICKETS RECIENTES + EDICIÓN
// ══════════════════════════════════════════════════════════

let ticketEditando = null;   // { venta, items[] }
let editItems = [];          // items en el modal

async function cargarVentasRecientes() {
  const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('ventas')
    .select('id, numero_ticket, fecha, total, medio_pago, descuento_pct, observaciones')
    .gte('fecha', ayer + 'T00:00:00')
    .order('fecha', { ascending: false })
    .limit(15);

  const el = document.getElementById('ventas-recientes-list');
  if (error || !data || data.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:16px"><div class="icon">🧾</div>Sin tickets hoy</div>';
    return;
  }

  const pagoLabel = { efectivo: '💵', debito: '💳', credito: '🟣', transferencia: '📲' };

  el.innerHTML = data.map(v => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border);font-size:13px">
      <div>
        <span style="font-weight:600">#${v.numero_ticket}</span>
        <span style="color:var(--text-dim);margin-left:8px;font-size:11px">
          ${new Date(v.fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <span style="margin-left:8px">${pagoLabel[v.medio_pago] || ''}</span>
      </div>
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-family:'Syne',sans-serif;font-weight:700">${formatMoney(v.total)}</span>
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px"
          onclick="window.abrirEditTicket('${v.id}')">✏️ Editar</button>
      </div>
    </div>`).join('');
}

window.abrirEditTicket = async (ventaId) => {
  const { data: venta } = await supabase
    .from('ventas').select('*').eq('id', ventaId).single();
  const { data: items } = await supabase
    .from('items_venta')
    .select('*, productos(nombre, precio_venta)')
    .eq('venta_id', ventaId);

  if (!venta || !items) { showToast('No se pudo cargar el ticket', 'error'); return; }

  ticketEditando = venta;
  editItems = items.map(i => ({
    id: i.id,
    producto_id: i.producto_id,
    nombre: i.productos?.nombre || 'Producto',
    cantidad: i.cantidad,
    precio_unitario: Number(i.precio_unitario),
    subtotal: Number(i.subtotal),
  }));

  document.getElementById('edit-ticket-titulo').textContent = `Editar ticket #${venta.numero_ticket}`;
  document.getElementById('edit-medio-pago').value = venta.medio_pago;
  document.getElementById('edit-descuento').value = venta.descuento_pct || 0;
  document.getElementById('edit-observaciones').value = venta.observaciones || '';
  document.getElementById('edit-fecha').value = venta.fecha ? venta.fecha.split('T')[0] : new Date().toISOString().split('T')[0];

  renderEditItems();
  document.getElementById('modal-editar-ticket').classList.remove('hidden');
};

function renderEditItems() {
  const el = document.getElementById('edit-items-list');
  if (editItems.length === 0) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Sin ítems</div>';
    actualizarTotalEdit();
    return;
  }
  el.innerHTML = editItems.map((item, idx) => `
    <div style="display:grid;grid-template-columns:1fr auto auto auto auto;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border);font-size:13px">
      <span style="font-weight:500">${item.nombre}</span>
      <button class="qty-btn" onclick="window.editCantidad(${idx},-1)">−</button>
      <span class="qty-val">${item.cantidad}</span>
      <button class="qty-btn" onclick="window.editCantidad(${idx},1)">+</button>
      <span style="font-family:'Syne',sans-serif;font-weight:700;min-width:70px;text-align:right">${formatMoney(item.subtotal)}</span>
      <button class="carrito-remove" onclick="window.editRemover(${idx})" style="grid-column:unset">✕</button>
    </div>`).join('');
  actualizarTotalEdit();
}

function actualizarTotalEdit() {
  const subtotal = editItems.reduce((s, i) => s + i.subtotal, 0);
  const desc = parseFloat(document.getElementById('edit-descuento').value) || 0;
  const total = subtotal * (1 - desc / 100);
  document.getElementById('edit-total-display').textContent = formatMoney(total);
}

window.editCantidad = (idx, delta) => {
  editItems[idx].cantidad = Math.max(1, editItems[idx].cantidad + delta);
  editItems[idx].subtotal = editItems[idx].cantidad * editItems[idx].precio_unitario;
  renderEditItems();
};

window.editRemover = (idx) => {
  editItems.splice(idx, 1);
  renderEditItems();
};

document.getElementById('edit-descuento').addEventListener('input', actualizarTotalEdit);

// Buscar producto para agregar al ticket
let editSearchTimer;
document.getElementById('edit-buscar-producto').addEventListener('input', e => {
  clearTimeout(editSearchTimer);
  const q = e.target.value.trim();
  const resultsEl = document.getElementById('edit-search-results');
  if (!q) { resultsEl.style.display = 'none'; return; }
  editSearchTimer = setTimeout(async () => {
    const { data } = await supabase.from('productos').select('id,nombre,precio_venta')
      .eq('activo', true).or(`nombre.ilike.%${q}%,sku.ilike.%${q}%`).limit(6);
    if (!data || !data.length) { resultsEl.style.display = 'none'; return; }
    resultsEl.style.display = '';
    resultsEl.innerHTML = data.map(p => `
      <div class="search-item" onclick="window.editAgregarProducto('${p.id}','${p.nombre.replace(/'/g,"\\'")}',${p.precio_venta})">
        <span>${p.nombre}</span>
        <span style="color:var(--teal);font-weight:600">${formatMoney(p.precio_venta)}</span>
      </div>`).join('');
  }, 250);
});

window.editAgregarProducto = (id, nombre, precio) => {
  const existente = editItems.find(i => i.producto_id === id);
  if (existente) { existente.cantidad++; existente.subtotal = existente.cantidad * existente.precio_unitario; }
  else editItems.push({ producto_id: id, nombre, cantidad: 1, precio_unitario: Number(precio), subtotal: Number(precio) });
  document.getElementById('edit-buscar-producto').value = '';
  document.getElementById('edit-search-results').style.display = 'none';
  renderEditItems();
};

document.getElementById('btn-cerrar-edit-ticket').addEventListener('click', () => {
  document.getElementById('modal-editar-ticket').classList.add('hidden');
});
document.getElementById('modal-editar-ticket').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-editar-ticket'))
    document.getElementById('modal-editar-ticket').classList.add('hidden');
});

// Guardar cambios en el ticket
document.getElementById('btn-guardar-edit-ticket').addEventListener('click', async () => {
  if (!ticketEditando) return;
  if (editItems.length === 0) { showToast('El ticket no puede quedar sin ítems', 'warning'); return; }

  const btn = document.getElementById('btn-guardar-edit-ticket');
  btn.disabled = true; btn.textContent = 'Guardando...';

  const desc = parseFloat(document.getElementById('edit-descuento').value) || 0;
  const subtotal = editItems.reduce((s, i) => s + i.subtotal, 0);
  const total = Math.round(subtotal * (1 - desc / 100) * 100) / 100;
  const medio_pago = document.getElementById('edit-medio-pago').value;
  const observaciones = document.getElementById('edit-observaciones').value.trim() || null;

  // 1. Restaurar stock de items originales
  const { data: itemsOriginales } = await supabase
    .from('items_venta').select('producto_id, cantidad').eq('venta_id', ticketEditando.id);
  for (const item of (itemsOriginales || [])) {
    await supabase.from('productos')
      .update({ stock_actual: supabase.rpc ? undefined : undefined })
      .eq('id', item.producto_id);
    await supabase.rpc('descontar_stock', { p_producto_id: item.producto_id, p_cantidad: -item.cantidad });
  }

  // 2. Borrar items originales
  await supabase.from('items_venta').delete().eq('venta_id', ticketEditando.id);

  // 3. Insertar nuevos items
  const nuevosItems = editItems.map(i => ({
    venta_id: ticketEditando.id,
    producto_id: i.producto_id,
    cantidad: i.cantidad,
    precio_unitario: i.precio_unitario,
    subtotal: i.subtotal,
  }));
  await supabase.from('items_venta').insert(nuevosItems);

  // 4. Descontar stock nuevo
  for (const item of editItems) {
    await supabase.rpc('descontar_stock', { p_producto_id: item.producto_id, p_cantidad: item.cantidad });
  }

  // 5. Actualizar cabecera
  const fechaSeleccionada = document.getElementById('edit-fecha').value;
  const fechaISO = fechaSeleccionada ? new Date(fechaSeleccionada + 'T12:00:00').toISOString() : ticketEditando.fecha;
  const { error } = await supabase.from('ventas').update({ total, medio_pago, observaciones, descuento_pct: desc, fecha: fechaISO })
    .eq('id', ticketEditando.id);

  btn.disabled = false; btn.textContent = '💾 Guardar cambios';

  if (error) { showToast('Error al guardar: ' + error.message, 'error'); return; }
  showToast(`Ticket #${ticketEditando.numero_ticket} actualizado`, 'success');
  document.getElementById('modal-editar-ticket').classList.add('hidden');
  cargarVentasRecientes();
});

// Anular ticket
document.getElementById('btn-cancelar-ticket').addEventListener('click', async () => {
  if (!ticketEditando) return;
  if (!confirm(`¿Anular el ticket #${ticketEditando.numero_ticket}? Se restaurará el stock.`)) return;

  // Restaurar stock
  const { data: itemsOriginales } = await supabase
    .from('items_venta').select('producto_id, cantidad').eq('venta_id', ticketEditando.id);
  for (const item of (itemsOriginales || [])) {
    await supabase.rpc('descontar_stock', { p_producto_id: item.producto_id, p_cantidad: -item.cantidad });
  }

  await supabase.from('items_venta').delete().eq('venta_id', ticketEditando.id);
  await supabase.from('ventas').delete().eq('id', ticketEditando.id);

  showToast(`Ticket #${ticketEditando.numero_ticket} anulado`, 'success');
  document.getElementById('modal-editar-ticket').classList.add('hidden');
  cargarVentasRecientes();
});

// Borrar ticket sin restaurar stock
document.getElementById('btn-eliminar-ticket').addEventListener('click', async () => {
  if (!ticketEditando) return;
  if (!confirm(`¿Borrar el ticket #${ticketEditando.numero_ticket}? No se restaurará el stock.`)) return;

  await supabase.from('items_venta').delete().eq('venta_id', ticketEditando.id);
  const { error } = await supabase.from('ventas').delete().eq('id', ticketEditando.id);

  if (error) { showToast('Error al borrar: ' + error.message, 'error'); return; }
  showToast(`Ticket #${ticketEditando.numero_ticket} eliminado`, 'success');
  document.getElementById('modal-editar-ticket').classList.add('hidden');
  cargarVentasRecientes();
});

document.getElementById('btn-refrescar-recientes').addEventListener('click', cargarVentasRecientes);

// ── Ticket comprobante ────────────────────────────────────────────────────────

const NEGOCIO = {
  nombre:    'ORTOPEDIA CASEROS',
  domicilio: 'Valentín Gómez 4784 — Caseros',
  telefono:  '+54 11 3578-9985',
};

const SUPABASE_URL = 'https://bxcnsykkzwzrbevzquee.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4Y25zeWtrend6cmJldnpxdWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzMyODAsImV4cCI6MjA5MDQ0OTI4MH0.oZzblqWjjLWDqJ_CAWxXUqzsdtFMcrNFwdQ4aMCpHdE';

const PAGO_LABEL = { efectivo: 'Efectivo', debito: 'Tarjeta débito', credito: 'Tarjeta crédito', transferencia: 'Transferencia' };

// Dibuja el ticket en un canvas y lo devuelve
function dibujarTicket(canvas, numeroTicket, items, total, descPct, medioPago) {
  const W = 420;
  const FONT = 'IBM Plex Mono, Courier New, monospace';

  // Calcular altura
  const itemsH = items.length * 46;
  const H = 320 + itemsH;
  canvas.width  = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');

  // Fondo papel
  ctx.fillStyle = '#FFFEF8';
  ctx.fillRect(0, 0, W, H);

  // Borde suave
  ctx.strokeStyle = '#E8E0D0';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  // ── Header ──
  ctx.fillStyle = '#1A1A2E';
  ctx.fillRect(0, 0, W, 72);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 18px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillText(NEGOCIO.nombre, W / 2, 28);

  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillText(NEGOCIO.domicilio, W / 2, 46);
  ctx.fillText(`Tel: ${NEGOCIO.telefono}`, W / 2, 61);

  // ── Sub-header comprobante ──
  ctx.fillStyle = '#2D5016';
  ctx.fillRect(0, 72, W, 28);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `bold 11px ${FONT}`;
  ctx.fillText('COMPROBANTE DE VENTA  —  NO VÁLIDO COMO FACTURA', W / 2, 90);

  // ── Número y fecha ──
  const fecha = new Date();
  const fechaStr = fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const horaStr  = fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  ctx.textAlign = 'left';
  ctx.fillStyle = '#333';
  ctx.font = `bold 13px ${FONT}`;
  ctx.fillText(`N° ${String(numeroTicket).padStart(6, '0')}`, 20, 125);

  ctx.textAlign = 'right';
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = '#666';
  ctx.fillText(`${fechaStr}  ${horaStr}`, W - 20, 125);

  // ── Separador ──
  function linea(y) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = '#CCC';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(20, y);
    ctx.lineTo(W - 20, y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  linea(135);

  // ── Encabezado items ──
  ctx.textAlign = 'left';
  ctx.fillStyle = '#888';
  ctx.font = `10px ${FONT}`;
  ctx.fillText('DESCRIPCIÓN', 20, 152);
  ctx.textAlign = 'right';
  ctx.fillText('CANT.', W - 100, 152);
  ctx.fillText('IMPORTE', W - 20, 152);

  // ── Items ──
  let y = 165;
  for (const item of items) {
    const nombre = item.nombre.length > 30 ? item.nombre.slice(0, 28) + '…' : item.nombre;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1A1A1A';
    ctx.font = `12px ${FONT}`;
    ctx.fillText(nombre, 20, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#444';
    ctx.font = `11px ${FONT}`;
    ctx.fillText(`x${item.cantidad}`, W - 100, y);
    ctx.fillText(formatMoney(item.subtotal), W - 20, y);

    if (item.cantidad > 1) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#999';
      ctx.font = `10px ${FONT}`;
      ctx.fillText(`  (${formatMoney(item.precio_unitario)} c/u)`, 20, y + 14);
    }
    y += 46;
  }

  linea(y + 4);
  y += 18;

  // ── Subtotal / descuento / total ──
  const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
  if (descPct > 0) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#555';
    ctx.font = `11px ${FONT}`;
    ctx.fillText('Subtotal:', W - 110, y);
    ctx.fillText(formatMoney(subtotal), W - 20, y);
    y += 18;

    ctx.fillStyle = '#2D7A27';
    ctx.fillText(`Descuento ${descPct}%:`, W - 110, y);
    ctx.fillText(`- ${formatMoney(subtotal - total)}`, W - 20, y);
    y += 18;
    linea(y + 2);
    y += 14;
  }

  ctx.textAlign = 'right';
  ctx.fillStyle = '#1A1A2E';
  ctx.font = `bold 15px ${FONT}`;
  ctx.fillText('TOTAL:', W - 110, y);
  ctx.fillText(formatMoney(total), W - 20, y);
  y += 22;

  ctx.fillStyle = '#666';
  ctx.font = `11px ${FONT}`;
  ctx.fillText(`Medio de pago: ${PAGO_LABEL[medioPago] || medioPago}`, W - 20, y);
  y += 24;

  linea(y);
  y += 18;

  // ── Footer ──
  ctx.textAlign = 'center';
  ctx.fillStyle = '#999';
  ctx.font = `10px ${FONT}`;
  ctx.fillText('¡Gracias por su compra!', W / 2, y);
  ctx.fillText('ortopediacaseros.com', W / 2, y + 14);
}

// Acorta una URL via TinyURL
async function acortarUrl(url) {
  try {
    const res = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const short = (await res.text()).trim();
      if (short.startsWith('https://tinyurl.com/')) return short;
    }
  } catch { /* fallback a URL original */ }
  return url;
}

// Sube el canvas como PNG a Supabase Storage y devuelve la URL pública
async function subirTicket(canvas, numeroTicket) {
  const statusEl = document.getElementById('ticket-upload-status');
  statusEl.textContent = 'Subiendo comprobante…';

  return new Promise((resolve) => {
    canvas.toBlob(async (blob) => {
      const filename = `ticket-${String(numeroTicket).padStart(6,'0')}-${Date.now()}.png`;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token || SUPABASE_ANON;

      const res = await fetch(`${SUPABASE_URL}/storage/v1/object/tickets/${filename}`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_ANON,
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'image/png',
          'x-upsert': 'true',
        },
        body: blob,
      });

      if (res.ok) {
        const rawUrl = `${SUPABASE_URL}/storage/v1/object/public/tickets/${filename}`;
        const url = await acortarUrl(rawUrl);
        statusEl.textContent = '✅ Comprobante listo para compartir';
        resolve(url);
      } else {
        statusEl.textContent = 'Comprobante generado (sin subir)';
        resolve(null);
      }
    }, 'image/png');
  });
}

async function abrirModalWA(numeroTicket, items, total, descPct, medioPago) {
  const canvas = document.getElementById('ticket-canvas');
  dibujarTicket(canvas, numeroTicket, items, total, descPct, medioPago);

  // Resetear estado
  document.getElementById('wa-telefono').value = '';
  document.getElementById('btn-enviar-wa').href = '#';
  document.getElementById('ticket-upload-status').textContent = '';
  document.getElementById('modal-ticket').classList.remove('hidden');

  showToast(`¡Venta #${numeroTicket} registrada! ${formatMoney(total)}`, 'success', 3000);
  cargarVentasRecientes();

  // Subir en segundo plano
  const publicUrl = await subirTicket(canvas, numeroTicket);

  // Descargar
  document.getElementById('btn-descargar-ticket').onclick = () => {
    const a = document.createElement('a');
    a.download = `ticket-${String(numeroTicket).padStart(6,'0')}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  // WhatsApp: actualizar link al escribir número
  const telInput = document.getElementById('wa-telefono');
  const btnWA    = document.getElementById('btn-enviar-wa');

  function actualizarWA() {
    const tel = telInput.value.replace(/\D/g, '');
    if (!tel) { btnWA.href = '#'; return; }
    const num = tel.startsWith('54') ? tel : '54' + tel;
    const msg = publicUrl
      ? `🦴 *${NEGOCIO.nombre}*\nTe comparto tu comprobante de compra N° ${String(numeroTicket).padStart(6,'0')}:\n\n${publicUrl}\n\n*Total: ${formatMoney(total)}*\n¡Gracias por tu compra!`
      : `🦴 *${NEGOCIO.nombre}*\nComprobante N° ${String(numeroTicket).padStart(6,'0')} — *Total: ${formatMoney(total)}*\n¡Gracias por tu compra!`;
    btnWA.href = `https://wa.me/${num}?text=${encodeURIComponent(msg)}`;
  }

  telInput.removeEventListener('input', telInput._waH);
  telInput._waH = actualizarWA;
  telInput.addEventListener('input', actualizarWA);
  setTimeout(() => telInput.focus(), 200);
}

function cerrarModalTicket() {
  document.getElementById('modal-ticket').classList.add('hidden');
}

document.getElementById('btn-cerrar-ticket-modal').addEventListener('click', cerrarModalTicket);
document.getElementById('btn-cerrar-ticket-skip').addEventListener('click', cerrarModalTicket);
document.getElementById('modal-ticket').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-ticket')) cerrarModalTicket();
});

// Cargar al inicio (después de init)
setTimeout(cargarVentasRecientes, 500);
