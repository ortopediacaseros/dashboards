import { supabase, formatMoney, formatDate, showToast } from './supabase.js';
import { checkAuth } from './auth.js';

let todosAlquileres = [];
let filtroEstado = '';
let filtroTexto  = '';

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const session = await checkAuth();
  if (!session) return;

  // Set default dates
  const hoy = new Date().toISOString().split('T')[0];
  const en7  = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  document.getElementById('alq-fecha-inicio').value = hoy;
  document.getElementById('alq-fecha-fin').value    = en7;

  await cargarAlquileres();
  bindEvents();

  // Realtime
  supabase.channel('alq-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alquileres' }, cargarAlquileres)
    .subscribe();
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function cargarAlquileres() {
  const { data, error } = await supabase
    .from('alquileres')
    .select('*, productos(nombre, sku)')
    .order('fecha_fin_prevista');

  if (error) {
    if (error.code === '42P01') {
      document.getElementById('alq-tbody').innerHTML =
        `<tr><td colspan="8" style="text-align:center;padding:32px;color:var(--text-muted)">
          La tabla <strong>alquileres</strong> todavía no existe en Supabase.<br>
          <span style="font-size:11px;color:var(--text-dim)">Ejecutá el SQL de creación desde el panel de Supabase.</span>
        </td></tr>`;
      return;
    }
    showToast('Error al cargar alquileres', 'error');
    return;
  }

  // Auto-mark overdue
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  todosAlquileres = (data || []).map(a => {
    if (a.estado === 'activo' && new Date(a.fecha_fin_prevista) < hoy) {
      a.estado = 'vencido';
    }
    return a;
  });

  actualizarKPIs();
  renderTabla();
}

function actualizarKPIs() {
  const activos  = todosAlquileres.filter(a => a.estado === 'activo').length;
  const vencidos = todosAlquileres.filter(a => a.estado === 'vencido').length;
  const depositos = todosAlquileres
    .filter(a => a.estado === 'activo' || a.estado === 'vencido')
    .reduce((s, a) => s + Number(a.deposito || 0), 0);

  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const devueltosMes = todosAlquileres.filter(a =>
    a.estado === 'devuelto' &&
    new Date(a.fecha_devolucion || a.updated_at) >= inicioMes
  ).length;

  document.getElementById('kpi-activos').textContent       = activos;
  document.getElementById('kpi-vencidos').textContent      = vencidos;
  document.getElementById('kpi-depositos').textContent     = formatMoney(depositos);
  document.getElementById('kpi-devueltos-mes').textContent = devueltosMes;
}

function renderTabla() {
  let lista = todosAlquileres;
  if (filtroEstado) lista = lista.filter(a => a.estado === filtroEstado);
  if (filtroTexto) {
    const q = filtroTexto.toLowerCase();
    lista = lista.filter(a =>
      a.cliente_nombre?.toLowerCase().includes(q) ||
      a.productos?.nombre?.toLowerCase().includes(q)
    );
  }

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const tbody = document.getElementById('alq-tbody');

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--text-dim);padding:32px">Sin alquileres</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(a => {
    const inicio  = new Date(a.fecha_inicio);
    const fin     = new Date(a.fecha_fin_prevista);
    const diasTotal = Math.ceil((fin - inicio) / 86400000);
    const diasRestantes = Math.ceil((fin - hoy) / 86400000);

    let estadoClass, estadoLabel;
    if (a.estado === 'activo')   { estadoClass = 'alq-estado-activo';   estadoLabel = 'Activo'; }
    else if (a.estado === 'vencido') { estadoClass = 'alq-estado-vencido'; estadoLabel = 'Vencido'; }
    else                          { estadoClass = 'alq-estado-devuelto'; estadoLabel = 'Devuelto'; }

    let diasHtml;
    if (a.estado === 'devuelto') {
      diasHtml = `<span class="dias-badge" style="color:var(--text-3);background:var(--surface-2)">${diasTotal}d</span>`;
    } else if (a.estado === 'vencido') {
      const diasVencido = Math.abs(diasRestantes);
      diasHtml = `<span class="dias-badge" style="color:var(--red);background:var(--red-bg)">+${diasVencido}d vencido</span>`;
    } else {
      diasHtml = diasRestantes > 0
        ? `<span class="dias-badge" style="color:${diasRestantes <= 2 ? 'var(--amber)' : 'var(--text-2)'};background:${diasRestantes <= 2 ? 'var(--amber-bg)' : 'var(--surface-2)'}">${diasRestantes}d restantes</span>`
        : `<span class="dias-badge" style="color:var(--red);background:var(--red-bg)">hoy vence</span>`;
    }

    const acciones = a.estado !== 'devuelto'
      ? `<button class="btn btn-ghost btn-sm" onclick="window.abrirDetalle('${a.id}')">Ver</button>
         <button class="btn btn-secondary btn-sm" onclick="window.marcarDevuelto('${a.id}')">Devuelto</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="window.abrirDetalle('${a.id}')">Ver</button>`;

    return `
      <tr>
        <td>
          <div style="font-weight:500">${a.cliente_nombre}</div>
          <div style="font-size:11px;color:var(--text-dim)">${a.cliente_telefono || ''}</div>
        </td>
        <td>
          <div style="font-weight:500">${a.productos?.nombre || a.producto_nombre || '—'}</div>
          <div style="font-size:11px;color:var(--text-dim)">${a.productos?.sku || ''}</div>
        </td>
        <td style="font-size:12px">${formatDate(a.fecha_inicio)}</td>
        <td style="font-size:12px">${formatDate(a.fecha_fin_prevista)}</td>
        <td>${diasHtml}</td>
        <td style="font-weight:600">${formatMoney(a.deposito)}</td>
        <td><span class="badge dias-badge ${estadoClass}">${estadoLabel}</span></td>
        <td><div style="display:flex;gap:6px">${acciones}</div></td>
      </tr>`;
  }).join('');
}

// ── Detalle ───────────────────────────────────────────────────────────────────
window.abrirDetalle = (id) => {
  const a = todosAlquileres.find(x => x.id === id);
  if (!a) return;

  const content = document.getElementById('detalle-alq-content');
  const actions = document.getElementById('detalle-alq-actions');
  const producto = a.productos?.nombre || a.producto_nombre || '—';

  content.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">CLIENTE</div><strong>${a.cliente_nombre}</strong></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">TELÉFONO</div>${a.cliente_telefono || '—'}</div>
      <div style="grid-column:1/-1"><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">PRODUCTO</div><strong>${producto}</strong></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">INICIO</div>${formatDate(a.fecha_inicio)}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">VENCE</div>${formatDate(a.fecha_fin_prevista)}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">DEPÓSITO</div><strong>${formatMoney(a.deposito)}</strong></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">PRECIO / DÍA</div>${formatMoney(a.precio_por_dia)}</div>
      ${a.fecha_devolucion ? `<div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">DEVUELTO</div>${formatDate(a.fecha_devolucion)}</div>` : ''}
      ${a.notas ? `<div style="grid-column:1/-1"><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">NOTAS</div><span style="color:var(--text-2)">${a.notas}</span></div>` : ''}
    </div>`;

  actions.innerHTML = a.estado !== 'devuelto'
    ? `<button class="btn btn-primary btn-full" onclick="window.marcarDevuelto('${a.id}');document.getElementById('modal-detalle-alq').classList.add('hidden')">✅ Marcar como devuelto</button>`
    : '';

  document.getElementById('modal-detalle-alq').classList.remove('hidden');
};

window.marcarDevuelto = async (id) => {
  const { error } = await supabase
    .from('alquileres')
    .update({ estado: 'devuelto', fecha_devolucion: new Date().toISOString() })
    .eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Alquiler marcado como devuelto', 'success');
  cargarAlquileres();
};

// ── Nuevo alquiler ────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-nuevo-alquiler').addEventListener('click', () => {
    document.getElementById('form-nuevo-alq').reset();
    document.getElementById('alq-producto-id').value = '';
    const hoy = new Date().toISOString().split('T')[0];
    const en7  = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    document.getElementById('alq-fecha-inicio').value = hoy;
    document.getElementById('alq-fecha-fin').value    = en7;
    document.getElementById('modal-nuevo-alq').classList.remove('hidden');
  });

  document.getElementById('btn-cerrar-nuevo-alq').addEventListener('click', () => {
    document.getElementById('modal-nuevo-alq').classList.add('hidden');
  });

  document.getElementById('btn-cerrar-detalle-alq').addEventListener('click', () => {
    document.getElementById('modal-detalle-alq').classList.add('hidden');
  });

  [document.getElementById('modal-nuevo-alq'), document.getElementById('modal-detalle-alq')].forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
  });

  // Filtros
  document.getElementById('filtro-estado').addEventListener('change', e => {
    filtroEstado = e.target.value;
    renderTabla();
  });

  let timer;
  document.getElementById('busqueda-alq').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { filtroTexto = e.target.value.trim(); renderTabla(); }, 200);
  });

  // Búsqueda de producto en el form
  const searchInput = document.getElementById('alq-producto-search');
  const sugerencias = document.getElementById('alq-producto-sugerencias');

  searchInput.addEventListener('input', async () => {
    const q = searchInput.value.trim();
    document.getElementById('alq-producto-id').value = '';
    if (!q) { sugerencias.style.display = 'none'; return; }

    const { data } = await supabase
      .from('productos')
      .select('id, nombre, sku')
      .eq('activo', true)
      .or(`nombre.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(8);

    if (!data || !data.length) { sugerencias.style.display = 'none'; return; }

    sugerencias.style.display = 'block';
    sugerencias.innerHTML = data.map(p => `
      <div style="padding:8px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)"
        onmousedown="event.preventDefault()"
        onclick="window.seleccionarProductoAlq('${p.id}','${p.nombre.replace(/'/g, "\\'")}')">
        <div style="font-weight:500">${p.nombre}</div>
        <div style="font-size:11px;color:var(--text-dim)">${p.sku}</div>
      </div>`).join('');
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => { sugerencias.style.display = 'none'; }, 150);
  });

  // Form submit
  document.getElementById('form-nuevo-alq').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const productoId = document.getElementById('alq-producto-id').value;

    const registro = {
      cliente_nombre:    fd.get('cliente_nombre'),
      cliente_telefono:  fd.get('cliente_telefono') || null,
      producto_id:       productoId || null,
      producto_nombre:   fd.get('producto_nombre'),
      fecha_inicio:      fd.get('fecha_inicio'),
      fecha_fin_prevista:fd.get('fecha_fin_prevista'),
      deposito:          parseFloat(fd.get('deposito')) || 0,
      precio_por_dia:    parseFloat(fd.get('precio_por_dia')) || 0,
      notas:             fd.get('notas') || null,
      estado:            'activo',
    };

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    const { error } = await supabase.from('alquileres').insert(registro);
    btn.disabled = false;

    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('Alquiler registrado', 'success');
    document.getElementById('modal-nuevo-alq').classList.add('hidden');
    cargarAlquileres();
  });
}

window.seleccionarProductoAlq = (id, nombre) => {
  document.getElementById('alq-producto-id').value       = id;
  document.getElementById('alq-producto-search').value   = nombre;
  document.getElementById('alq-producto-sugerencias').style.display = 'none';
};

init();
