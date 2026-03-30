import { supabase, formatMoney, formatDate, showToast } from './supabase.js';
import { checkAuth } from './auth.js';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const tipoReporte   = document.getElementById('tipo-reporte');
const secDiario     = document.getElementById('reporte-diario');
const secMensual    = document.getElementById('reporte-mensual');
const fechaDiario   = document.getElementById('fecha-diario');
const mesSel        = document.getElementById('mes-sel');
const añoSel        = document.getElementById('año-sel');
const kpisDiario    = document.getElementById('kpis-diario');
const kpisMensual   = document.getElementById('kpis-mensual');
const tablaTopProd  = document.getElementById('tabla-top-productos');
const infoCaja      = document.getElementById('info-caja');
const breakdownPago = document.getElementById('breakdown-pago');
const barChart      = document.getElementById('bar-chart');
const tablaCats     = document.getElementById('tabla-categorias');
const comparativa   = document.getElementById('comparativa');
const btnExportCSV  = document.getElementById('btn-exportar-csv');

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const session = await checkAuth();
  if (!session) return;
  const hoy = new Date();
  const yyyy = hoy.getFullYear();
  const mm   = String(hoy.getMonth() + 1).padStart(2, '0');
  const dd   = String(hoy.getDate()).padStart(2, '0');

  if (fechaDiario) fechaDiario.value = `${yyyy}-${mm}-${dd}`;

  // Populate year selector (current year ± 3)
  if (añoSel) {
    añoSel.innerHTML = '';
    for (let y = yyyy - 3; y <= yyyy + 1; y++) {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === yyyy) opt.selected = true;
      añoSel.appendChild(opt);
    }
  }
  if (mesSel) mesSel.value = String(hoy.getMonth() + 1);

  // Event listeners
  tipoReporte?.addEventListener('change', toggleSecciones);
  fechaDiario?.addEventListener('change', cargarReporteDiario);
  mesSel?.addEventListener('change', cargarReporteMensual);
  añoSel?.addEventListener('change', cargarReporteMensual);
  btnExportCSV?.addEventListener('click', exportarCSV);

  toggleSecciones();
}

function toggleSecciones() {
  const tipo = tipoReporte?.value || 'diario';
  if (secDiario)  secDiario.classList.toggle('hidden',  tipo !== 'diario');
  if (secMensual) secMensual.classList.toggle('hidden', tipo !== 'mensual');
  if (tipo === 'diario') cargarReporteDiario();
  else                   cargarReporteMensual();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function dayBounds(dateStr) {
  const dayStart = `${dateStr}T00:00:00`;
  const dayEnd   = `${dateStr}T23:59:59`;
  return { dayStart, dayEnd };
}

function kpiCard(label, value, color = 'var(--teal)') {
  return `
    <div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value" style="color:${color}">${value}</div>
    </div>`;
}

function pct(a, b) {
  if (!b) return '0%';
  return ((a / b) * 100).toFixed(1) + '%';
}

function deltaPct(curr, prev) {
  if (!prev) return '<span class="delta neutral">—</span>';
  const d = ((curr - prev) / prev) * 100;
  const cls = d >= 0 ? 'positive' : 'negative';
  const sign = d >= 0 ? '+' : '';
  return `<span class="delta ${cls}">${sign}${d.toFixed(1)}%</span>`;
}

// ── Daily Report ──────────────────────────────────────────────────────────────
async function cargarReporteDiario() {
  const fecha = fechaDiario?.value;
  if (!fecha) return;

  const { dayStart, dayEnd } = dayBounds(fecha);

  // Fetch ventas with items and products
  const { data: ventas, error } = await supabase
    .from('ventas')
    .select('*, items_venta(*, productos(*))')
    .gte('fecha', dayStart)
    .lte('fecha', dayEnd);

  if (error) { showToast('Error al cargar reporte diario', 'error'); return; }

  const rows = ventas || [];

  // KPIs
  const tickets   = rows.length;
  const totalFac  = rows.reduce((s, v) => s + Number(v.total || 0), 0);
  let   costoTotal = 0;

  const prodCount = {};
  const pagoBrk   = {};

  rows.forEach(v => {
    const mp = v.medio_pago || 'otro';
    pagoBrk[mp] = (pagoBrk[mp] || 0) + Number(v.total || 0);

    (v.items_venta || []).forEach(it => {
      const costo = Number(it.productos?.precio_costo || 0) * Number(it.cantidad || 1);
      costoTotal += costo;

      const pid  = it.producto_id;
      const nom  = it.productos?.nombre || `#${pid}`;
      if (!prodCount[pid]) prodCount[pid] = { nombre: nom, qty: 0, subtotal: 0 };
      prodCount[pid].qty      += Number(it.cantidad || 1);
      prodCount[pid].subtotal += Number(it.subtotal || it.precio_unitario * it.cantidad || 0);
    });
  });

  const gananciaBruta = totalFac - costoTotal;
  const margen        = totalFac > 0 ? (gananciaBruta / totalFac) * 100 : 0;

  if (kpisDiario) {
    kpisDiario.innerHTML =
      kpiCard('Tickets', tickets) +
      kpiCard('Total facturado', formatMoney(totalFac), 'var(--teal)') +
      kpiCard('Costo total', formatMoney(costoTotal), 'var(--red)') +
      kpiCard('Ganancia bruta', formatMoney(gananciaBruta), gananciaBruta >= 0 ? 'var(--green)' : 'var(--red)') +
      kpiCard('Margen', margen.toFixed(1) + '%', 'var(--yellow)');
  }

  // Breakdown por medio de pago
  if (breakdownPago) {
    const total = Object.values(pagoBrk).reduce((s, v) => s + v, 0);
    if (Object.keys(pagoBrk).length === 0) {
      breakdownPago.innerHTML = '<p class="text-muted">Sin ventas para esta fecha.</p>';
    } else {
      breakdownPago.innerHTML = Object.entries(pagoBrk)
        .sort((a, b) => b[1] - a[1])
        .map(([mp, val]) => `
          <div class="breakdown-row">
            <span class="breakdown-label">${capitalize(mp)}</span>
            <div class="breakdown-bar-wrap">
              <div class="breakdown-bar" style="width:${pct(val, total)}"></div>
            </div>
            <span class="breakdown-val">${formatMoney(val)}</span>
            <span class="breakdown-pct">${pct(val, total)}</span>
          </div>`).join('');
    }
  }

  // Top 5 productos
  if (tablaTopProd) {
    const top5 = Object.values(prodCount)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
    if (top5.length === 0) {
      tablaTopProd.innerHTML = '<tr><td colspan="3" class="text-muted center">Sin productos vendidos</td></tr>';
    } else {
      tablaTopProd.innerHTML = top5.map((p, i) => `
        <tr>
          <td>${i + 1}</td>
          <td>${p.nombre}</td>
          <td class="text-right">${p.qty}</td>
          <td class="text-right">${formatMoney(p.subtotal)}</td>
        </tr>`).join('');
    }
  }

  // Caja info
  if (infoCaja) {
    const { data: caja } = await supabase
      .from('cajas')
      .select('*')
      .eq('fecha', fecha)
      .maybeSingle();

    if (!caja) {
      infoCaja.innerHTML = '<p class="text-muted">No hay caja registrada para este día.</p>';
    } else {
      infoCaja.innerHTML = `
        <div class="caja-grid">
          <div class="caja-item"><span>Estado</span><strong class="badge badge-${caja.estado === 'cerrada' ? 'green' : 'yellow'}">${capitalize(caja.estado)}</strong></div>
          <div class="caja-item"><span>Efectivo inicial</span><strong>${formatMoney(caja.efectivo_inicial)}</strong></div>
          <div class="caja-item"><span>Efectivo final</span><strong>${formatMoney(caja.efectivo_final)}</strong></div>
          <div class="caja-item"><span>Total ventas día</span><strong>${formatMoney(caja.total_ventas_dia)}</strong></div>
          <div class="caja-item"><span>Diferencia</span><strong style="color:${(caja.diferencia || 0) >= 0 ? 'var(--green)' : 'var(--red)'}">${formatMoney(caja.diferencia)}</strong></div>
        </div>`;
    }
  }
}

// ── Monthly Report ────────────────────────────────────────────────────────────
async function cargarReporteMensual() {
  const mes  = parseInt(mesSel?.value  || new Date().getMonth() + 1);
  const año  = parseInt(añoSel?.value  || new Date().getFullYear());

  const mesStr   = String(mes).padStart(2, '0');
  const diasMes  = new Date(año, mes, 0).getDate();
  const inicio   = `${año}-${mesStr}-01T00:00:00`;
  const fin      = `${año}-${mesStr}-${String(diasMes).padStart(2, '0')}T23:59:59`;

  const { data: ventas, error } = await supabase
    .from('ventas')
    .select('*, items_venta(*, productos(*))')
    .gte('fecha', inicio)
    .lte('fecha', fin);

  if (error) { showToast('Error al cargar reporte mensual', 'error'); return; }

  const rows = ventas || [];

  // Aggregate per day
  const porDia = {};
  for (let d = 1; d <= diasMes; d++) porDia[d] = { total: 0, costo: 0, tickets: 0 };

  const catMap = {};

  rows.forEach(v => {
    const d = new Date(v.fecha).getDate();
    porDia[d].total   += Number(v.total || 0);
    porDia[d].tickets += 1;

    (v.items_venta || []).forEach(it => {
      const costo = Number(it.productos?.precio_costo || 0) * Number(it.cantidad || 1);
      porDia[d].costo += costo;

      const cat = it.productos?.categoria || 'Sin categoría';
      if (!catMap[cat]) catMap[cat] = { ventas: 0, costo: 0 };
      catMap[cat].ventas += Number(it.subtotal || 0);
      catMap[cat].costo  += costo;
    });
  });

  const totalVentas   = rows.reduce((s, v) => s + Number(v.total || 0), 0);
  let   costoTotal    = 0;
  rows.forEach(v => (v.items_venta || []).forEach(it => {
    costoTotal += Number(it.productos?.precio_costo || 0) * Number(it.cantidad || 1);
  }));

  const gananciaNeta  = totalVentas - costoTotal;
  const tickets       = rows.length;
  const margenProm    = totalVentas > 0 ? (gananciaNeta / totalVentas) * 100 : 0;

  if (kpisMensual) {
    kpisMensual.innerHTML =
      kpiCard('Total ventas', formatMoney(totalVentas), 'var(--teal)') +
      kpiCard('Ganancia neta', formatMoney(gananciaNeta), gananciaNeta >= 0 ? 'var(--green)' : 'var(--red)') +
      kpiCard('Tickets', tickets) +
      kpiCard('Margen promedio', margenProm.toFixed(1) + '%', 'var(--yellow)');
  }

  // CSS Bar chart
  if (barChart) {
    const maxVal = Math.max(...Object.values(porDia).map(d => d.total), 1);
    barChart.innerHTML = `
      <div class="bar-chart-wrap">
        ${Object.entries(porDia).map(([day, d]) => {
          const h = Math.round((d.total / maxVal) * 100);
          return `
            <div class="bar-col" title="Día ${day}: ${formatMoney(d.total)}">
              <div class="bar-fill" style="height:${h}%"></div>
              <div class="bar-label">${day}</div>
            </div>`;
        }).join('')}
      </div>`;
  }

  // Categories breakdown
  if (tablaCats) {
    const totalCat = Object.values(catMap).reduce((s, c) => s + c.ventas, 0) || 1;
    if (Object.keys(catMap).length === 0) {
      tablaCats.innerHTML = '<p class="text-muted">Sin categorías para este mes.</p>';
    } else {
      tablaCats.innerHTML = Object.entries(catMap)
        .sort((a, b) => b[1].ventas - a[1].ventas)
        .map(([cat, c]) => {
          const ganancia = c.ventas - c.costo;
          return `
            <div class="cat-row">
              <div class="cat-header">
                <span class="cat-name">${cat}</span>
                <span class="cat-total">${formatMoney(c.ventas)}</span>
                <span class="cat-gain" style="color:${ganancia >= 0 ? 'var(--green)' : 'var(--red)'}">${formatMoney(ganancia)}</span>
              </div>
              <div class="cat-bar-wrap">
                <div class="cat-bar" style="width:${pct(c.ventas, totalCat)}"></div>
              </div>
            </div>`;
        }).join('');
    }
  }

  // Comparison vs previous month
  if (comparativa) {
    const mesPrev  = mes === 1 ? 12 : mes - 1;
    const añoPrev  = mes === 1 ? año - 1 : año;
    const mesPS    = String(mesPrev).padStart(2, '0');
    const diasMP   = new Date(añoPrev, mesPrev, 0).getDate();
    const inicioP  = `${añoPrev}-${mesPS}-01T00:00:00`;
    const finP     = `${añoPrev}-${mesPS}-${String(diasMP).padStart(2, '0')}T23:59:59`;

    const { data: ventasPrev } = await supabase
      .from('ventas')
      .select('total, items_venta(cantidad, precio_unitario, productos(precio_costo))')
      .gte('fecha', inicioP)
      .lte('fecha', finP);

    const prevRows        = ventasPrev || [];
    const prevVentas      = prevRows.reduce((s, v) => s + Number(v.total || 0), 0);
    let   prevCosto       = 0;
    prevRows.forEach(v => (v.items_venta || []).forEach(it => {
      prevCosto += Number(it.productos?.precio_costo || 0) * Number(it.cantidad || 1);
    }));
    const prevGanancia    = prevVentas - prevCosto;
    const prevTickets     = prevRows.length;
    const mesNombre       = new Date(año, mes - 1, 1).toLocaleDateString('es-AR', { month: 'long' });
    const mesNombreP      = new Date(añoPrev, mesPrev - 1, 1).toLocaleDateString('es-AR', { month: 'long' });

    comparativa.innerHTML = `
      <div class="comparativa-header">
        <span>Comparativa: <strong>${capitalize(mesNombre)} ${año}</strong> vs <strong>${capitalize(mesNombreP)} ${añoPrev}</strong></span>
      </div>
      <div class="comparativa-grid">
        <div class="comp-item">
          <span class="comp-label">Ventas</span>
          <span class="comp-curr">${formatMoney(totalVentas)}</span>
          <span class="comp-prev text-muted">${formatMoney(prevVentas)}</span>
          ${deltaPct(totalVentas, prevVentas)}
        </div>
        <div class="comp-item">
          <span class="comp-label">Ganancia</span>
          <span class="comp-curr">${formatMoney(gananciaNeta)}</span>
          <span class="comp-prev text-muted">${formatMoney(prevGanancia)}</span>
          ${deltaPct(gananciaNeta, prevGanancia)}
        </div>
        <div class="comp-item">
          <span class="comp-label">Tickets</span>
          <span class="comp-curr">${tickets}</span>
          <span class="comp-prev text-muted">${prevTickets}</span>
          ${deltaPct(tickets, prevTickets)}
        </div>
      </div>`;
  }

  // Store for CSV export
  window._reporteMensualData = { porDia, mes, año, diasMes };
}

// ── CSV Export ────────────────────────────────────────────────────────────────
function exportarCSV() {
  const d = window._reporteMensualData;
  if (!d) { showToast('Cargá primero el reporte mensual', 'info'); return; }

  const { porDia, mes, año } = d;
  const mesStr = String(mes).padStart(2, '0');
  const lines  = ['Día,Fecha,Ventas,Costo,Ganancia,Tickets'];

  Object.entries(porDia).forEach(([day, data]) => {
    const fecha     = `${año}-${mesStr}-${String(day).padStart(2, '0')}`;
    const ganancia  = data.total - data.costo;
    lines.push(`${day},${fecha},${data.total.toFixed(2)},${data.costo.toFixed(2)},${ganancia.toFixed(2)},${data.tickets}`);
  });

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `reporte_${año}_${mesStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV exportado', 'success');
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
