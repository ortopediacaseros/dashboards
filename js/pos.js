import { supabase, buscarPorEAN, buscarPorTexto, registrarVenta, getCajaHoy, formatMoney, showToast } from './supabase.js';
import { Scanner } from './scanner.js';

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
  const { data: caja } = await getCajaHoy();
  if (caja && caja.estado === 'abierta') {
    cajaId = caja.id;
  }
  renderCarrito();
}

// ── Scanner ──
document.getElementById('btn-escanear').addEventListener('click', async () => {
  if (scanner && scanner.active) {
    scanner.stop();
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
  scanner.stop();
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
