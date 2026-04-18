import { supabase, formatMoney } from './supabase.js';
import { checkAuth } from './auth.js';

const SENSITIVE = ['kpi-ventas-hoy', 'kpi-ventas-mes', 'kpi-ganancia'];
const valorReal = {};
let hidden = sessionStorage.getItem('kpi_hidden') !== 'false';

const PER_PAGE = 10;
let stockData = [];
let ventasMes = [];
let filtroStock = '';
let filtroTexto = '';
let filtroCat   = '';
let pagina = 0;

async function init() {
  const session = await checkAuth();
  if (!session) return;

  applyKpiVisibility(hidden);

  document.getElementById('eye-btn').addEventListener('click', () => {
    hidden = !hidden;
    sessionStorage.setItem('kpi_hidden', String(hidden));
    applyKpiVisibility(hidden);
  });

  const hoy = new Date().toLocaleDateString('es-AR', { day: 'numeric', month: 'long' });
  document.getElementById('resumen-fecha').textContent = hoy + ' · cierre parcial';

  const mes = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  document.getElementById('chart-title').textContent =
    'Ventas — ' + mes.charAt(0).toUpperCase() + mes.slice(1);
  document.getElementById('cat-periodo').textContent =
    mes.charAt(0).toUpperCase() + mes.slice(1);

  await Promise.all([cargarKPIs(), cargarStockTable(), cargarAlertas(), cargarCategorias(), verificarCaja(), cargarParaHoy()]);

  bindStockFilters();

  supabase.channel('dash')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'ventas' }, cargarKPIs)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => {
      cargarStockTable(); cargarKPIs(); cargarAlertas();
    })
    .subscribe();
}

function applyKpiVisibility(hide) {
  SENSITIVE.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = hide ? '••••••' : (valorReal[id] || '—');
  });
  const btn = document.getElementById('eye-btn');
  if (btn) btn.textContent = hide ? '👁' : '👁‍🗨';
}

async function cargarKPIs() {
  const hoy  = new Date().toISOString().split('T')[0];
  const ayer = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

  const [{ data: vHoy }, { data: vAyer }, { data: vMes }, { data: itemsHoy }, { data: pltHoy }, { data: alqHoy }] = await Promise.all([
    supabase.from('ventas').select('total,medio_pago').gte('fecha', hoy+'T00:00:00').lte('fecha', hoy+'T23:59:59'),
    supabase.from('ventas').select('total').gte('fecha', ayer+'T00:00:00').lte('fecha', ayer+'T23:59:59'),
    supabase.from('ventas').select('total,fecha').gte('fecha', inicioMes),
    supabase.from('items_venta').select('cantidad,precio_unitario,subtotal,producto_id,productos(nombre,precio_costo,categoria)').gte('created_at', hoy+'T00:00:00'),
    supabase.from('pedidos_plantillas').select('precio').eq('estado','entregado').gte('updated_at', hoy+'T00:00:00').lte('updated_at', hoy+'T23:59:59'),
    supabase.from('alquileres').select('precio_por_dia,fecha_inicio,fecha_devolucion').eq('estado','devuelto').gte('fecha_devolucion', hoy+'T00:00:00').lte('fecha_devolucion', hoy+'T23:59:59'),
  ]);

  ventasMes = vMes || [];
  const totalHoy  = (vHoy || []).reduce((s, v) => s + Number(v.total), 0);
  const totalAyer = (vAyer || []).reduce((s, v) => s + Number(v.total), 0);
  const totalMes  = ventasMes.reduce((s, v) => s + Number(v.total), 0);
  const ticketsHoy = (vHoy || []).length;
  const ticketsMes = ventasMes.length;

  let costoHoy = 0, gananciaBruta = 0;
  const prodQty = {};
  let topProdNombre = '—', topProdQty = 0;
  const mediosPago = {};

  (itemsHoy || []).forEach(it => {
    const costoConIva = Number(it.productos?.precio_costo || 0) * 1.21;
    costoHoy += costoConIva * it.cantidad;
    gananciaBruta += (Number(it.precio_unitario) - costoConIva) * it.cantidad;
    const pid = it.producto_id, nom = it.productos?.nombre || '';
    prodQty[pid] = (prodQty[pid] || { nom, qty: 0 });
    prodQty[pid].qty += it.cantidad;
    if (prodQty[pid].qty > topProdQty) { topProdQty = prodQty[pid].qty; topProdNombre = nom; }
  });

  const ingresosPlantillas = (pltHoy || []).reduce((s, p) => s + Number(p.precio || 0), 0);
  const ingresosAlquileres = (alqHoy || []).reduce((s, a) => {
    const dias = Math.max(1, Math.ceil((new Date(a.fecha_devolucion) - new Date(a.fecha_inicio)) / 86400000));
    return s + Number(a.precio_por_dia || 0) * dias;
  }, 0);
  gananciaBruta += ingresosPlantillas + ingresosAlquileres;

  (vHoy || []).forEach(v => {
    const mp = v.medio_pago || 'otro';
    mediosPago[mp] = (mediosPago[mp] || 0) + Number(v.total);
  });

  const margenHoy = totalHoy > 0 ? Math.round((gananciaBruta / totalHoy) * 100) : 0;
  const deltaHoy = totalAyer > 0 ? ((totalHoy - totalAyer) / totalAyer * 100).toFixed(1) : null;

  valorReal['kpi-ventas-hoy'] = formatMoney(totalHoy);
  valorReal['kpi-ventas-mes'] = formatMoney(totalMes);
  valorReal['kpi-ganancia']   = formatMoney(gananciaBruta);

  applyKpiVisibility(hidden);

  const subHoy = deltaHoy !== null
    ? `<span class="change ${Number(deltaHoy) >= 0 ? 'ch-up' : 'ch-dn'}">${Number(deltaHoy) >= 0 ? '▲' : '▼'} ${Math.abs(deltaHoy)}%</span> vs ayer`
    : `${ticketsHoy} ticket${ticketsHoy !== 1 ? 's' : ''}`;
  document.getElementById('kpi-sub-hoy').innerHTML = subHoy;
  document.getElementById('kpi-sub-mes').textContent = `${ticketsMes} tickets este mes`;
  document.getElementById('kpi-sub-margen').textContent = `Margen promedio ${margenHoy}%`;
  document.getElementById('kpi-tickets-mes').textContent = ticketsMes;
  document.getElementById('kpi-sub-tickets').textContent = 'Este mes';

  const { data: prods } = await supabase.from('productos').select('stock_actual,stock_minimo').eq('activo', true);
  const critCount = (prods || []).filter(p => p.stock_actual <= p.stock_minimo).length;
  document.getElementById('kpi-stock-crit').textContent = critCount;

  cargarGrafico(ventasMes);
  cargarResumenDia({ totalHoy, ticketsHoy, costoHoy, gananciaBruta, margenHoy, mediosPago, topProdNombre, topProdQty, ingresosPlantillas, ingresosAlquileres });
}

function cargarGrafico(ventas) {
  const hoy = new Date();
  const año = hoy.getFullYear(), mes = hoy.getMonth(), diaHoy = hoy.getDate();
  const diasMes = new Date(año, mes + 1, 0).getDate();
  const porDia = {};
  ventas.forEach(v => { const d = new Date(v.fecha).getDate(); porDia[d] = (porDia[d] || 0) + Number(v.total); });
  const vals = Array.from({ length: diasMes }, (_, i) => porDia[i + 1] || 0);
  const maxVal = Math.max(...vals, 1);
  const diasConVentas = vals.filter(v => v > 0).length || 1;
  const totalAcum = vals.reduce((s, v) => s + v, 0);
  const promedio = totalAcum / diasConVentas;
  const proyeccion = promedio * diasMes;

  let mejorDia = 1, mejorMonto = 0;
  vals.forEach((v, i) => { if (v > mejorMonto) { mejorMonto = v; mejorDia = i + 1; } });
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];

  document.getElementById('cf-mejor-dia').textContent = `${mejorDia} ${meses[mes]}`;
  document.getElementById('cf-mejor-monto').textContent = formatMoney(mejorMonto);
  document.getElementById('cf-promedio').textContent = formatMoney(promedio);
  document.getElementById('cf-dias-habil').textContent = `${diasConVentas} día${diasConVentas !== 1 ? 's' : ''}`;
  document.getElementById('cf-proyeccion').textContent = formatMoney(proyeccion);
  document.getElementById('cf-proy-delta').textContent = proyeccion > totalAcum ? '▲ proyectado' : '≈ en curso';

  const container = document.getElementById('bar-chart-mes');
  container.innerHTML = vals.map((v, i) => {
    const d = i + 1, pct = Math.round((v / maxVal) * 100);
    return `<div class="bc-col" title="${d}/${mes+1}: ${formatMoney(v)}">
      <div class="bc-bar${d === diaHoy ? ' today' : ''}" style="height:${pct}%"></div>
      <div class="bc-label">${d % 5 === 1 || d === diasMes ? d : ''}</div>
    </div>`;
  }).join('');
}

function cargarResumenDia({ totalHoy, ticketsHoy, costoHoy, gananciaBruta, margenHoy, mediosPago, topProdNombre, topProdQty, ingresosPlantillas = 0, ingresosAlquileres = 0 }) {
  document.getElementById('res-tickets').textContent   = ticketsHoy;
  document.getElementById('res-facturado').textContent = formatMoney(totalHoy);
  document.getElementById('res-costo').textContent     = formatMoney(costoHoy);
  document.getElementById('res-ganancia').textContent  = formatMoney(gananciaBruta);
  document.getElementById('res-margen').textContent    = margenHoy + '%';
  const extraEl = document.getElementById('res-extra-servicios');
  if (extraEl) {
    if (ingresosPlantillas > 0 || ingresosAlquileres > 0) {
      const partes = [];
      if (ingresosPlantillas > 0) partes.push(`Plantillas: ${formatMoney(ingresosPlantillas)}`);
      if (ingresosAlquileres > 0) partes.push(`Alquileres: ${formatMoney(ingresosAlquileres)}`);
      extraEl.closest('.sum-row').style.display = '';
      extraEl.textContent = partes.join(' · ');
    } else {
      extraEl.closest('.sum-row').style.display = 'none';
    }
  }
  document.getElementById('res-top-prod').textContent  = topProdQty > 0 ? `${topProdNombre} (${topProdQty}u.)` : '—';

  const mpLabels = { efectivo: ['b-green','Efect.'], debito: ['b-blue','Déb.'], credito: ['b-purple','Créd.'], transferencia: ['b-blue','Transf.'] };
  const mediosEl = document.getElementById('res-medios-pago');
  if (Object.keys(mediosPago).length === 0) {
    mediosEl.innerHTML = '<span style="color:var(--text-3);font-size:12px">Sin ventas</span>';
  } else {
    mediosEl.innerHTML = Object.entries(mediosPago)
      .sort((a, b) => b[1] - a[1])
      .map(([mp, val]) => {
        const [cls, lbl] = mpLabels[mp] || ['b-gray', mp];
        const k = val >= 1000 ? `$${Math.round(val/1000)}k` : formatMoney(val);
        return `<span class="badge ${cls}">${lbl} ${k}</span>`;
      }).join('');
  }
}

async function cargarStockTable() {
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const [{ data: prods }, { data: items }] = await Promise.all([
    supabase.from('productos').select('id,nombre,sku,categoria,stock_actual,stock_minimo,precio_venta,precio_costo').eq('activo', true).order('stock_actual'),
    supabase.from('items_venta').select('producto_id,cantidad').gte('created_at', inicioMes),
  ]);

  const vendidosMes = {};
  (items || []).forEach(it => { vendidosMes[it.producto_id] = (vendidosMes[it.producto_id] || 0) + it.cantidad; });

  stockData = (prods || []).map(p => ({ ...p, vendidos: vendidosMes[p.id] || 0 }));

  const cats = [...new Set(stockData.map(p => p.categoria))].sort();
  const sel = document.getElementById('dash-cat-sel');
  sel.innerHTML = '<option value="">Todas las categorías</option>' +
    cats.map(c => `<option value="${c}">${c}</option>`).join('');

  actualizarCounts();
  renderStockTable();
}

function filtrarStock() {
  let lista = stockData;
  if (filtroCat)   lista = lista.filter(p => p.categoria === filtroCat);
  if (filtroTexto) {
    const q = filtroTexto.toLowerCase();
    lista = lista.filter(p => p.nombre.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q));
  }
  if (filtroStock === 'critico') lista = lista.filter(p => p.stock_actual <= p.stock_minimo);
  if (filtroStock === 'sin')     lista = lista.filter(p => p.stock_actual === 0);
  return lista;
}

function actualizarCounts() {
  document.getElementById('count-todos').textContent     = stockData.length;
  document.getElementById('count-criticos').textContent  = stockData.filter(p => p.stock_actual <= p.stock_minimo).length;
  document.getElementById('count-sin').textContent       = stockData.filter(p => p.stock_actual === 0).length;
}

function renderStockTable() {
  const lista = filtrarStock();
  const total = lista.length;
  const inicio = pagina * PER_PAGE;
  const page = lista.slice(inicio, inicio + PER_PAGE);

  document.getElementById('dash-stock-info').textContent =
    total === 0 ? 'Sin productos' : `Mostrando ${inicio + 1}–${Math.min(inicio + PER_PAGE, total)} de ${total}`;
  document.getElementById('dash-pg-prev').disabled = pagina === 0;
  document.getElementById('dash-pg-next').disabled = inicio + PER_PAGE >= total;

  const catColors = ['b-blue','b-purple','b-amber','b-green','b-gray','b-red'];
  const catMap = {};
  [...new Set(stockData.map(p => p.categoria))].sort().forEach((c, i) => { catMap[c] = catColors[i % catColors.length]; });

  const tbody = document.getElementById('dash-stock-tbody');
  if (page.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-3)">Sin productos</td></tr>`;
    return;
  }

  tbody.innerHTML = page.map(p => {
    const costoReal = p.precio_costo * 1.21;
    const margen = p.precio_costo > 0
      ? Math.round(((p.precio_venta - costoReal) / p.precio_venta) * 100) : 0;
    const maxS = Math.max(p.stock_actual, p.stock_minimo * 3, 1);
    const fillPct = Math.min(100, Math.round((p.stock_actual / maxS) * 100));
    let sColor, fillColor;
    if (p.stock_actual === 0) { sColor = 'var(--red)'; fillColor = 'var(--red)'; }
    else if (p.stock_actual <= p.stock_minimo) { sColor = 'var(--red)'; fillColor = 'var(--red)'; }
    else if (p.stock_actual <= p.stock_minimo * 1.5) { sColor = 'var(--amber)'; fillColor = 'var(--amber)'; }
    else { sColor = 'var(--green)'; fillColor = 'var(--green)'; }

    return `<tr>
      <td><div style="font-weight:500">${p.nombre}</div><div class="mono">${p.sku}</div></td>
      <td><span class="badge ${catMap[p.categoria] || 'b-gray'}">${p.categoria}</span></td>
      <td><div class="stk"><strong style="color:${sColor};width:24px;text-align:right">${p.stock_actual}</strong><div class="stk-bar"><div class="stk-fill" style="width:${fillPct}%;background:${fillColor}"></div></div></div></td>
      <td style="color:var(--text-3)">${p.stock_minimo}</td>
      <td style="font-weight:500">${formatMoney(p.precio_venta)}</td>
      <td><span class="badge ${margen >= 50 ? 'b-green' : margen >= 30 ? 'b-amber' : 'b-red'}">${margen}%</span></td>
      <td style="font-weight:600;color:var(--brand)">${p.vendidos > 0 ? p.vendidos + ' u.' : '—'}</td>
    </tr>`;
  }).join('');
}

function bindStockFilters() {
  document.getElementById('dash-stock-search').addEventListener('input', e => {
    filtroTexto = e.target.value.trim(); pagina = 0; renderStockTable();
  });
  document.getElementById('dash-cat-sel').addEventListener('change', e => {
    filtroCat = e.target.value; pagina = 0; renderStockTable();
  });
  ['fchip-todos','fchip-criticos','fchip-sinstk'].forEach(id => {
    document.getElementById(id).addEventListener('click', function() {
      document.querySelectorAll('.dash-filter-row .fchip').forEach(c => c.classList.remove('on'));
      this.classList.add('on');
      filtroStock = id === 'fchip-todos' ? '' : id === 'fchip-criticos' ? 'critico' : 'sin';
      pagina = 0; renderStockTable();
    });
  });
  document.getElementById('dash-pg-prev').addEventListener('click', () => { if (pagina > 0) { pagina--; renderStockTable(); } });
  document.getElementById('dash-pg-next').addEventListener('click', () => { pagina++; renderStockTable(); });
}

async function cargarAlertas() {
  const alertas = [];
  const hoy = new Date().toISOString().split('T')[0];

  const [{ data: prods }, { data: caja }, { data: factPend }] = await Promise.all([
    supabase.from('productos').select('nombre,stock_actual,stock_minimo,categoria').eq('activo', true),
    supabase.from('cajas').select('estado').eq('fecha', hoy).maybeSingle(),
    supabase.from('facturas').select('proveedor,total').eq('estado','pendiente').limit(5),
  ]);

  const criticos = (prods || []).filter(p => p.stock_actual <= p.stock_minimo);
  criticos.slice(0, 3).forEach(p => alertas.push({
    color: 'var(--red)',
    texto: `<strong>Stock crítico:</strong> ${p.nombre} — ${p.stock_actual} unidad${p.stock_actual !== 1 ? 'es' : ''}`,
    meta: p.categoria,
  }));
  if (criticos.length > 3) alertas.push({
    color: 'var(--red)',
    texto: `<strong>Stock crítico:</strong> ${criticos.length - 3} producto${criticos.length - 3 > 1 ? 's' : ''} más`,
    meta: 'Ver inventario',
    link: 'inventario.html',
  });

  const bajos = (prods || []).filter(p => p.stock_actual > p.stock_minimo && p.stock_actual <= p.stock_minimo * 1.5);
  if (bajos.length > 0) alertas.push({
    color: 'var(--amber)',
    texto: `<strong>Stock bajo:</strong> ${bajos.length} producto${bajos.length > 1 ? 's' : ''} próximos al mínimo`,
    meta: 'Inventario',
  });

  if (!caja) alertas.push({ color: 'var(--amber)', texto: '<strong>Caja no abierta</strong> hoy', meta: 'Ir a caja', link: 'caja.html' });

  (factPend || []).forEach(f => alertas.push({
    color: 'var(--amber)',
    texto: `<strong>Factura pendiente:</strong> ${f.proveedor || 'Sin proveedor'}${f.total ? ' — ' + formatMoney(f.total) : ''}`,
    meta: 'Sin procesar',
    link: 'facturas.html',
    accion: 'Procesar',
  }));

  const contEl = document.getElementById('alertas-count');
  if (alertas.length > 0) {
    contEl.textContent = alertas.length + ' nuevas';
    contEl.style.display = '';
  } else {
    contEl.style.display = 'none';
  }

  const el = document.getElementById('alertas-container');
  if (alertas.length === 0) {
    el.innerHTML = `<div style="padding:16px 0;text-align:center;color:var(--green)">✅ Sin alertas activas</div>`;
    return;
  }
  el.innerHTML = alertas.map(a => `
    <div class="alert-item">
      <div class="alert-dot" style="background:${a.color}"></div>
      <div style="flex:1;min-width:0">
        <div class="alert-text">${a.texto}</div>
        <div class="alert-meta">${a.meta || ''}</div>
      </div>
      ${a.link ? `<a href="${a.link}" class="btn btn-ghost btn-sm" style="${a.accion ? 'color:var(--amber)' : ''}">${a.accion || 'Ver'}</a>` : ''}
    </div>`).join('');
}

async function cargarCategorias() {
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data } = await supabase
    .from('items_venta')
    .select('subtotal, productos(categoria)')
    .gte('created_at', inicioMes);

  const catMap = {};
  (data || []).forEach(it => {
    const cat = it.productos?.categoria || 'Otros';
    catMap[cat] = (catMap[cat] || 0) + Number(it.subtotal || 0);
  });

  const el = document.getElementById('ventas-categorias');
  const entries = Object.entries(catMap).sort((a, b) => b[1] - a[1]).slice(0, 6);

  if (entries.length === 0) {
    el.innerHTML = '<div style="text-align:center;color:var(--text-3)">Sin ventas este mes</div>';
    return;
  }

  const maxVal = entries[0][1];
  const catFills = ['var(--brand)', 'var(--blue)', 'var(--purple)', 'var(--green)', 'var(--amber)', '#9CA3AF'];
  el.innerHTML = entries.map(([cat, val], i) => `
    <div class="progress-item">
      <div class="progress-header">
        <span class="progress-label">${cat}</span>
        <span class="progress-val">${formatMoney(val)}</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill" style="width:${Math.round((val / maxVal) * 100)}%;background:${catFills[i] || '#9CA3AF'}"></div>
      </div>
    </div>`).join('');
}

async function verificarCaja() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data: caja } = await supabase.from('cajas').select('id,estado').eq('fecha', hoy).maybeSingle();
  if (!caja || caja.estado === 'cerrada') {
    document.getElementById('modal-caja-dash').classList.remove('hidden');
    document.getElementById('btn-ignorar-caja').addEventListener('click', () => {
      document.getElementById('modal-caja-dash').classList.add('hidden');
    });
  }
}

async function cargarParaHoy() {
  const hoy = new Date().toISOString().split('T')[0];
  const el  = document.getElementById('para-hoy-contenido');
  const badge = document.getElementById('para-hoy-badge');

  const [{ data: alquileres }, { data: plantillas }] = await Promise.all([
    supabase
      .from('alquileres')
      .select('id, cliente_nombre, productos(nombre), fecha_fin_prevista, deposito')
      .lte('fecha_fin_prevista', hoy)
      .not('estado', 'eq', 'devuelto'),
    supabase
      .from('pedidos_plantillas')
      .select('id, cliente_nombre, pie, estado, fecha_entrega_estimada')
      .eq('estado', 'listo'),
  ]);

  const items = [];

  (alquileres || []).forEach(a => {
    const venceHoy = a.fecha_fin_prevista === hoy;
    items.push({
      tipo: 'alquiler',
      urgente: !venceHoy, // ya vencido
      titulo: a.cliente_nombre || 'Cliente',
      sub: `${a.productos?.nombre || '—'} · depósito ${formatMoney(a.deposito || 0)}`,
      tag: venceHoy ? '🔔 Vence hoy' : '🔴 Vencido',
      tagColor: venceHoy ? 'var(--amber)' : 'var(--red)',
      href: 'alquileres.html',
    });
  });

  (plantillas || []).forEach(p => {
    items.push({
      tipo: 'plantilla',
      urgente: false,
      titulo: p.cliente_nombre || 'Cliente',
      sub: `Pie ${p.pie || '—'}`,
      tag: '✅ Lista para entregar',
      tagColor: 'var(--green)',
      href: 'plantillas.html',
    });
  });

  if (items.length === 0) {
    el.innerHTML = `<div class="sum-row" style="justify-content:center;color:var(--text-3)">Todo al día — sin pendientes urgentes ✓</div>`;
    return;
  }

  badge.style.display = '';
  badge.className = 'badge b-red';
  badge.textContent = items.length;

  el.innerHTML = items.map(it => `
    <div class="sum-row" style="gap:10px">
      <span style="color:${it.tagColor};font-size:11px;font-weight:600;min-width:110px">${it.tag}</span>
      <span style="flex:1">
        <strong>${it.titulo}</strong>
        <span style="color:var(--text-3);font-size:12px;margin-left:6px">${it.sub}</span>
      </span>
      <a href="${it.href}" class="btn btn-ghost btn-sm">Ver →</a>
    </div>`).join('');
}

init();
