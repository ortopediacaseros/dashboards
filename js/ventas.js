import { supabase, formatMoney, showToast } from './supabase.js';

const PER_PAGE = 15;
let allVentas = [];
let paginaActual = 1;
let ventaEditando = null;

const tbody   = document.getElementById('ventas-tbody');
const infoEl  = document.getElementById('ventas-info');
const pgPrev  = document.getElementById('pg-prev');
const pgNext  = document.getElementById('pg-next');
const overlay = document.getElementById('modal-detalle-venta');
const detalleContent = document.getElementById('detalle-content');
const detalleActions = document.getElementById('detalle-actions');

async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.href = 'login.html'; return false; }
  return true;
}

function hoy()         { return new Date().toISOString().split('T')[0]; }
function startOfWeek() {
  const d = new Date();
  d.setDate(d.getDate() - d.getDay() + (d.getDay() === 0 ? -6 : 1));
  return d.toISOString().split('T')[0];
}
function startOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
}
function setFiltroFechas(desde, hasta) {
  document.getElementById('filtro-desde').value = desde;
  document.getElementById('filtro-hasta').value  = hasta;
}

async function cargarVentas() {
  const desde  = document.getElementById('filtro-desde').value;
  const hasta  = document.getElementById('filtro-hasta').value;
  const medio  = document.getElementById('filtro-medio').value;
  const estado = document.getElementById('filtro-estado-v').value;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-3)">Cargando…</td></tr>`;

  // Fetch only venta columns — items loaded on demand in the detail modal
  let q = supabase.from('ventas')
    .select('id, fecha, medio_pago, descuento, total, estado, items_count:items_venta(count)')
    .order('fecha', { ascending: false });

  if (desde) q = q.gte('fecha', desde + 'T00:00:00');
  if (hasta) q = q.lte('fecha', hasta + 'T23:59:59');
  if (medio) q = q.eq('medio_pago', medio);
  if (estado) q = q.eq('estado', estado);

  const { data, error } = await q;

  if (error) {
    // Fallback: fetch without count if the alias/join fails
    let q2 = supabase.from('ventas')
      .select('id, fecha, medio_pago, descuento, total, estado')
      .order('fecha', { ascending: false });
    if (desde) q2 = q2.gte('fecha', desde + 'T00:00:00');
    if (hasta) q2 = q2.lte('fecha', hasta + 'T23:59:59');
    if (medio) q2 = q2.eq('medio_pago', medio);
    if (estado) q2 = q2.eq('estado', estado);
    const { data: data2, error: error2 } = await q2;
    if (error2) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--red)">Error al cargar ventas: ${error2.message}</td></tr>`;
      return;
    }
    allVentas = (data2 || []).map(v => ({ ...v, _items_count: null }));
  } else {
    allVentas = (data || []).map(v => ({
      ...v,
      _items_count: Array.isArray(v.items_count) ? v.items_count[0]?.count ?? null : null
    }));
  }

  paginaActual = 1;
  renderTabla();
  actualizarKpis();
}

function renderTabla() {
  const total = allVentas.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  if (paginaActual > pages) paginaActual = pages;
  const slice = allVentas.slice((paginaActual - 1) * PER_PAGE, paginaActual * PER_PAGE);

  if (!slice.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-3)">Sin resultados</td></tr>`;
    infoEl.textContent = '0 tickets';
    return;
  }

  tbody.innerHTML = slice.map((v, i) => {
    const n     = (paginaActual - 1) * PER_PAGE + i + 1;
    const fecha = new Date(v.fecha).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const cnt   = v._items_count != null ? `${v._items_count} ítem${v._items_count !== 1 ? 's' : ''}` : '—';
    const medio = v.medio_pago ? v.medio_pago.charAt(0).toUpperCase() + v.medio_pago.slice(1) : '—';
    const desc  = v.descuento > 0
      ? `<span style="color:var(--amber)">-${formatMoney(v.descuento)}</span>`
      : `<span style="color:var(--text-3)">—</span>`;
    const anulada = v.estado === 'anulada';
    const badge = anulada
      ? `<span class="badge b-red">Anulada</span>`
      : `<span class="badge b-green">Confirmada</span>`;
    return `<tr style="${anulada ? 'opacity:0.55' : ''}">
      <td class="mono" style="color:var(--text-3)">#${n}</td>
      <td>${fecha}</td>
      <td style="color:var(--text-2)">${cnt}</td>
      <td>${medio}</td>
      <td>${desc}</td>
      <td style="font-weight:600">${formatMoney(v.total)}</td>
      <td>${badge}</td>
      <td><button class="btn btn-ghost btn-sm" data-id="${v.id}">Ver</button></td>
    </tr>`;
  }).join('');

  infoEl.textContent = `${total} ticket${total !== 1 ? 's' : ''} · Página ${paginaActual} de ${pages}`;
  pgPrev.disabled = paginaActual <= 1;
  pgNext.disabled = paginaActual >= pages;
  tbody.querySelectorAll('button[data-id]').forEach(btn =>
    btn.addEventListener('click', () => abrirDetalle(btn.dataset.id))
  );
}

function actualizarKpis() {
  const todayStr = hoy();
  const mesStr   = startOfMonth();
  const hoyV = allVentas.filter(v => v.fecha?.startsWith(todayStr) && v.estado !== 'anulada');
  const mesV  = allVentas.filter(v => v.fecha >= mesStr && v.estado !== 'anulada');
  document.getElementById('kpi-hoy').textContent      = hoyV.length;
  document.getElementById('kpi-total-hoy').textContent = formatMoney(hoyV.reduce((s,v) => s + Number(v.total), 0));
  document.getElementById('kpi-mes').textContent       = mesV.length;
  document.getElementById('kpi-total-mes').textContent = formatMoney(mesV.reduce((s,v) => s + Number(v.total), 0));
}

async function abrirDetalle(id) {
  const v = allVentas.find(x => x.id === id);
  if (!v) return;

  ventaEditando = v;
  detalleContent.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3)">Cargando…</div>`;
  detalleActions.innerHTML = '';
  overlay.classList.remove('hidden');

  // Load items on demand
  const { data: items } = await supabase
    .from('items_venta')
    .select('id, cantidad, precio_unitario, producto_id, productos(nombre)')
    .eq('venta_id', id);

  renderDetalle(v, items || []);
}

function renderDetalle(v, items) {
  const fecha   = new Date(v.fecha).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const subtotal = items.reduce((s, i) => s + (i.cantidad * i.precio_unitario), 0);
  const medio   = v.medio_pago ? v.medio_pago.charAt(0).toUpperCase() + v.medio_pago.slice(1) : '—';
  const anulada = v.estado === 'anulada';

  detalleContent.innerHTML = `
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:12px;color:var(--text-3)">${fecha}</div>
      ${anulada ? '<span class="badge b-red">Anulada</span>' : '<span class="badge b-green">Confirmada</span>'}
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:var(--bg)">
          <th style="padding:8px 20px;text-align:left;font-size:11px;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border)">Producto</th>
          <th style="padding:8px 8px;text-align:center;font-size:11px;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border)">Cant.</th>
          <th style="padding:8px 8px;text-align:right;font-size:11px;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border)">P.Unit.</th>
          <th style="padding:8px 20px;text-align:right;font-size:11px;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border)">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${items.length ? items.map(i => `
          <tr>
            <td style="padding:8px 20px;font-size:13px;border-bottom:1px solid var(--border)">${i.productos?.nombre || '—'}</td>
            <td style="padding:8px 8px;text-align:center;font-size:13px;border-bottom:1px solid var(--border)">${i.cantidad}</td>
            <td style="padding:8px 8px;text-align:right;font-size:13px;border-bottom:1px solid var(--border)">${formatMoney(i.precio_unitario)}</td>
            <td style="padding:8px 20px;text-align:right;font-size:13px;font-weight:500;border-bottom:1px solid var(--border)">${formatMoney(i.cantidad * i.precio_unitario)}</td>
          </tr>`).join('')
          : `<tr><td colspan="4" style="padding:16px 20px;text-align:center;color:var(--text-3);font-size:13px">Sin ítems registrados</td></tr>`}
      </tbody>
    </table>
    <div style="padding:12px 20px;display:flex;flex-direction:column;gap:5px" id="detalle-totales">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-3)">
        <span>Subtotal</span><span>${formatMoney(subtotal)}</span>
      </div>
      ${v.descuento > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--amber)">
        <span>Descuento</span><span>-${formatMoney(v.descuento)}</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
        <span>Total</span><span>${formatMoney(v.total)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-3);margin-top:2px">
        <span>Medio de pago</span><span>${medio}</span>
      </div>
    </div>`;

  detalleActions.innerHTML = '';
  if (!anulada) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px';

    const btnEditar = document.createElement('button');
    btnEditar.className = 'btn btn-secondary btn-full';
    btnEditar.textContent = '✏ Editar';
    btnEditar.addEventListener('click', () => mostrarFormEdit(v, items));

    const btnAnular = document.createElement('button');
    btnAnular.className = 'btn btn-danger btn-full';
    btnAnular.textContent = '✕ Anular';
    btnAnular.addEventListener('click', () => anularVenta(v.id));

    wrap.appendChild(btnEditar);
    wrap.appendChild(btnAnular);
    detalleActions.appendChild(wrap);
  }
}

function mostrarFormEdit(v, items) {
  const medioActual = v.medio_pago || 'efectivo';
  const descActual  = v.descuento || 0;
  const subtotal    = items.reduce((s, i) => s + (i.cantidad * i.precio_unitario), 0);

  detalleContent.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid var(--border)">
      <div style="font-size:13px;font-weight:600;margin-bottom:12px">Editar ticket</div>
      <div class="form-group" style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--text-3);display:block;margin-bottom:4px">Medio de pago</label>
        <select class="select" id="edit-medio" style="width:100%">
          <option value="efectivo"       ${medioActual==='efectivo'       ?'selected':''}>Efectivo</option>
          <option value="debito"         ${medioActual==='debito'         ?'selected':''}>Débito</option>
          <option value="credito"        ${medioActual==='credito'        ?'selected':''}>Crédito</option>
          <option value="transferencia"  ${medioActual==='transferencia'  ?'selected':''}>Transferencia</option>
        </select>
      </div>
      <div class="form-group" style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--text-3);display:block;margin-bottom:4px">Descuento ($)</label>
        <input type="number" class="input" id="edit-descuento" value="${descActual}" min="0" step="0.01" style="width:100%">
      </div>
      <div style="font-size:12px;color:var(--text-3);padding:8px 0;border-top:1px solid var(--border);margin-top:4px" id="edit-preview-total">
        Total: ${formatMoney(subtotal - descActual)}
      </div>
    </div>`;

  const descInput = document.getElementById('edit-descuento');
  descInput.addEventListener('input', () => {
    const d = parseFloat(descInput.value) || 0;
    document.getElementById('edit-preview-total').textContent = `Total: ${formatMoney(Math.max(0, subtotal - d))}`;
  });

  detalleActions.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;gap:8px';

  const btnCancelar = document.createElement('button');
  btnCancelar.className = 'btn btn-ghost btn-full';
  btnCancelar.textContent = 'Cancelar';
  btnCancelar.addEventListener('click', () => renderDetalle(v, items));

  const btnGuardar = document.createElement('button');
  btnGuardar.className = 'btn btn-primary btn-full';
  btnGuardar.textContent = 'Guardar cambios';
  btnGuardar.addEventListener('click', () => guardarEdicion(v, items, subtotal));

  wrap.appendChild(btnCancelar);
  wrap.appendChild(btnGuardar);
  detalleActions.appendChild(wrap);
}

async function guardarEdicion(v, items, subtotal) {
  const medio     = document.getElementById('edit-medio').value;
  const descuento = parseFloat(document.getElementById('edit-descuento').value) || 0;
  const total     = Math.max(0, subtotal - descuento);

  const { error } = await supabase.from('ventas')
    .update({ medio_pago: medio, descuento, total })
    .eq('id', v.id);

  if (error) { showToast('Error al guardar', 'error'); return; }

  showToast('Ticket actualizado', 'success');
  // Update local copy
  const idx = allVentas.findIndex(x => x.id === v.id);
  if (idx !== -1) {
    allVentas[idx] = { ...allVentas[idx], medio_pago: medio, descuento, total };
    ventaEditando = allVentas[idx];
  }
  renderTabla();
  renderDetalle({ ...v, medio_pago: medio, descuento, total }, items);
}

async function anularVenta(id) {
  if (!confirm('¿Anular este ticket? Esta acción no se puede deshacer.')) return;
  const { error } = await supabase.from('ventas').update({ estado: 'anulada' }).eq('id', id);
  if (error) { showToast('Error al anular el ticket', 'error'); return; }
  showToast('Ticket anulado', 'success');
  overlay.classList.add('hidden');
  await cargarVentas();
}

function exportarCSV() {
  if (!allVentas.length) { showToast('No hay datos para exportar', 'error'); return; }
  const rows = [['#','Fecha','Medio','Descuento','Total','Estado']];
  allVentas.forEach((v, i) => {
    rows.push([i+1, new Date(v.fecha).toLocaleString('es-AR'), v.medio_pago||'', v.descuento||0, v.total||0, v.estado||'']);
  });
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `tickets_${hoy()}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

async function init() {
  if (!await checkAuth()) return;

  setFiltroFechas(startOfMonth(), hoy());

  document.getElementById('btn-hoy').addEventListener('click',    () => { setFiltroFechas(hoy(), hoy()); cargarVentas(); });
  document.getElementById('btn-semana').addEventListener('click', () => { setFiltroFechas(startOfWeek(), hoy()); cargarVentas(); });
  document.getElementById('btn-mes').addEventListener('click',    () => { setFiltroFechas(startOfMonth(), hoy()); cargarVentas(); });
  document.getElementById('filtro-desde').addEventListener('change', cargarVentas);
  document.getElementById('filtro-hasta').addEventListener('change', cargarVentas);
  document.getElementById('filtro-medio').addEventListener('change', cargarVentas);
  document.getElementById('filtro-estado-v').addEventListener('change', cargarVentas);

  pgPrev.addEventListener('click', () => { paginaActual--; renderTabla(); });
  pgNext.addEventListener('click', () => { paginaActual++; renderTabla(); });

  document.getElementById('btn-exportar').addEventListener('click', exportarCSV);
  document.getElementById('btn-cerrar-detalle').addEventListener('click', () => overlay.classList.add('hidden'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

  await cargarVentas();
}

init();
