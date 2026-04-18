import { supabase, formatMoney, showToast } from './supabase.js';

const PER_PAGE = 15;
let allVentas = [];
let paginaActual = 1;

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

  let q = supabase.from('ventas')
    .select('id, numero_ticket, fecha, total, medio_pago, descuento_pct, observaciones, estado, ticket_url, items_count:items_venta(count)')
    .order('fecha', { ascending: false });

  if (desde) q = q.gte('fecha', desde + 'T00:00:00');
  if (hasta) q = q.lte('fecha', hasta + 'T23:59:59');
  if (medio) q = q.eq('medio_pago', medio);
  if (estado) q = q.eq('estado', estado);

  const { data, error } = await q;

  if (error) {
    // Fallback sin count
    let q2 = supabase.from('ventas')
      .select('id, numero_ticket, fecha, total, medio_pago, descuento_pct, observaciones, estado')
      .order('fecha', { ascending: false });
    if (desde) q2 = q2.gte('fecha', desde + 'T00:00:00');
    if (hasta) q2 = q2.lte('fecha', hasta + 'T23:59:59');
    if (medio) q2 = q2.eq('medio_pago', medio);
    if (estado) q2 = q2.eq('estado', estado);
    const { data: d2, error: e2 } = await q2;
    if (e2) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--red)">Error: ${e2.message}</td></tr>`;
      return;
    }
    allVentas = (d2 || []).map(v => ({ ...v, _cnt: null, ticket_url: null }));
  } else {
    allVentas = (data || []).map(v => ({
      ...v,
      _cnt: Array.isArray(v.items_count) ? (v.items_count[0]?.count ?? null) : null
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
    const n      = (paginaActual - 1) * PER_PAGE + i + 1;
    const ticket = v.numero_ticket ? `#${v.numero_ticket}` : `#${n}`;
    const fecha  = new Date(v.fecha).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const cnt    = v._cnt != null ? `${v._cnt} ítem${v._cnt != 1 ? 's' : ''}` : '—';
    const medio  = v.medio_pago ? v.medio_pago.charAt(0).toUpperCase() + v.medio_pago.slice(1) : '—';
    const desc   = v.descuento_pct > 0
      ? `<span style="color:var(--amber)">-${v.descuento_pct}%</span>`
      : `<span style="color:var(--text-3)">—</span>`;
    const anulada = v.estado === 'anulada';
    const badge   = anulada
      ? `<span class="badge b-red">Anulada</span>`
      : `<span class="badge b-green">Confirmada</span>`;
    return `<tr style="${anulada ? 'opacity:0.55' : ''}">
      <td class="mono" style="color:var(--text-3)">${ticket}</td>
      <td>${fecha}</td>
      <td style="color:var(--text-2)">${cnt}</td>
      <td>${medio}</td>
      <td>${desc}</td>
      <td style="font-weight:600">${formatMoney(v.total)}</td>
      <td>${badge}</td>
      <td style="display:flex;gap:6px;align-items:center">
        ${v.ticket_url ? `<a href="${v.ticket_url}" target="_blank" class="btn btn-ghost btn-sm" title="Ver comprobante">🖼</a>` : ''}
        <button class="btn btn-ghost btn-sm" data-id="${v.id}">Ver</button>
      </td>
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
  document.getElementById('kpi-hoy').textContent       = hoyV.length;
  document.getElementById('kpi-total-hoy').textContent = formatMoney(hoyV.reduce((s, v) => s + Number(v.total), 0));
  document.getElementById('kpi-mes').textContent       = mesV.length;
  document.getElementById('kpi-total-mes').textContent = formatMoney(mesV.reduce((s, v) => s + Number(v.total), 0));
}

async function abrirDetalle(id) {
  const v = allVentas.find(x => x.id === id);
  if (!v) return;
  detalleContent.innerHTML = `<div style="padding:24px;text-align:center;color:var(--text-3)">Cargando…</div>`;
  detalleActions.innerHTML = '';
  overlay.classList.remove('hidden');

  const { data: items } = await supabase
    .from('items_venta')
    .select('id, cantidad, precio_unitario, subtotal, productos(nombre)')
    .eq('venta_id', id);

  renderDetalle(v, items || []);
}

function renderDetalle(v, items) {
  const fecha   = new Date(v.fecha).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const subtotal = items.reduce((s, i) => s + Number(i.subtotal || i.cantidad * i.precio_unitario), 0);
  const medio   = v.medio_pago ? v.medio_pago.charAt(0).toUpperCase() + v.medio_pago.slice(1) : '—';
  const anulada = v.estado === 'anulada';
  const ticket  = v.numero_ticket ? `Ticket #${v.numero_ticket}` : '';

  detalleContent.innerHTML = `
    <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div>
        ${ticket ? `<div style="font-weight:600;font-size:13px">${ticket}</div>` : ''}
        <div style="font-size:12px;color:var(--text-3)">${fecha}</div>
      </div>
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
            <td style="padding:8px 20px;text-align:right;font-size:13px;font-weight:500;border-bottom:1px solid var(--border)">${formatMoney(i.subtotal || i.cantidad * i.precio_unitario)}</td>
          </tr>`).join('')
          : `<tr><td colspan="4" style="padding:16px 20px;text-align:center;color:var(--text-3)">Sin ítems registrados</td></tr>`}
      </tbody>
    </table>
    <div style="padding:12px 20px;display:flex;flex-direction:column;gap:5px">
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-3)">
        <span>Subtotal</span><span>${formatMoney(subtotal)}</span>
      </div>
      ${v.descuento_pct > 0 ? `
      <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--amber)">
        <span>Descuento</span><span>-${v.descuento_pct}%</span>
      </div>` : ''}
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:700;border-top:1px solid var(--border);padding-top:8px;margin-top:2px">
        <span>Total</span><span>${formatMoney(v.total)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-3);margin-top:2px">
        <span>Medio de pago</span><span>${medio}</span>
      </div>
      ${v.observaciones ? `
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-3)">
        <span>Observaciones</span><span>${v.observaciones}</span>
      </div>` : ''}
    </div>`;

  detalleActions.innerHTML = '';

  // Comprobante imagen si existe
  if (v.ticket_url) {
    const imgWrap = document.createElement('div');
    imgWrap.style.cssText = 'margin-bottom:12px;text-align:center';
    imgWrap.innerHTML = `<a href="${v.ticket_url}" target="_blank" class="btn btn-ghost btn-full">🖼 Ver comprobante PDF/imagen</a>`;
    detalleActions.appendChild(imgWrap);
  }

  if (!anulada) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;gap:8px';

    const btnEditar = document.createElement('button');
    btnEditar.className = 'btn btn-secondary btn-full';
    btnEditar.textContent = '✏ Editar';
    btnEditar.addEventListener('click', () => mostrarFormEdit(v, items, subtotal));

    const btnAnular = document.createElement('button');
    btnAnular.className = 'btn btn-danger btn-full';
    btnAnular.textContent = '↩ Anular';
    btnAnular.addEventListener('click', () => anularVenta(v.id));

    const btnBorrar = document.createElement('button');
    btnBorrar.className = 'btn btn-ghost btn-sm';
    btnBorrar.title = 'Elimina y restaura stock';
    btnBorrar.textContent = '🗑';
    btnBorrar.addEventListener('click', () => borrarVenta(v.id, v.numero_ticket, false));

    wrap.appendChild(btnEditar);
    wrap.appendChild(btnAnular);
    wrap.appendChild(btnBorrar);
    detalleActions.appendChild(wrap);
  } else {
    const btnBorrar = document.createElement('button');
    btnBorrar.className = 'btn btn-ghost btn-sm';
    btnBorrar.style.cssText = 'width:100%;margin-top:4px';
    btnBorrar.textContent = '🗑 Borrar ticket anulado';
    btnBorrar.addEventListener('click', () => borrarVenta(v.id, v.numero_ticket, true));
    detalleActions.appendChild(btnBorrar);
  }
}

function mostrarFormEdit(v, items, subtotal) {
  const medioActual = v.medio_pago || 'efectivo';
  const descActual  = v.descuento_pct || 0;
  const totalActual = v.total;

  detalleContent.innerHTML = `
    <div style="padding:16px 20px">
      <div style="font-size:13px;font-weight:600;margin-bottom:14px">Editar ticket</div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--text-3);display:block;margin-bottom:4px">Medio de pago</label>
        <select class="select" id="edit-medio" style="width:100%">
          <option value="efectivo"      ${medioActual==='efectivo'      ?'selected':''}>Efectivo</option>
          <option value="debito"        ${medioActual==='debito'        ?'selected':''}>Débito</option>
          <option value="credito"       ${medioActual==='credito'       ?'selected':''}>Crédito</option>
          <option value="transferencia" ${medioActual==='transferencia' ?'selected':''}>Transferencia</option>
        </select>
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--text-3);display:block;margin-bottom:4px">Descuento (%)</label>
        <input type="number" class="input" id="edit-desc" value="${descActual}" min="0" max="100" step="0.5" style="width:100%">
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:12px;color:var(--text-3);display:block;margin-bottom:4px">Observaciones</label>
        <input type="text" class="input" id="edit-obs" value="${v.observaciones || ''}" style="width:100%" placeholder="Opcional">
      </div>
      <div style="font-size:13px;color:var(--text-2);padding:8px 0;border-top:1px solid var(--border)" id="edit-preview">
        Total: <strong>${formatMoney(totalActual)}</strong>
      </div>
    </div>`;

  document.getElementById('edit-desc').addEventListener('input', () => {
    const pct  = parseFloat(document.getElementById('edit-desc').value) || 0;
    const newT = subtotal * (1 - pct / 100);
    document.getElementById('edit-preview').innerHTML =
      `Total: <strong>${formatMoney(Math.max(0, newT))}</strong>`;
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
  btnGuardar.textContent = 'Guardar';
  btnGuardar.addEventListener('click', () => guardarEdicion(v, items, subtotal));

  wrap.appendChild(btnCancelar);
  wrap.appendChild(btnGuardar);
  detalleActions.appendChild(wrap);
}

async function guardarEdicion(v, items, subtotal) {
  const medio       = document.getElementById('edit-medio').value;
  const descuento_pct = parseFloat(document.getElementById('edit-desc').value) || 0;
  const observaciones = document.getElementById('edit-obs').value.trim() || null;
  const total         = Math.max(0, Math.round(subtotal * (1 - descuento_pct / 100) * 100) / 100);

  const { error } = await supabase.from('ventas')
    .update({ medio_pago: medio, descuento_pct, observaciones, total })
    .eq('id', v.id);

  if (error) { showToast('Error al guardar: ' + error.message, 'error'); return; }

  showToast('Ticket actualizado', 'success');
  const idx = allVentas.findIndex(x => x.id === v.id);
  if (idx !== -1) allVentas[idx] = { ...allVentas[idx], medio_pago: medio, descuento_pct, observaciones, total };
  renderTabla();
  renderDetalle({ ...v, medio_pago: medio, descuento_pct, observaciones, total }, items);
}

async function restaurarStock(ventaId) {
  const { data: items } = await supabase
    .from('items_venta').select('producto_id, cantidad').eq('venta_id', ventaId);
  for (const item of (items || [])) {
    await supabase.rpc('descontar_stock', { p_producto_id: item.producto_id, p_cantidad: -item.cantidad });
  }
}

async function anularVenta(id) {
  if (!confirm('¿Anular este ticket? Se devolverá el stock.')) return;
  await restaurarStock(id);
  const { error } = await supabase.from('ventas').update({ estado: 'anulada' }).eq('id', id);
  if (error) { showToast('Error al anular: ' + error.message, 'error'); return; }
  showToast('Ticket anulado y stock restaurado', 'success');
  overlay.classList.add('hidden');
  await cargarVentas();
}

function exportarCSV() {
  if (!allVentas.length) { showToast('No hay datos para exportar', 'error'); return; }
  const rows = [['Ticket','Fecha','Medio','Descuento%','Total','Estado','Observaciones']];
  allVentas.forEach(v => {
    rows.push([
      v.numero_ticket || '',
      new Date(v.fecha).toLocaleString('es-AR'),
      v.medio_pago || '',
      v.descuento_pct || 0,
      v.total || 0,
      v.estado || '',
      v.observaciones || ''
    ]);
  });
  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), { href: url, download: `tickets_${hoy()}.csv` });
  a.click();
  URL.revokeObjectURL(url);
}

async function borrarVenta(id, nro, skipRestaurar = false) {
  const msg = skipRestaurar
    ? `¿Borrar el ticket #${nro}? (ya estaba anulado, el stock no se toca)`
    : `¿Borrar el ticket #${nro}? Se devolverá el stock.`;
  if (!confirm(msg)) return;
  if (!skipRestaurar) await restaurarStock(id);
  await supabase.from('items_venta').delete().eq('venta_id', id);
  const { error } = await supabase.from('ventas').delete().eq('id', id);
  if (error) { showToast('Error al borrar: ' + error.message, 'error'); return; }
  showToast(`Ticket #${nro} eliminado`, 'success');
  overlay.classList.add('hidden');
  await cargarVentas();
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
