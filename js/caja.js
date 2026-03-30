import { supabase, getCajaHoy, abrirCaja, cerrarCaja, formatMoney, formatDate, showToast } from './supabase.js';
import { checkAuth } from './auth.js';

let cajaActual = null;

async function init() {
  const session = await checkAuth();
  if (!session) return;

  await cargarCaja();
  await cargarHistorial();
}

async function cargarCaja() {
  const container = document.getElementById('caja-container');
  container.innerHTML = `<div class="loading"><div class="spinner"></div> Cargando...</div>`;

  const { data: caja } = await getCajaHoy();
  cajaActual = caja;

  if (!caja || caja.estado === 'cerrada') {
    mostrarApertura();
  } else {
    await mostrarResumen(caja);
  }
}

function mostrarApertura() {
  const container = document.getElementById('caja-container');
  container.innerHTML = `
    <div class="card" style="max-width:480px;margin:0 auto">
      <div class="card-title">Apertura de caja</div>
      <p style="color:var(--text-muted);font-size:13px;margin-bottom:20px">
        No hay caja abierta para hoy. Ingresá el efectivo inicial para comenzar.
      </p>
      <form id="form-apertura">
        <div class="form-group">
          <label>Efectivo inicial en caja ($)</label>
          <input type="number" class="input" id="efectivo-inicial" min="0" step="0.01"
            placeholder="0.00" required style="font-size:20px;font-family:'Syne',sans-serif;text-align:center">
        </div>
        <div class="form-group">
          <label>Notas (opcional)</label>
          <textarea class="input" id="apertura-notas" rows="2" placeholder="Observaciones de apertura..."></textarea>
        </div>
        <button type="submit" class="btn btn-primary btn-lg btn-full">
          💰 Abrir caja
        </button>
      </form>
    </div>`;

  document.getElementById('form-apertura').addEventListener('submit', async (e) => {
    e.preventDefault();
    const efectivo = parseFloat(document.getElementById('efectivo-inicial').value) || 0;
    const notas = document.getElementById('apertura-notas').value;
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Abriendo...';

    const { data, error } = await abrirCaja(efectivo, notas || null);
    if (error) {
      showToast('Error al abrir caja: ' + error.message, 'error');
      btn.disabled = false;
      btn.textContent = '💰 Abrir caja';
      return;
    }
    showToast('¡Caja abierta! Efectivo inicial: ' + formatMoney(efectivo), 'success');
    cajaActual = data;
    await mostrarResumen(data);
    await cargarHistorial();
  });
}

async function mostrarResumen(caja) {
  const container = document.getElementById('caja-container');

  // Cargar ventas del día
  const { data: ventas } = await supabase
    .from('ventas')
    .select('total, medio_pago, fecha')
    .eq('caja_id', caja.id);

  const ventas_list = ventas || [];
  const total_ventas = ventas_list.reduce((s, v) => s + Number(v.total), 0);

  const por_medio = ventas_list.reduce((acc, v) => {
    acc[v.medio_pago] = (acc[v.medio_pago] || 0) + Number(v.total);
    return acc;
  }, {});

  const efectivo_esperado = Number(caja.efectivo_inicial) + (por_medio.efectivo || 0);

  const medioLabels = { efectivo: '💵 Efectivo', debito: '💳 Débito', credito: '💳 Crédito', transferencia: '📲 Transferencia' };

  container.innerHTML = `
    <div class="kpi-grid" style="margin-bottom:20px">
      <div class="kpi-card">
        <div class="kpi-label">Ventas del día</div>
        <div class="kpi-value">${ventas_list.length}</div>
        <div class="kpi-sub">tickets</div>
      </div>
      <div class="kpi-card amber">
        <div class="kpi-label">Total facturado</div>
        <div class="kpi-value">${formatMoney(total_ventas)}</div>
        <div class="kpi-sub">en ${ventas_list.length} venta${ventas_list.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="kpi-card green">
        <div class="kpi-label">Efectivo esperado</div>
        <div class="kpi-value">${formatMoney(efectivo_esperado)}</div>
        <div class="kpi-sub">inicial + efectivo</div>
      </div>
      <div class="kpi-card blue">
        <div class="kpi-label">Efectivo inicial</div>
        <div class="kpi-value">${formatMoney(caja.efectivo_inicial)}</div>
        <div class="kpi-sub">apertura ${caja.fecha}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 340px;gap:20px;align-items:start">
      <div class="card">
        <div class="card-title">Breakdown por medio de pago</div>
        ${Object.keys(medioLabels).map(m => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
            <span style="color:var(--text-muted)">${medioLabels[m]}</span>
            <span style="font-family:'Syne',sans-serif;font-weight:600">${formatMoney(por_medio[m] || 0)}</span>
          </div>`).join('')}
        <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0 0">
          <span style="font-weight:600">TOTAL</span>
          <span style="font-family:'Syne',sans-serif;font-weight:800;font-size:18px;color:var(--teal)">${formatMoney(total_ventas)}</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title">Cerrar caja</div>
        <form id="form-cierre">
          <div class="form-group">
            <label>Efectivo físico contado ($)</label>
            <input type="number" class="input" id="efectivo-final" min="0" step="0.01"
              placeholder="0.00" required style="font-size:18px;font-family:'Syne',sans-serif;text-align:center">
          </div>
          <div id="diferencia-preview" style="padding:10px;border-radius:8px;background:var(--surface-2);text-align:center;margin-bottom:14px;display:none">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">DIFERENCIA</div>
            <div id="diferencia-valor" style="font-family:'Syne',sans-serif;font-size:20px;font-weight:700"></div>
          </div>
          <div class="form-group">
            <label>Comentarios</label>
            <textarea class="input" id="cierre-comentarios" rows="2" placeholder="Observaciones..."></textarea>
          </div>
          <button type="submit" class="btn btn-danger btn-full">
            🔒 Cerrar caja
          </button>
        </form>
      </div>
    </div>`;

  // Preview diferencia
  document.getElementById('efectivo-final').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    if (isNaN(val)) { document.getElementById('diferencia-preview').style.display = 'none'; return; }
    const diff = val - efectivo_esperado;
    const el = document.getElementById('diferencia-preview');
    const valEl = document.getElementById('diferencia-valor');
    el.style.display = 'block';
    valEl.textContent = (diff >= 0 ? '+' : '') + formatMoney(diff);
    valEl.style.color = diff === 0 ? 'var(--green)' : diff > 0 ? 'var(--amber)' : 'var(--red)';
  });

  // Form cierre
  document.getElementById('form-cierre').addEventListener('submit', async (e) => {
    e.preventDefault();
    const efectivo_final = parseFloat(document.getElementById('efectivo-final').value) || 0;
    const comentarios = document.getElementById('cierre-comentarios').value;
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    btn.textContent = 'Cerrando...';

    const { data, error } = await cerrarCaja(caja.id, efectivo_final, comentarios || null);
    if (error) {
      showToast('Error al cerrar caja: ' + error.message, 'error');
      btn.disabled = false;
      btn.textContent = '🔒 Cerrar caja';
      return;
    }
    showToast('¡Caja cerrada correctamente!', 'success');
    cajaActual = data;
    await cargarHistorial();
    mostrarApertura();
  });
}

async function cargarHistorial() {
  const { data } = await supabase
    .from('cajas')
    .select('*')
    .order('fecha', { ascending: false })
    .limit(30);

  const tbody = document.getElementById('historial-tbody');
  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-dim);padding:24px">Sin historial</td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(c => {
    const diff = c.diferencia;
    const diffClass = diff == null ? '' : diff === 0 ? 'badge-green' : diff > 0 ? 'badge-amber' : 'badge-red';
    const diffText = diff == null ? '—' : (diff >= 0 ? '+' : '') + formatMoney(diff);
    const estadoBadge = c.estado === 'abierta'
      ? '<span class="badge badge-teal">Abierta</span>'
      : '<span class="badge badge-green">Cerrada</span>';
    return `
      <tr>
        <td>${c.fecha}</td>
        <td>${formatMoney(c.efectivo_inicial)}</td>
        <td>${formatMoney(c.total_ventas_dia)}</td>
        <td>${formatMoney(c.efectivo_final)}</td>
        <td><span class="badge ${diffClass}">${diffText}</span></td>
        <td>${estadoBadge}</td>
        <td style="color:var(--text-dim);font-size:12px">${c.comentarios || '—'}</td>
      </tr>`;
  }).join('');
}

init();
