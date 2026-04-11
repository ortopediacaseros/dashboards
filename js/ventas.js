import { supabase, formatMoney, showToast } from './supabase.js';

const PER_PAGE = 15;
let allVentas = [];
let paginaActual = 1;

const tbody    = document.getElementById('ventas-tbody');
const infoEl   = document.getElementById('ventas-info');
const pgPrev   = document.getElementById('pg-prev');
const pgNext   = document.getElementById('pg-next');
const overlay  = document.getElementById('modal-detalle-venta');
const detalleContent  = document.getElementById('detalle-content');
const detalleActions  = document.getElementById('detalle-actions');

async function checkAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) { location.href = 'login.html'; return false; }
  return true;
}

function hoy() { return new Date().toISOString().split('T')[0]; }

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
    .select(`id, fecha, medio_pago, descuento, total, estado,
             items_venta(id, cantidad, precio_unitario, producto_id, productos(nombre))`)
    .order('fecha', { ascending: false });

  if (desde) q = q.gte('fecha', desde + 'T00:00:00');
  if (hasta) q = q.lte('fecha', hasta + 'T23:59:59');
  if (medio) q = q.eq('medio_pago', medio);
  if (estado) q = q.eq('estado', estado);

  const { data, error } = await q;
  if (error) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--red)">Error al cargar ventas</td></tr>`;
    return;
  }

  allVentas    = data || [];
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
    const n    = (paginaActual - 1) * PER_PAGE + i + 1;
    const fecha = new Date(v.fecha).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const items = (v.items_venta || []).length;
    const medio = v.medio_pago ? v.medio_pago.charAt(0).toUpperCase() + v.medio_pago.slice(1) : '—';
    const desc  = v.descuento > 0 ? `<span style="color:var(--amber)">-${formatMoney(v.descuento)}</span>` : '<span style="color:var(--text-3)">—</span>';
    const anulada = v.estado === 'anulada';
    const estadoBadge = anulada
      ? `<span class="badge b-red">Anulada</span>`
      : `<span class="badge b-green">Confirmada</span>`;
    return `<tr style="${anulada ? 'opacity:0.55' : ''}">
      <td class="mono" style="color:var(--text-3)">#${n}</td>
      <td>${fecha}</td>
      <td style="color:var(--text-2)">${items} ítem${items !== 1 ? 's' : ''}</td>
      <td>${medio}</td>
      <td>${desc}</td>
      <td style="font-weight:600">${formatMoney(v.total)}</td>
      <td>${estadoBadge}</td>
      <td><button class="btn btn-ghost btn-sm" data-id="${v.id}">Ver</button></td>
    </tr>`;
  }).join('');

  infoEl.textContent = `${total} ticket${total !== 1 ? 's' : ''} · Página ${paginaActual} de ${pages}`;
  pgPrev.disabled = paginaActual <= 1;
  pgNext.disabled = paginaActual >= pages;

  tbody.querySelectorAll('button[data-id]').forEach(btn => {
    btn.addEventListener('click', () => abrirDetalle(btn.dataset.id));
  });
}

function actualizarKpis() {
  const todayStr = hoy();
  const mesStr   = startOfMonth();

  const hoyVentas = allVentas.filter(v => v.fecha && v.fecha.startsWith(todayStr) && v.estado !== 'anulada');
  const mesVentas = allVentas.filter(v => v.fecha && v.fecha >= mesStr && v.estado !== 'anulada');

  document.getElementById('kpi-hoy').textContent       = hoyVentas.length;
  document.getElementById('kpi-total-hoy').textContent  = formatMoney(hoyVentas.reduce((s,v) => s + Number(v.total), 0));
  document.getElementById('kpi-mes').textContent        = mesVentas.length;
  document.getElementById('kpi-total-mes').textContent  = formatMoney(mesVentas.reduce((s,v) => s + Number(v.total), 0));
}

function abrirDetalle(id) {
  const v = allVentas.find(x => x.id === id);
  if (!v) return;

  const fecha = new Date(v.fecha).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  const items = v.items_venta || [];
  const subtotal = items.reduce((s, i) => s + (i.cantidad * i.precio_unitario), 0);
  const medio = v.medio_pago ? v.medio_pago.charAt(0).toUpperCase() + v.medio_pago.slice(1) : '—';
  const anulada = v.estado === 'anulada';

  detalleContent.innerHTML = `
    <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:12px;color:var(--text-3)">${fecha}</div>
      ${anulada ? '<span class="badge b-red">Anulada</span>' : '<span class="badge b-green">Confirmada</span>'}
    </div>
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:var(--bg)">
          <th style="padding:9px 20px;text-align:left;font-size:11px;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border)">Producto</th>
          <th style="padding:9px 12px;text-align:center;font-size:11px;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border)">Cant.</th>
          <th style="padding:9px 12px;text-align:right;font-size:11px;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border)">P. Unit.</th>
          <th style="padding:9px 20px;text-align:right;font-size:11px;color:var(--text-3);font-weight:600;border-bottom:1px solid var(--border)">Subtotal</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(i => `
          <tr>
            <td style="padding:9px 20px;font-size:13px;border-bottom:1px solid var(--border)">${i.productos?.nombre || '—'}</td>
            <td style="padding:9px 12px;text-align:center;font-size:13px;border-bottom:1px solid var(--border)">${i.cantidad}</td>
            <td style="padding:9px 12px;text-align:right;font-size:13px;border-bottom:1px solid var(--border)">${formatMoney(i.precio_unitario)}</td>
            <td style="padding:9px 20px;text-align:right;font-size:13px;font-weight:500;border-bottom:1px solid var(--border)">${formatMoney(i.cantidad * i.precio_unitario)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div style="padding:14px 20px;display:flex;flex-direction:column;gap:6px">
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
    const btnAnular = document.createElement('button');
    btnAnular.className = 'btn btn-danger btn-full';
    btnAnular.textContent = '✕ Anular ticket';
    btnAnular.addEventListener('click', () => anularVenta(id));
    detalleActions.appendChild(btnAnular);
  }

  overlay.classList.remove('hidden');
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

  const rows = [['#','Fecha','Items','Medio','Descuento','Total','Estado']];
  allVentas.forEach((v, i) => {
    const fecha = new Date(v.fecha).toLocaleString('es-AR');
    rows.push([
      i + 1,
      fecha,
      (v.items_venta || []).length,
      v.medio_pago || '',
      v.descuento || 0,
      v.total || 0,
      v.estado || ''
    ]);
  });

  const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `tickets_${hoy()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

async function init() {
  if (!await checkAuth()) return;

  setFiltroFechas(startOfMonth(), hoy());

  document.getElementById('btn-hoy').addEventListener('click', () => { setFiltroFechas(hoy(), hoy()); cargarVentas(); });
  document.getElementById('btn-semana').addEventListener('click', () => { setFiltroFechas(startOfWeek(), hoy()); cargarVentas(); });
  document.getElementById('btn-mes').addEventListener('click', () => { setFiltroFechas(startOfMonth(), hoy()); cargarVentas(); });

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
