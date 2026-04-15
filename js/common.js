import { supabase, formatMoney, getCajaHoy } from './supabase.js';

const NAV_CONFIG = [
  {
    label: 'Principal',
    items: [
      { href: 'index.html',    icon: '📊', label: 'Dashboard' },
      { href: 'pos.html',      icon: '🛒', label: 'POS / Venta' },
      { href: 'caja.html',     icon: '💰', label: 'Caja' },
      { href: 'ventas.html',   icon: '🧾', label: 'Tickets' },
    ]
  },
  {
    label: 'Inventario',
    items: [
      { href: 'inventario.html',   icon: '📦', label: 'Inventario' },
      { href: 'stock-carga.html',  icon: '📋', label: 'Carga de stock' },
      { href: 'alquileres.html',   icon: '🔄', label: 'Alquileres' },
      { href: 'plantillas.html',   icon: '🦶', label: 'Plantillas' },
      { href: 'precios.html',      icon: '🏷️', label: 'Precios' },
    ]
  },
  {
    label: 'Gestión',
    items: [
      { href: 'facturas.html', icon: '📑', label: 'Facturas' },
    ]
  },
  {
    label: 'Reportes',
    items: [
      { href: 'reportes.html', icon: '📈', label: 'Reportes' },
    ]
  },
];

function getPageTitle() {
  const h1 = document.querySelector('.page-header h1, h1');
  if (h1) return h1.textContent.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim();
  return document.title.split(' —')[0].trim();
}

function injectTopbar() {
  if (!document.querySelector('.sidebar')) return;
  const fecha = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
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
    <div class="topbar-right">
      <div id="topbar-ventas-hoy" class="header-info" style="display:none"></div>
      <div class="topbar-search-wrap" style="position:relative">
        <input type="text" id="topbar-search" class="input topbar-search" placeholder="🔍 Buscar producto, SKU…" autocomplete="off">
        <div id="topbar-search-results" class="sidebar-search-results" style="position:absolute;top:calc(100% + 4px);right:0;left:auto;width:320px;z-index:500"></div>
      </div>
      <a href="reportes.html" class="btn btn-ghost btn-sm">⬇ Exportar</a>
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
    const { data: ventas } = await supabase.from('ventas').select('total')
      .gte('fecha', hoy + 'T00:00:00').lte('fecha', hoy + 'T23:59:59');
    const total = (ventas || []).reduce((s, v) => s + Number(v.total), 0);
    const tickets = (ventas || []).length;
    if (tickets > 0 || total > 0) {
      el.style.display = '';
      el.innerHTML = `
        <div class="hi-item">Ventas hoy <strong>${tickets} ticket${tickets !== 1 ? 's' : ''}</strong></div>
        <div class="hi-item">Facturado <strong style="color:var(--green)">${formatMoney(total)}</strong></div>`;
    }
  } catch {}
}

async function cargarSidebarBadges() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const { data: prods } = await supabase.from('productos').select('stock_actual,stock_minimo').eq('activo', true);
    const critCount = (prods || []).filter(p => p.stock_actual <= p.stock_minimo).length;
    if (critCount > 0) setBadge('inventario.html', critCount, 'red');

    const hoy = new Date().toISOString().split('T')[0];
    const { data: caja } = await supabase.from('cajas').select('estado').eq('fecha', hoy).maybeSingle();
    if (caja?.estado === 'abierta') setBadge('caja.html', 'Abierta', 'green');

    const { count: factPend } = await supabase.from('facturas').select('id', { count: 'exact', head: true }).eq('estado', 'pendiente');
    if (factPend > 0) setBadge('facturas.html', factPend, 'amber');

    try {
      const hoyDate = new Date(); hoyDate.setHours(0,0,0,0);
      const { data: alqVenc } = await supabase.from('alquileres').select('id')
        .in('estado', ['activo','vencido']).lt('fecha_fin_prevista', hoyDate.toISOString().split('T')[0]);
      if (alqVenc && alqVenc.length > 0) setBadge('alquileres.html', alqVenc.length, 'red');
    } catch {}
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

function buildSidebarNav() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const page = window.location.pathname.split('/').pop() || 'index.html';
  const currentPage = page === '' || !page.includes('.') ? 'index.html' : page;

  sidebar.querySelectorAll('a').forEach(l => l.remove());

  const nav = document.createElement('div');
  nav.className = 'sidebar-nav';

  NAV_CONFIG.forEach(group => {
    const section = document.createElement('div');
    section.className = 'nav-group';
    const lbl = document.createElement('div');
    lbl.className = 'sidebar-section';
    lbl.textContent = group.label;
    section.appendChild(lbl);

    group.items.forEach(item => {
      const a = document.createElement('a');
      a.href = item.href;
      a.innerHTML = `<span class="nav-icon">${item.icon}</span>${item.label}`;
      if (currentPage === item.href) a.classList.add('active');
      section.appendChild(a);
    });

    nav.appendChild(section);
  });

  const logo = sidebar.querySelector('.logo');
  if (logo) logo.after(nav);
  else sidebar.prepend(nav);
}

function updateSidebarLogo() {
  const logo = document.querySelector('.sidebar .logo');
  if (!logo) return;
  logo.innerHTML = `<img src="img/logo.jpg" alt="Ortopedia Caseros"
    style="width:calc(100% - 24px);max-width:200px;height:auto;object-fit:contain;display:block;border-radius:6px">`;
  logo.style.justifyContent = 'center';
  logo.style.alignItems = 'center';
  logo.style.padding = '14px 12px';
  logo.style.height = 'auto';
  logo.style.minHeight = '0';
}

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

function injectSidebarSearch() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-search-wrap';
  wrap.innerHTML = `
    <input type="text" class="input sidebar-search-input" id="sidebar-search"
      placeholder="🔍 Buscar…" autocomplete="off">
    <div id="sidebar-search-results" class="sidebar-search-results"></div>`;
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
  const { data } = await supabase.from('productos').select('nombre,sku,precio_venta,stock_actual,stock_minimo,categoria')
    .eq('activo', true).or(`nombre.ilike.%${q}%,sku.ilike.%${q}%`).order('nombre').limit(10);
  if (!data || !data.length) {
    resultsEl.innerHTML = '<div style="padding:12px 16px;font-size:12px;color:var(--text-3)">Sin resultados</div>';
    resultsEl.style.display = 'block';
    return;
  }
  resultsEl.style.display = 'block';
  resultsEl.innerHTML = data.map(p => {
    const dot = p.stock_actual <= p.stock_minimo ? 'stock-crit' : p.stock_actual <= p.stock_minimo * 1.5 ? 'stock-warn' : 'stock-ok';
    return `<div class="sidebar-result-item">
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

function bindTopbarSearch() {
  const input = document.getElementById('topbar-search');
  const results = document.getElementById('topbar-search-results');
  if (!input || !results) return;
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
    if (!input.parentElement.contains(e.target)) results.style.display = 'none';
  });
}

injectTopbar();
updateSidebarLogo();
buildSidebarNav();
injectSidebarSearch();
bindTopbarSearch();
cargarEstadoCaja();
cargarTopbarStats();
cargarSidebarBadges();
injectUserCard();
