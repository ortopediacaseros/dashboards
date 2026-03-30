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
    showToast('Error al acceder a la cámara: ' + err.message, 'error');
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

  // Success
  showToast(`¡Venta #${data.numero_ticket} registrada! ${formatMoney(total)}`, 'success', 4000);
  carrito = [];
  descuentoInput.value = '';
  obsEl.value = '';
  medioPagoEl.value = 'efectivo';
  renderCarrito();
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
  const { error } = await supabase.from('ventas').update({ total, medio_pago, observaciones, descuento_pct: desc })
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

document.getElementById('btn-refrescar-recientes').addEventListener('click', cargarVentasRecientes);

// Cargar al inicio (después de init)
setTimeout(cargarVentasRecientes, 500);
