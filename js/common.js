import { supabase, formatMoney, getCajaHoy } from './supabase.js';

// ── Topbar ────────────────────────────────────────────────
function getPageTitle() {
  const h1 = document.querySelector('.page-header h1, h1');
  if (h1) return h1.textContent.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  return document.title.split(' —')[0].trim();
}

function injectTopbar() {
  if (!document.querySelector('.sidebar')) return;

  const fecha = new Date().toLocaleDateString('es-AR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  const title = getPageTitle();

  const bar = document.createElement('div');
  bar.className = 'topbar';
  bar.id = 'main-topbar';
  bar.innerHTML = `
    <div>
      <div class="topbar-title">${title}</div>
      <div class="topbar-sub">${fecha.charAt(0).toUpperCase() + fecha.slice(1)}</div>
    </div>
    <div id="topbar-caja" style="margin-left:16px"></div>
    <div id="topbar-ventas-hoy" class="topbar-stat" style="display:none"></div>
    <div class="topbar-right">
      <div class="topbar-search">🔍 Buscar producto, SKU…</div>
      <a href="reportes.html" class="btn btn-ghost btn-sm" title="Exportar reportes">⬇ Exportar</a>
      <a href="pos.html" class="btn btn-primary btn-sm">+ Registrar venta</a>
      <button id="theme-toggle" class="theme-toggle-btn" title="Cambiar tema">🌙</button>
    </div>`;
  document.body.prepend(bar);
}

async function cargarEstadoCaja() {
  const el = document.getElementById('topbar-caja');
  if (!el) return;
  try {
    const { data: caja } = await getCajaHoy();
    if (caja && caja.estado === 'abierta') {
      const hora = new Date(caja.created_at || Date.now()).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = `<div class="caja-open"><div class="caja-dot"></div>Caja abierta · ${hora}</div>`;
    }
  } catch {}
}

async function cargarTopbarStats() {
  const el = document.getElementById('topbar-ventas-hoy');
  if (!el) return;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const hoy = new Date().toISOString().split('T')[0];
    const { data: ventas } = await supabase
      .from('ventas')
      .select('total')
      .gte('fecha', hoy + 'T00:00:00')
      .lte('fecha', hoy + 'T23:59:59');
    const total = (ventas || []).reduce((s, v) => s + Number(v.total), 0);
    const tickets = (ventas || []).length;
    if (tickets > 0 || total > 0) {
      el.style.display = '';
      el.innerHTML = `<div class="topbar-stat-val">${formatMoney(total)}</div><div class="topbar-stat-lbl">Ventas hoy · ${tickets} ticket${tickets !== 1 ? 's' : ''}</div>`;
    }
  } catch {}
}

async function cargarSidebarBadges() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    // Stock crítico → badge en Inventario
    const { data: prods } = await supabase
      .from('productos')
      .select('stock_actual, stock_minimo')
      .eq('activo', true);
    const critCount = (prods || []).filter(p => p.stock_actual <= p.stock_minimo).length;
    if (critCount > 0) setBadge('inventario.html', critCount, 'red');

    // Caja → badge si abierta
    const hoy = new Date().toISOString().split('T')[0];
    const { data: caja } = await supabase
      .from('cajas').select('estado').eq('fecha', hoy).maybeSingle();
    if (caja?.estado === 'abierta') setBadge('caja.html', 'Abierta', 'green');

    // Facturas pendientes → badge en Facturas
    const { count: factPend } = await supabase
      .from('facturas').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
    if (factPend > 0) setBadge('facturas.html', factPend, 'amber');

    // Alquileres vencidos → badge en Alquileres
    const hoyDate = new Date(); hoyDate.setHours(0,0,0,0);
    const { data: alqVenc } = await supabase
      .from('alquileres')
      .select('id', { count: 'exact', head: false })
      .in('estado', ['activo', 'vencido'])
      .lt('fecha_fin_prevista', hoyDate.toISOString().split('T')[0]);
    if (alqVenc && alqVenc.length > 0) setBadge('alquileres.html', alqVenc.length, 'red');

    // Alertas = stock crítico + bajos
    const bajos = (prods || []).filter(p => p.stock_actual > p.stock_minimo && p.stock_actual <= p.stock_minimo * 1.5).length;
    const alertCount = critCount + bajos;
    if (alertCount > 0) setBadge('index.html', alertCount, 'red');
  } catch {}
}

function setBadge(href, value, color) {
  const link = document.querySelector(`.sidebar a[href="${href}"]`);
  if (!link) return;
  const existing = link.querySelector('.nav-badge');
  if (existing) existing.remove();
  const badge = document.createElement('span');
  badge.className = `nav-badge ${color}`;
  badge.textContent = value;
  link.appendChild(badge);
}

// ── Sidebar logo update ───────────────────────────────────
function updateSidebarLogo() {
  const logo = document.querySelector('.sidebar .logo');
  if (!logo || logo.querySelector('.logo-icon')) return; // ya actualizado
  logo.innerHTML = `
    <img src="img/logo.jpg" alt="Ortopedia Caseros"
      style="height:32px;width:auto;object-fit:contain;border-radius:4px">`;
}

// ── User card ─────────────────────────────────────────────
async function injectUserCard() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar || sidebar.querySelector('.sidebar-bottom')) return;

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const email = session.user.email || '';
  const initials = email.slice(0, 2).toUpperCase();

  const bottom = document.createElement('div');
  bottom.className = 'sidebar-bottom';
  bottom.innerHTML = `
    <div class="user-card">
      <div class="user-av">${initials}</div>
      <div>
        <div class="user-name">${email.split('@')[0]}</div>
        <div class="user-role">Administrador</div>
      </div>
    </div>`;
  sidebar.appendChild(bottom);
}

// ── Sidebar nav: wrap .sidebar a content in nav-icon spans ─
function updateSidebarNav() {
  document.querySelectorAll('.sidebar a').forEach(link => {
    if (link.querySelector('.nav-icon')) return;
    const text = link.textContent.trim();
    // Separar emoji del texto
    const match = text.match(/^([\u{1F300}-\u{1FAFF}\u{1F000}-\u{1F0FF}\u{2600}-\u{27BF}\uFE0F\u{1FA00}-\u{1FA9F}]+)\s*(.*)$/u);
    if (match) {
      link.innerHTML = `<span class="nav-icon">${match[1]}</span>${match[2]}`;
    }
  });
}

// ── Sidebar search ────────────────────────────────────────
function injectSidebarSearch() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const wrap = document.createElement('div');
  wrap.className = 'sidebar-search-wrap';
  wrap.innerHTML = `
    <input type="text" class="input sidebar-search-input" id="sidebar-search"
      placeholder="🔍 Buscar…" autocomplete="off">
    <div id="sidebar-search-results" class="sidebar-search-results"></div>`;

  // Insertar después del logo
  const logo = sidebar.querySelector('.logo');
  if (logo) logo.insertAdjacentElement('afterend', wrap);
  else sidebar.prepend(wrap);

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

  const { data } = await supabase
    .from('productos')
    .select('nombre, sku, precio_venta, stock_actual, stock_minimo, categoria')
    .eq('activo', true)
    .or(`nombre.ilike.%${q}%,sku.ilike.%${q}%`)
    .order('nombre')
    .limit(10);

  if (!data || !data.length) {
    resultsEl.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--text-3)">Sin resultados</div>';
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
          <div style="font-weight:500;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.nombre}</div>
          <div class="mono">${p.categoria}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;padding-left:8px">
          <div style="font-weight:700;color:var(--brand)">${formatMoney(p.precio_venta)}</div>
          <div class="${dot}" style="font-size:11px">${p.stock_actual} u.</div>
        </div>
      </div>`;
  }).join('');
}

// ── Init ─────────────────────────────────────────────────
injectTopbar();
updateSidebarLogo();
updateSidebarNav();
injectSidebarSearch();
cargarEstadoCaja();
cargarTopbarStats();
cargarSidebarBadges();
injectUserCard();
