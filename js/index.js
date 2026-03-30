import { supabase, formatMoney } from './supabase.js';
import { checkAuth } from './auth.js';

async function init() {
  const session = await checkAuth();
  if (!session) return;

  await Promise.all([
    cargarKPIs(),
    cargarStockCritico(),
    cargarTopProductos(),
    cargarAlertas(),
    cargarClima(),
    verificarCaja(),
  ]);

  // Realtime
  supabase.channel('dash-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas' }, () => {
      cargarKPIs();
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => {
      cargarStockCritico();
      cargarKPIs();
      cargarAlertas();
    })
    .subscribe();
}

async function cargarKPIs() {
  const hoy = new Date().toISOString().split('T')[0];
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  // Ventas hoy
  const { data: ventasHoy } = await supabase
    .from('ventas')
    .select('total')
    .gte('fecha', hoy + 'T00:00:00')
    .lte('fecha', hoy + 'T23:59:59');

  const totalHoy = (ventasHoy || []).reduce((s, v) => s + Number(v.total), 0);
  document.getElementById('kpi-ventas-hoy').textContent = formatMoney(totalHoy);
  document.getElementById('kpi-tickets-hoy').textContent = `${(ventasHoy || []).length} ticket${(ventasHoy || []).length !== 1 ? 's' : ''}`;

  // Ventas del mes
  const { data: ventasMes } = await supabase
    .from('ventas')
    .select('total')
    .gte('fecha', inicioMes);

  const totalMes = (ventasMes || []).reduce((s, v) => s + Number(v.total), 0);
  document.getElementById('kpi-ventas-mes').textContent = formatMoney(totalMes);
  document.getElementById('kpi-tickets-mes').textContent = `${(ventasMes || []).length} ticket${(ventasMes || []).length !== 1 ? 's' : ''}`;

  // Ganancia hoy (necesita items_venta con precio_costo)
  const { data: itemsHoy } = await supabase
    .from('items_venta')
    .select('cantidad, precio_unitario, subtotal, producto_id, productos(precio_costo)')
    .gte('created_at', hoy + 'T00:00:00');

  if (itemsHoy) {
    const ganancia = itemsHoy.reduce((s, item) => {
      const costo = item.productos?.precio_costo || 0;
      return s + (Number(item.precio_unitario) - Number(costo)) * item.cantidad;
    }, 0);
    document.getElementById('kpi-ganancia-hoy').textContent = formatMoney(ganancia);
    const margen = totalHoy > 0 ? Math.round((ganancia / totalHoy) * 100) : 0;
    document.getElementById('kpi-margen-hoy').textContent = `margen ${margen}%`;
  }

  // Stock crítico count
  const { count } = await supabase
    .from('productos')
    .select('id', { count: 'exact', head: true })
    .filter('stock_actual', 'lte', 'stock_minimo');

  // Workaround: Supabase no soporta filter entre columnas directamente
  const { data: prods } = await supabase
    .from('productos')
    .select('stock_actual, stock_minimo')
    .eq('activo', true);
  const crit = (prods || []).filter(p => p.stock_actual <= p.stock_minimo).length;
  document.getElementById('kpi-stock-crit').textContent = crit;

  // Gráfico barras del mes
  cargarGraficoMes(ventasMes || []);

  // Breakdown por medio de pago hoy
  const { data: ventasHoyFull } = await supabase
    .from('ventas')
    .select('total, medio_pago')
    .gte('fecha', hoy + 'T00:00:00')
    .lte('fecha', hoy + 'T23:59:59');

  renderBreakdownPago(ventasHoyFull || []);
}

function cargarGraficoMes(ventas) {
  const hoy = new Date();
  const año = hoy.getFullYear();
  const mes = hoy.getMonth();
  const diasEnMes = new Date(año, mes + 1, 0).getDate();
  const diaHoy = hoy.getDate();

  // Agrupar ventas por día
  const porDia = {};
  ventas.forEach(v => {
    const dia = new Date(v.fecha).getDate();
    porDia[dia] = (porDia[dia] || 0) + Number(v.total);
  });

  const valores = Array.from({ length: diasEnMes }, (_, i) => porDia[i + 1] || 0);
  const max = Math.max(...valores, 1);

  const container = document.getElementById('bar-chart-mes');
  container.innerHTML = valores.map((v, i) => {
    const dia = i + 1;
    const pct = Math.round((v / max) * 100);
    const esHoy = dia === diaHoy;
    return `
      <div class="bar-month-item" title="${dia}/${mes + 1}: ${formatMoney(v)}">
        <div class="bar-month-fill ${esHoy ? 'today' : ''}" style="height:${pct}%"></div>
        ${dia % 5 === 1 || dia === diasEnMes ? `<div class="bar-month-label">${dia}</div>` : '<div class="bar-month-label"></div>'}
      </div>`;
  }).join('');
}

function renderBreakdownPago(ventas) {
  const grupos = { efectivo: 0, debito: 0, credito: 0, transferencia: 0 };
  const etiquetas = { efectivo: '💵 Efectivo', debito: '💳 Débito', credito: '🟣 Crédito', transferencia: '📲 Transferencia' };
  ventas.forEach(v => { grupos[v.medio_pago] = (grupos[v.medio_pago] || 0) + Number(v.total); });

  const el = document.getElementById('breakdown-pago');
  const total = Object.values(grupos).reduce((s, v) => s + v, 0);

  if (total === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">📭</div>Sin ventas hoy</div>';
    return;
  }

  el.innerHTML = Object.entries(grupos).map(([medio, monto]) => {
    if (monto === 0) return '';
    const pct = total > 0 ? Math.round((monto / total) * 100) : 0;
    return `
      <div class="pay-row">
        <span>${etiquetas[medio]}</span>
        <span style="display:flex;align-items:center;gap:8px">
          <span style="font-size:11px;color:var(--text-dim)">${pct}%</span>
          <span style="font-weight:600">${formatMoney(monto)}</span>
        </span>
      </div>`;
  }).join('');
}

async function cargarStockCritico() {
  const { data } = await supabase
    .from('productos')
    .select('*')
    .eq('activo', true)
    .order('stock_actual');

  const criticos = (data || []).filter(p => p.stock_actual <= p.stock_minimo);
  const tbody = document.getElementById('stock-crit-tbody');

  if (criticos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--green)">✅ Sin productos en stock crítico</td></tr>`;
    return;
  }

  tbody.innerHTML = criticos.map(p => `
    <tr>
      <td><div style="font-weight:500">${p.nombre}</div></td>
      <td style="font-size:12px;color:var(--text-muted)">${p.sku}</td>
      <td><span class="stock-crit">${p.stock_actual}</span></td>
      <td style="color:var(--text-muted)">${p.stock_minimo}</td>
      <td><span class="badge badge-red">${p.categoria}</span></td>
    </tr>`).join('');
}

async function cargarTopProductos() {
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const { data } = await supabase
    .from('items_venta')
    .select('producto_id, cantidad, subtotal, productos(nombre)')
    .gte('created_at', inicioMes);

  const el = document.getElementById('top-productos');

  if (!data || data.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">📭</div>Sin datos este mes</div>';
    return;
  }

  const agrupado = {};
  data.forEach(item => {
    const id = item.producto_id;
    if (!agrupado[id]) agrupado[id] = { nombre: item.productos?.nombre || 'Desconocido', cantidad: 0, subtotal: 0 };
    agrupado[id].cantidad += item.cantidad;
    agrupado[id].subtotal += Number(item.subtotal);
  });

  const top = Object.values(agrupado)
    .sort((a, b) => b.cantidad - a.cantidad)
    .slice(0, 5);

  el.innerHTML = top.map((p, i) => `
    <div class="top-prod-item">
      <span style="display:flex;align-items:center;gap:8px">
        <span style="color:var(--text-dim);font-size:12px;width:16px">${i + 1}</span>
        <span style="font-weight:500">${p.nombre}</span>
      </span>
      <span style="display:flex;flex-direction:column;align-items:flex-end;gap:2px">
        <span style="font-weight:600;font-size:13px">${formatMoney(p.subtotal)}</span>
        <span style="font-size:11px;color:var(--text-dim)">${p.cantidad} u.</span>
      </span>
    </div>`).join('');
}

async function cargarAlertas() {
  const alertas = [];

  // Stock crítico
  const { data: prods } = await supabase
    .from('productos')
    .select('nombre, stock_actual, stock_minimo')
    .eq('activo', true);

  const criticos = (prods || []).filter(p => p.stock_actual <= p.stock_minimo);
  if (criticos.length > 0) {
    alertas.push({ tipo: 'red', icono: '⚠️', msg: `${criticos.length} producto${criticos.length > 1 ? 's' : ''} con stock crítico` });
  }

  const bajos = (prods || []).filter(p => p.stock_actual > p.stock_minimo && p.stock_actual <= p.stock_minimo * 1.5);
  if (bajos.length > 0) {
    alertas.push({ tipo: 'amber', icono: '📉', msg: `${bajos.length} producto${bajos.length > 1 ? 's' : ''} con stock bajo` });
  }

  // Caja del día
  const hoy = new Date().toISOString().split('T')[0];
  const { data: caja } = await supabase
    .from('cajas')
    .select('estado, efectivo_inicial')
    .eq('fecha', hoy)
    .maybeSingle();

  if (!caja) {
    alertas.push({ tipo: 'amber', icono: '💰', msg: 'Caja no abierta hoy' });
  } else if (caja.estado === 'abierta') {
    alertas.push({ tipo: 'teal', icono: '✅', msg: 'Caja abierta — efectivo inicial: ' + formatMoney(caja.efectivo_inicial) });
  }

  const el = document.getElementById('alertas-container');
  if (alertas.length === 0) {
    el.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">✅</div>Sin alertas activas</div>';
    return;
  }

  const colorMap = { red: 'var(--red)', amber: 'var(--amber)', teal: 'var(--teal)' };
  el.innerHTML = alertas.map(a => `
    <div class="alert-item">
      <span style="font-size:16px">${a.icono}</span>
      <span style="color:${colorMap[a.tipo] || 'var(--text)'}">${a.msg}</span>
    </div>`).join('');
}

async function cargarClima() {
  try {
    const resp = await fetch('https://api.open-meteo.com/v1/forecast?latitude=-34.6037&longitude=-58.5631&current_weather=true&timezone=America%2FArgentina%2FBuenos_Aires');
    const data = await resp.json();
    const { temperature, weathercode } = data.current_weather;
    const { emoji, desc } = climaInfo(weathercode);
    document.getElementById('clima-widget').innerHTML = `
      <span style="font-size:24px">${emoji}</span>
      <div>
        <div style="font-family:'Syne',sans-serif;font-size:18px;font-weight:700;color:var(--text);line-height:1">${Math.round(temperature)}°C</div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${desc} · Caseros</div>
      </div>`;
  } catch (e) {
    document.getElementById('clima-widget').innerHTML = '';
  }
}

function climaInfo(code) {
  if (code === 0)             return { emoji: '☀️', desc: 'Despejado' };
  if (code <= 2)              return { emoji: '🌤️', desc: 'Mayormente despejado' };
  if (code === 3)             return { emoji: '☁️', desc: 'Nublado' };
  if (code <= 48)             return { emoji: '🌫️', desc: 'Neblina' };
  if (code <= 57)             return { emoji: '🌦️', desc: 'Llovizna' };
  if (code <= 67)             return { emoji: '🌧️', desc: 'Lluvia' };
  if (code <= 77)             return { emoji: '🌨️', desc: 'Nieve' };
  if (code <= 82)             return { emoji: '🌦️', desc: 'Lluvioso' };
  return                             { emoji: '⛈️', desc: 'Tormenta' };
}

async function verificarCaja() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data: caja } = await supabase
    .from('cajas').select('id, estado').eq('fecha', hoy).maybeSingle();

  if (!caja || caja.estado === 'cerrada') {
    document.getElementById('modal-caja-dash').classList.remove('hidden');
    document.getElementById('btn-ignorar-caja').addEventListener('click', () => {
      document.getElementById('modal-caja-dash').classList.add('hidden');
    });
  }
}

// ── Buscador rápido ──────────────────────────────────────
let busqTimer;
document.getElementById('buscador-rapido').addEventListener('input', e => {
  clearTimeout(busqTimer);
  const q = e.target.value.trim();
  const res = document.getElementById('buscador-resultados');
  if (!q) { res.style.display = 'none'; return; }
  busqTimer = setTimeout(async () => {
    const { data } = await supabase.from('productos').select('nombre,sku,ean,precio_venta,precio_costo,stock_actual,stock_minimo,categoria')
      .eq('activo', true)
      .or(`nombre.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
      .order('nombre').limit(10);

    if (!data || !data.length) {
      res.style.display = '';
      res.innerHTML = '<div style="padding:14px;color:var(--text-muted);font-size:13px">Sin resultados</div>';
      return;
    }

    res.style.display = '';
    res.innerHTML = data.map(p => {
      const margen = p.precio_costo > 0 ? Math.round(((p.precio_venta - p.precio_costo) / p.precio_venta) * 100) : null;
      const stockClass = p.stock_actual <= p.stock_minimo ? 'stock-crit' : p.stock_actual <= p.stock_minimo * 1.5 ? 'stock-warn' : 'stock-ok';
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 16px;border-bottom:1px solid var(--border);cursor:default" class="search-item">
          <div>
            <div style="font-weight:500;font-size:14px">${p.nombre}</div>
            <div style="font-size:11px;color:var(--text-dim);margin-top:2px">${p.categoria} · ${p.sku}</div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;text-align:right">
            <div>
              <div style="font-family:'Syne',sans-serif;font-weight:700;font-size:15px;color:var(--teal)">${formatMoney(p.precio_venta)}</div>
              ${margen !== null ? `<div style="font-size:11px;color:var(--text-dim)">costo ${formatMoney(p.precio_costo)} · ${margen}%</div>` : ''}
            </div>
            <div class="${stockClass}" style="font-size:13px;white-space:nowrap">${p.stock_actual} u.</div>
          </div>
        </div>`;
    }).join('');
  }, 200);
});

document.addEventListener('click', e => {
  if (!document.getElementById('buscador-rapido').contains(e.target) &&
      !document.getElementById('buscador-resultados').contains(e.target)) {
    document.getElementById('buscador-resultados').style.display = 'none';
  }
});

init();
