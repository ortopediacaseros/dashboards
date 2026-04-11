import { supabase, buscarPorEAN, buscarPorTexto, formatMoney, showToast } from './supabase.js';
import { Scanner } from './scanner.js';
import { checkAuth } from './auth.js';

// ── Estado de sesión ──────────────────────────────────────
// { producto_id: { nombre, sku, stock_actual, cantidad, precio_costo } }
const sesion = {};
let scanner = null;
let camaraActiva = false;
let pausada = false;
let escaneadosHoy = new Set(); // para detectar duplicados en sesión

// ── Init ──────────────────────────────────────────────────
async function init() {
  const session = await checkAuth();
  if (!session) return;

  document.getElementById('btn-cam').addEventListener('click', toggleCamara);
  document.getElementById('btn-sin-codigo').addEventListener('click', toggleBuscador);
  document.getElementById('btn-confirmar-todo').addEventListener('click', confirmarTodo);
  document.getElementById('btn-limpiar-sesion').addEventListener('click', limpiarSesion);
  document.getElementById('btn-ver-resumen').addEventListener('click', abrirModalResumen);
  document.getElementById('modal-btn-confirmar').addEventListener('click', confirmarTodo);

  // Buscador manual
  let timer;
  document.getElementById('input-busqueda').addEventListener('input', e => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (!q) { document.getElementById('resultados-busqueda').innerHTML = ''; return; }
    timer = setTimeout(() => buscarManual(q), 250);
  });
}

// ── Cámara ────────────────────────────────────────────────
async function toggleCamara() {
  if (camaraActiva) {
    detenerCamara();
  } else {
    await iniciarCamara();
  }
}

async function iniciarCamara() {
  const btn = document.getElementById('btn-cam');
  btn.disabled = true;
  btn.textContent = 'Iniciando...';

  try {
    scanner = new Scanner('scanner-container', onCodigoDetectado);
    await scanner.start();

    document.getElementById('cam-placeholder').style.display = 'none';
    document.getElementById('scanner-container').style.display = 'block';
    camaraActiva = true;
    btn.disabled = false;
    btn.textContent = '⏹ Detener cámara';
  } catch (err) {
    showToast('No se pudo acceder a la cámara: ' + (err?.message || String(err)), 'error');
    btn.disabled = false;
    btn.textContent = '📷 Iniciar cámara';
  }
}

function detenerCamara() {
  if (scanner) { scanner.stop(); scanner = null; }
  document.getElementById('scanner-container').style.display = 'none';
  document.getElementById('cam-placeholder').style.display = 'block';
  document.getElementById('cam-placeholder').textContent = '📷 Cámara detenida. Presioná "Iniciar cámara" para volver a escanear.';
  document.getElementById('btn-cam').textContent = '📷 Iniciar cámara';
  camaraActiva = false;
  pausada = false;
}

function pausarCamara() {
  if (scanner && camaraActiva && !pausada) {
    scanner.stop();
    pausada = true;
  }
}

async function reanudarCamara() {
  if (!camaraActiva || !pausada) return;
  try {
    scanner = new Scanner('scanner-container', onCodigoDetectado);
    await scanner.start();
    pausada = false;
  } catch {}
}

// ── Detección de código ───────────────────────────────────
async function onCodigoDetectado(codigo) {
  if (pausada) return;
  pausarCamara();

  document.getElementById('scan-status').textContent = 'Buscando...';

  const { data, error } = await buscarPorEAN(codigo);

  if (error || !data) {
    mostrarProductoNuevo(codigo);
    return;
  }

  mostrarConfirmacion(data);
}

// ── Buscador manual ───────────────────────────────────────
function toggleBuscador() {
  const div = document.getElementById('buscador-manual');
  const visible = div.style.display !== 'none';
  div.style.display = visible ? 'none' : 'block';
  if (!visible) {
    document.getElementById('input-busqueda').focus();
    if (camaraActiva) pausarCamara();
  } else {
    document.getElementById('resultados-busqueda').innerHTML = '';
    document.getElementById('input-busqueda').value = '';
    if (camaraActiva && pausada) reanudarCamara();
  }
}

async function buscarManual(q) {
  const { data } = await buscarPorTexto(q);
  const el = document.getElementById('resultados-busqueda');
  if (!data || !data.length) {
    el.innerHTML = '<div style="color:var(--text-muted);font-size:13px;padding:8px 0">Sin resultados</div>';
    return;
  }
  el.innerHTML = data.map(p => `
    <div class="sidebar-result-item" style="cursor:pointer" data-id="${p.id}">
      <div style="min-width:0">
        <div style="font-weight:500;font-size:13px">${p.nombre}</div>
        <div style="font-size:11px;color:var(--text-dim)">${p.categoria} · SKU: ${p.sku || '—'}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;padding-left:8px">
        <div style="font-family:'Syne',sans-serif;font-weight:700;color:var(--teal)">${formatMoney(p.precio_venta)}</div>
        <div style="font-size:11px;color:var(--text-muted)">Stock: ${p.stock_actual}</div>
      </div>
    </div>`).join('');

  el.querySelectorAll('[data-id]').forEach(item => {
    item.addEventListener('click', () => {
      const prod = data.find(p => p.id === item.dataset.id);
      if (prod) {
        document.getElementById('buscador-manual').style.display = 'none';
        document.getElementById('input-busqueda').value = '';
        el.innerHTML = '';
        mostrarConfirmacion(prod);
      }
    });
  });
}

// ── Confirmación de carga ─────────────────────────────────
function mostrarConfirmacion(producto) {
  const yaCargado = sesion[producto.id];
  const cantidadPrevia = yaCargado?.cantidad || 0;
  const esDuplicado = escaneadosHoy.has(producto.id) && cantidadPrevia > 0;

  const area = document.getElementById('confirm-area');
  area.innerHTML = `
    <div class="card confirm-card">
      ${esDuplicado ? `
        <div style="background:var(--amber-dim);border:1px solid var(--amber);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--amber)">
          ⚠️ Ya cargaste <strong>${cantidadPrevia}</strong> unidad${cantidadPrevia !== 1 ? 'es' : ''} de este producto en esta sesión. ¿Sumás más?
        </div>` : ''}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <div style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700">${producto.nombre}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px">
            SKU: ${producto.sku || '—'} · Stock actual: <strong>${producto.stock_actual}</strong>
          </div>
        </div>
        <div style="font-family:'Syne',sans-serif;font-weight:700;color:var(--teal);font-size:18px">
          ${formatMoney(producto.precio_venta)}
        </div>
      </div>

      <label style="font-size:13px;color:var(--text-muted);margin-bottom:6px;display:block">Cantidad a sumar</label>
      <input type="number" class="input" id="input-cantidad" min="1" value="1"
        style="font-size:24px;font-family:'Syne',sans-serif;font-weight:700;text-align:center" inputmode="numeric">

      <div class="qty-btns">
        <button class="qty-btn" data-qty="5">×5</button>
        <button class="qty-btn" data-qty="10">×10</button>
        <button class="qty-btn" data-qty="20">×20</button>
      </div>

      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn btn-primary" id="btn-confirmar-item" style="flex:2">
          ✅ Sumar al inventario
        </button>
        <button class="btn btn-secondary" id="btn-cancelar-item" style="flex:1">
          Cancelar
        </button>
      </div>
    </div>`;

  // Focus en cantidad
  const inputCantidad = document.getElementById('input-cantidad');
  inputCantidad.focus();
  inputCantidad.select();

  // Botones ×N
  area.querySelectorAll('.qty-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      inputCantidad.value = btn.dataset.qty;
      inputCantidad.focus();
    });
  });

  // Confirmar
  document.getElementById('btn-confirmar-item').addEventListener('click', () => {
    const cantidad = parseInt(inputCantidad.value) || 1;
    if (cantidad < 1) { showToast('La cantidad debe ser al menos 1', 'error'); return; }
    agregarASesion(producto, cantidad);
  });

  // Cancelar
  document.getElementById('btn-cancelar-item').addEventListener('click', () => {
    area.innerHTML = '';
    if (camaraActiva && pausada) setTimeout(reanudarCamara, 300);
  });

  // Enter confirma
  inputCantidad.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-confirmar-item').click();
    if (e.key === 'Escape') document.getElementById('btn-cancelar-item').click();
  });
}

// ── Nuevo producto (EAN no encontrado) ────────────────────
function mostrarProductoNuevo(ean) {
  const area = document.getElementById('confirm-area');
  area.innerHTML = `
    <div class="card confirm-card">
      <div style="background:var(--red-dim);border:1px solid var(--red);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:14px;font-size:13px;color:var(--red)">
        ❌ Código <strong>${ean}</strong> no encontrado en inventario.
      </div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
        Podés buscar el producto manualmente o ir a Inventario para crearlo.
      </p>
      <div style="display:flex;gap:10px">
        <button class="btn btn-secondary" id="btn-buscar-desde-error" style="flex:1">🔍 Buscar manual</button>
        <a href="inventario.html" class="btn btn-primary" style="flex:1;text-align:center">➕ Crear producto</a>
      </div>
    </div>`;

  document.getElementById('btn-buscar-desde-error').addEventListener('click', () => {
    area.innerHTML = '';
    document.getElementById('buscador-manual').style.display = 'block';
    document.getElementById('input-busqueda').focus();
  });
}

// ── Sesión ────────────────────────────────────────────────
function agregarASesion(producto, cantidad) {
  escaneadosHoy.add(producto.id);

  if (sesion[producto.id]) {
    sesion[producto.id].cantidad += cantidad;
  } else {
    sesion[producto.id] = {
      nombre: producto.nombre,
      sku: producto.sku,
      stock_actual: producto.stock_actual,
      cantidad,
    };
  }

  document.getElementById('confirm-area').innerHTML = `
    <div class="card" style="text-align:center;padding:24px;animation:slideUp 0.2s ease">
      <div style="font-size:36px;margin-bottom:8px">✅</div>
      <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:16px">${producto.nombre}</div>
      <div style="color:var(--teal);font-size:22px;font-weight:700;margin:8px 0">+${cantidad} unidades</div>
      <div style="color:var(--text-muted);font-size:13px">Stock actual: ${producto.stock_actual} → ${producto.stock_actual + cantidad}</div>
    </div>`;

  renderSesion();

  // Reanudar cámara en 500ms
  if (camaraActiva) {
    setTimeout(() => {
      document.getElementById('confirm-area').innerHTML = '';
      reanudarCamara();
    }, 1500);
  }
}

function renderSesion() {
  const items = Object.entries(sesion);
  const totalItems = items.length;
  const totalUnidades = items.reduce((s, [, v]) => s + v.cantidad, 0);

  const sesionVacia = document.getElementById('sesion-vacia');
  const sesionItemsEl = document.getElementById('sesion-items');
  const sesionFooter = document.getElementById('sesion-footer');
  const btnResumen = document.getElementById('btn-ver-resumen');
  const badge = document.getElementById('sesion-total-badge');

  if (totalItems === 0) {
    sesionVacia.style.display = 'block';
    sesionItemsEl.style.display = 'none';
    sesionFooter.style.display = 'none';
    btnResumen.style.display = 'none';
    badge.style.display = 'none';
    return;
  }

  sesionVacia.style.display = 'none';
  sesionItemsEl.style.display = 'flex';
  sesionFooter.style.display = 'block';
  btnResumen.style.display = 'block';
  badge.style.display = 'inline';
  badge.textContent = `${totalUnidades} u.`;
  document.getElementById('resumen-count').textContent = totalItems;

  sesionItemsEl.innerHTML = items.map(([id, item]) => `
    <div class="session-item flash-green" id="sitem-${id}">
      <div style="min-width:0">
        <div class="session-item-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${item.nombre}</div>
        <div style="font-size:11px;color:var(--text-muted)">Stock previo: ${item.stock_actual}</div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <span class="session-item-qty">+${item.cantidad}</span>
        <button class="btn btn-danger" style="padding:4px 10px;font-size:12px" data-id="${id}">✕</button>
      </div>
    </div>`).join('');

  // Botones eliminar
  sesionItemsEl.querySelectorAll('[data-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      delete sesion[btn.dataset.id];
      renderSesion();
    });
  });
}

function limpiarSesion() {
  if (Object.keys(sesion).length === 0) return;
  if (!confirm('¿Limpiar todos los productos de la sesión? Los cambios NO se guardarán en Supabase.')) return;
  Object.keys(sesion).forEach(k => delete sesion[k]);
  escaneadosHoy.clear();
  renderSesion();
  document.getElementById('confirm-area').innerHTML = '';
  showToast('Sesión limpiada', 'info');
}

// ── Confirmar todo en Supabase ────────────────────────────
async function confirmarTodo() {
  const items = Object.entries(sesion);
  if (items.length === 0) return;

  const btnConfirmar = document.getElementById('btn-confirmar-todo');
  const modalBtn = document.getElementById('modal-btn-confirmar');
  if (btnConfirmar) { btnConfirmar.disabled = true; btnConfirmar.textContent = 'Guardando...'; }
  if (modalBtn) { modalBtn.disabled = true; modalBtn.textContent = 'Guardando...'; }

  let errores = 0;

  for (const [id, item] of items) {
    const { error } = await supabase.rpc('sumar_stock', {
      p_producto_id: id,
      p_cantidad: item.cantidad
    });
    if (error) {
      console.error(`Error al sumar stock de ${item.nombre}:`, error);
      errores++;
    }
  }

  if (errores === 0) {
    const totalUnidades = items.reduce((s, [, v]) => s + v.cantidad, 0);
    showToast(`✅ ${items.length} productos actualizados — ${totalUnidades} unidades sumadas`, 'success', 4000);
    Object.keys(sesion).forEach(k => delete sesion[k]);
    escaneadosHoy.clear();
    renderSesion();
    document.getElementById('confirm-area').innerHTML = '';
    document.getElementById('modal-resumen').classList.add('hidden');
  } else {
    showToast(`Completado con ${errores} error${errores !== 1 ? 'es' : ''}. Revisá la consola.`, 'error');
  }

  if (btnConfirmar) { btnConfirmar.disabled = false; btnConfirmar.textContent = '✅ Confirmar todo en Supabase'; }
  if (modalBtn) { modalBtn.disabled = false; modalBtn.textContent = '✅ Confirmar todo'; }
}

// ── Modal resumen (mobile) ────────────────────────────────
function abrirModalResumen() {
  const items = Object.entries(sesion);
  const el = document.getElementById('modal-resumen-items');
  el.innerHTML = items.map(([id, item]) => `
    <div class="session-item">
      <div>
        <div class="session-item-name">${item.nombre}</div>
        <div style="font-size:11px;color:var(--text-muted)">Stock previo: ${item.stock_actual}</div>
      </div>
      <span class="session-item-qty">+${item.cantidad}</span>
    </div>`).join('');
  document.getElementById('modal-resumen').classList.remove('hidden');
}

init();
