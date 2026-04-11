import { supabase, formatMoney } from './supabase.js';

// ── Sidebar search ────────────────────────────────────────
function injectSidebarSearch() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const wrap = document.createElement('div');
  wrap.className = 'sidebar-search-wrap';
  wrap.innerHTML = `
    <input type="text" class="input sidebar-search-input" id="sidebar-search"
      placeholder="🔍 Buscar producto..." autocomplete="off">
    <div id="sidebar-search-results" class="sidebar-search-results"></div>`;

  const logo = sidebar.querySelector('.logo');
  logo ? logo.insertAdjacentElement('afterend', wrap) : sidebar.prepend(wrap);

  const input = wrap.querySelector('#sidebar-search');
  const results = document.getElementById('sidebar-search-results');
  let timer;

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results.style.display = 'none'; return; }
    timer = setTimeout(() => runSearch(q, results), 250);
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { results.style.display = 'none'; input.value = ''; }
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) results.style.display = 'none';
  });
}

async function runSearch(q, resultsEl) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const { data, error } = await supabase
    .from('productos')
    .select('nombre, sku, ean, precio_venta, stock_actual, stock_minimo, categoria')
    .eq('activo', true)
    .or(`nombre.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
    .order('nombre')
    .limit(10);

  if (error || !data || !data.length) {
    resultsEl.innerHTML = '<div style="padding:12px 14px;font-size:13px;color:var(--text-3)">Sin resultados</div>';
    resultsEl.style.display = 'block';
    return;
  }

  resultsEl.style.display = 'block';
  resultsEl.innerHTML = data.map(p => {
    const dot = p.stock_actual <= p.stock_minimo ? 'stock-crit'
      : p.stock_actual <= p.stock_minimo * 1.5 ? 'stock-warn' : 'stock-ok';
    return `
      <div class="sidebar-result-item">
        <div style="min-width:0">
          <div style="font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div>
          <div style="font-size:11px;color:var(--text-4)">${p.categoria}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;padding-left:8px">
          <div style="font-weight:700;color:var(--brand);white-space:nowrap">${formatMoney(p.precio_venta)}</div>
          <div class="${dot}" style="font-size:11px;white-space:nowrap">${p.stock_actual} u.</div>
        </div>
      </div>`;
  }).join('');
}

injectSidebarSearch();
