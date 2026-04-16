import { supabase, formatMoney, formatDate, showToast } from './supabase.js';
import { checkAuth } from './auth.js';

let todosPedidos = [];
let filtroEstado = '';
let filtroTexto  = '';

const ESTADOS = {
  relevado:     { label: 'Relevado',       clase: 'estado-relevado',   icon: '📋' },
  en_produccion:{ label: 'En producción',  clase: 'estado-produccion', icon: '⚙️' },
  listo:        { label: 'Listo',          clase: 'estado-listo',      icon: '✅' },
  ajuste:       { label: 'Requiere ajuste',clase: 'estado-ajuste',     icon: '🔧' },
  entregado:    { label: 'Entregado',      clase: 'estado-entregado',  icon: '📦' },
};

// Transiciones válidas desde cada estado
const TRANSICIONES = {
  relevado:      [{ estado:'en_produccion', label:'⚙️ Enviar a producción' }],
  en_produccion: [{ estado:'listo',         label:'✅ Marcar listo' }],
  listo:         [{ estado:'entregado',     label:'📦 Entregar al cliente' }, { estado:'ajuste', label:'🔧 Requiere ajuste' }],
  ajuste:        [{ estado:'en_produccion', label:'⚙️ Volver a producción' }, { estado:'entregado', label:'📦 Entregar igual' }],
  entregado:     [],
};

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const session = await checkAuth();
  if (!session) return;

  const hoy = new Date().toISOString().split('T')[0];
  const en15 = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
  document.getElementById('plt-fecha-pedido').value  = hoy;
  document.getElementById('plt-fecha-entrega').value = en15;

  await cargarPedidos();
  bindEvents();

  supabase.channel('plt-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos_plantillas' }, cargarPedidos)
    .subscribe();
}

// ── Carga ─────────────────────────────────────────────────────────────────────
async function cargarPedidos() {
  const { data, error } = await supabase
    .from('pedidos_plantillas')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) { showToast('Error al cargar pedidos', 'error'); return; }

  todosPedidos = data || [];
  actualizarKPIs();
  renderTabla();
}

function actualizarKPIs() {
  const enProceso   = todosPedidos.filter(p => p.estado === 'relevado' || p.estado === 'en_produccion').length;
  const listos      = todosPedidos.filter(p => p.estado === 'listo').length;
  const ajuste      = todosPedidos.filter(p => p.estado === 'ajuste').length;

  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const entregadosMes = todosPedidos.filter(p =>
    p.estado === 'entregado' && new Date(p.fecha_entrega_real || p.updated_at || p.created_at) >= inicioMes
  );
  const ingresosMes = entregadosMes.reduce((s, p) => s + Number(p.precio || 0), 0);

  document.getElementById('kpi-proceso').textContent    = enProceso;
  document.getElementById('kpi-listos').textContent     = listos;
  document.getElementById('kpi-ajuste').textContent     = ajuste;
  document.getElementById('kpi-entregados').textContent = entregadosMes.length;
  document.getElementById('kpi-ingresos-sub').textContent = formatMoney(ingresosMes);
}

function renderTabla() {
  let lista = todosPedidos;
  if (filtroEstado) lista = lista.filter(p => p.estado === filtroEstado);
  if (filtroTexto) {
    const q = filtroTexto.toLowerCase();
    lista = lista.filter(p =>
      p.cliente_nombre?.toLowerCase().includes(q) ||
      p.proveedor?.toLowerCase().includes(q) ||
      p.tipo?.toLowerCase().includes(q) ||
      p.nro_orden?.toLowerCase().includes(q)
    );
  }

  const tbody = document.getElementById('plt-tbody');

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center;color:var(--text-dim);padding:32px">Sin pedidos</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map((p, idx) => {
    const est = ESTADOS[p.estado] || ESTADOS.relevado;
    const senaHtml = p.sena > 0
      ? `<div style="font-size:11px;color:var(--text-muted)">Seña: ${formatMoney(p.sena)}</div>`
      : '';

    // Alerta si está listo hace más de 7 días sin entregar
    let alertaListo = '';
    if (p.estado === 'listo' && p.updated_at) {
      const diasEsperando = Math.floor((Date.now() - new Date(p.updated_at)) / 86400000);
      if (diasEsperando >= 7) {
        alertaListo = `<span style="color:var(--amber);font-size:10px;display:block">${diasEsperando}d esperando</span>`;
      }
    }

    return `
      <tr>
        <td style="text-align:center;font-size:12px;color:var(--text-muted);font-weight:600">${idx + 1}</td>
        <td>
          <div style="font-weight:500">${p.cliente_nombre}</div>
          <div style="font-size:11px;color:var(--text-dim)">${p.cliente_telefono || ''}</div>
        </td>
        <td style="font-size:12px;color:var(--brand);font-weight:600">${p.nro_orden || '—'}</td>
        <td style="font-size:12px;text-transform:capitalize">${p.pie || '—'}</td>
        <td>
          <div style="font-size:12px">${p.tipo || '—'}</div>
          <div style="font-size:11px;color:var(--text-dim)">${p.talle ? 'T. ' + p.talle : ''}</div>
        </td>
        <td style="font-size:12px;color:var(--teal)">${p.proveedor || '—'}</td>
        <td>
          <span class="badge ${est.clase}">${est.icon} ${est.label}</span>
          ${alertaListo}
        </td>
        <td style="font-size:12px">${p.fecha_pedido ? formatDate(p.fecha_pedido) : '—'}</td>
        <td style="font-size:12px">${p.fecha_entrega_prevista ? formatDate(p.fecha_entrega_prevista) : '—'}</td>
        <td>
          <div style="font-weight:600">${formatMoney(p.precio)}</div>
          ${senaHtml}
        </td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="window.abrirDetallePlt('${p.id}')">Ver</button>
        </td>
      </tr>`;
  }).join('');
}

// ── Detalle ───────────────────────────────────────────────────────────────────
window.abrirDetallePlt = (id) => {
  const p = todosPedidos.find(x => x.id === id);
  if (!p) return;

  const est = ESTADOS[p.estado] || ESTADOS.relevado;
  document.getElementById('detalle-plt-titulo').textContent = `${est.icon} ${p.cliente_nombre}`;

  const waLink = p.cliente_telefono
    ? (() => {
        const tel = p.cliente_telefono.replace(/\D/g, '');
        const num = tel.startsWith('0') ? '54' + tel.slice(1) : tel.startsWith('54') ? tel : '54' + tel;
        const nOrden = p.nro_orden ? ` (N° ${p.nro_orden})` : '';
        const msg = encodeURIComponent(`Hola ${p.cliente_nombre}! Te avisamos que tus plantillas${nOrden} ya están listas para retirar. Pasá cuando quieras por el local.\n\n🦴 *Ortopedia Caseros*\nValentín Gómez 4784, Caseros\n+54 11 3578-9985`);
        return `https://wa.me/${num}?text=${msg}`;
      })()
    : null;

  document.getElementById('detalle-plt-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">CLIENTE</div><strong>${p.cliente_nombre}</strong></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">TELÉFONO</div>${p.cliente_telefono || '—'}</div>
      ${p.nro_orden ? `<div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">N° ORDEN</div><strong style="color:var(--brand)">${p.nro_orden}</strong></div><div></div>` : ''}
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">PIE</div><span style="text-transform:capitalize">${p.pie || '—'}</span></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">TIPO / TALLE</div>${p.tipo || '—'}${p.talle ? ' · T.' + p.talle : ''}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">PROVEEDOR</div>${p.proveedor || '—'}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">ESTADO</div><span class="badge ${est.clase}">${est.icon} ${est.label}</span></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">PEDIDO</div>${p.fecha_pedido ? formatDate(p.fecha_pedido) : '—'}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">ENTREGA PREVISTA</div>${p.fecha_entrega_prevista ? formatDate(p.fecha_entrega_prevista) : '—'}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">PRECIO</div><strong>${formatMoney(p.precio)}</strong></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">SEÑA</div>${formatMoney(p.sena)}</div>
      ${p.notas ? `<div style="grid-column:1/-1"><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">NOTAS</div><span style="color:var(--text-2)">${p.notas}</span></div>` : ''}
      ${p.fecha_entrega_real ? `<div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">ENTREGADO</div>${formatDate(p.fecha_entrega_real)}</div>` : ''}
    </div>`;

  // Botones de transición de estado
  const transiciones = TRANSICIONES[p.estado] || [];
  document.getElementById('detalle-plt-estados').innerHTML = [
    ...transiciones.map(t =>
      `<button class="btn btn-primary" onclick="window.cambiarEstadoPlt('${p.id}','${t.estado}')">${t.label}</button>`
    ),
    waLink ? `<a href="${waLink}" target="_blank" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">📲 WhatsApp</a>` : '',
  ].filter(Boolean).join('');

  // Borrar
  document.getElementById('btn-borrar-plt').onclick = () => window.borrarPlt(p.id);

  document.getElementById('modal-detalle-plt').classList.remove('hidden');
};

window.cambiarEstadoPlt = async (id, nuevoEstado) => {
  const updates = { estado: nuevoEstado };
  if (nuevoEstado === 'entregado') updates.fecha_entrega_real = new Date().toISOString().split('T')[0];

  const { error } = await supabase.from('pedidos_plantillas').update(updates).eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }

  showToast(`Estado actualizado: ${ESTADOS[nuevoEstado]?.label}`, 'success');
  document.getElementById('modal-detalle-plt').classList.add('hidden');
  cargarPedidos();
};

window.borrarPlt = async (id) => {
  const p = todosPedidos.find(x => x.id === id);
  if (!p) return;
  if (!confirm(`¿Borrar el pedido de ${p.cliente_nombre}? Esta acción no se puede deshacer.`)) return;
  const { error } = await supabase.from('pedidos_plantillas').delete().eq('id', id);
  if (error) { showToast('Error al borrar: ' + error.message, 'error'); return; }
  showToast('Pedido eliminado', 'success');
  document.getElementById('modal-detalle-plt').classList.add('hidden');
  cargarPedidos();
};

// ── Eventos ───────────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-nuevo-pedido').addEventListener('click', () => {
    document.getElementById('form-nuevo-plt').reset();
    const hoy  = new Date().toISOString().split('T')[0];
    const en15 = new Date(Date.now() + 15 * 86400000).toISOString().split('T')[0];
    document.getElementById('plt-fecha-pedido').value  = hoy;
    document.getElementById('plt-fecha-entrega').value = en15;
    document.getElementById('modal-nuevo-plt').classList.remove('hidden');
  });

  document.getElementById('btn-cerrar-nuevo-plt').addEventListener('click', () => {
    document.getElementById('modal-nuevo-plt').classList.add('hidden');
  });
  document.getElementById('btn-cerrar-detalle-plt').addEventListener('click', () => {
    document.getElementById('modal-detalle-plt').classList.add('hidden');
  });

  [document.getElementById('modal-nuevo-plt'), document.getElementById('modal-detalle-plt')].forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
  });

  document.getElementById('filtro-estado-plt').addEventListener('change', e => {
    filtroEstado = e.target.value; renderTabla();
  });

  let timer;
  document.getElementById('busqueda-plt').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { filtroTexto = e.target.value.trim(); renderTabla(); }, 200);
  });

  document.getElementById('form-nuevo-plt').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const pedido = {
      cliente_nombre:         fd.get('cliente_nombre'),
      cliente_telefono:       fd.get('cliente_telefono') || null,
      nro_orden:              fd.get('nro_orden') || null,
      pie:                    fd.get('pie'),
      tipo:                   fd.get('tipo') || null,
      talle:                  fd.get('talle') || null,
      proveedor:              fd.get('proveedor') || null,
      precio:                 parseFloat(fd.get('precio')) || 0,
      sena:                   parseFloat(fd.get('sena')) || 0,
      notas:                  fd.get('notas') || null,
      fecha_pedido:           fd.get('fecha_pedido'),
      fecha_entrega_prevista: fd.get('fecha_entrega_prevista') || null,
      estado:                 'relevado',
    };

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    const { error } = await supabase.from('pedidos_plantillas').insert(pedido);
    btn.disabled = false;

    if (error) { showToast('Error: ' + error.message, 'error'); return; }
    showToast('Pedido registrado', 'success');
    document.getElementById('modal-nuevo-plt').classList.add('hidden');
    cargarPedidos();
  });
}

init();
