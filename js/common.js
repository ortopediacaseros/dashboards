import { supabase, formatMoney } from './supabase.js';

// ── Settings ──────────────────────────────────────────────
const DEFAULTS = { color: '#00D4B4', colorDim: 'rgba(0,212,180,0.12)', fontSize: 15, font: 'IBM Plex Sans', theme: 'dark' };

const COLORES = [
  { name: 'Turquesa', color: '#00D4B4', dim: 'rgba(0,212,180,0.12)' },
  { name: 'Ámbar',    color: '#FFB547', dim: 'rgba(255,181,71,0.12)' },
  { name: 'Azul',     color: '#5B9BFF', dim: 'rgba(91,155,255,0.12)' },
  { name: 'Verde',    color: '#4ADE80', dim: 'rgba(74,222,128,0.10)' },
  { name: 'Púrpura',  color: '#A78BFA', dim: 'rgba(167,139,250,0.12)' },
  { name: 'Rosa',     color: '#F472B6', dim: 'rgba(244,114,182,0.12)' },
];

const FUENTES = [
  { name: 'IBM Plex Sans' },
  { name: 'Inter' },
  { name: 'Nunito' },
  { name: 'Roboto' },
];

const TAMAÑOS = [
  { name: 'Chico',      value: 13 },
  { name: 'Normal',     value: 15 },
  { name: 'Grande',     value: 16 },
  { name: 'Muy grande', value: 18 },
];

function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('ort_settings') || '{}') }; }
  catch { return { ...DEFAULTS }; }
}

function saveSetting(key, val) {
  const s = getSettings(); s[key] = val;
  localStorage.setItem('ort_settings', JSON.stringify(s));
}

function applySettings() {
  const s = getSettings();
  const root = document.documentElement;
  root.setAttribute('data-theme', s.theme);
  root.style.setProperty('--teal', s.color);
  root.style.setProperty('--teal-dim', s.colorDim);
  root.style.setProperty('--font-body', `'${s.font}'`);
  root.style.fontSize = s.fontSize + 'px';
  if (s.font !== 'IBM Plex Sans') loadFont(s.font);
}

function loadFont(name) {
  const id = 'gf-' + name.replace(/\s/g, '-');
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id; link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name)}:wght@300;400;500;600;700;800&display=swap`;
  document.head.appendChild(link);
}

// Aplicar al cargar (antes de render para evitar flash)
applySettings();

// ── Buscador en sidebar ───────────────────────────────────
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
  // Verificar sesión antes de consultar
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const { data, error } = await supabase
    .from('productos')
    .select('nombre, sku, ean, precio_venta, precio_costo, stock_actual, stock_minimo, categoria')
    .eq('activo', true)
    .or(`nombre.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
    .order('nombre')
    .limit(10);

  if (error || !data || !data.length) {
    resultsEl.innerHTML = '<div style="padding:12px 14px;font-size:13px;color:var(--text-muted)">Sin resultados</div>';
    resultsEl.style.display = 'block';
    return;
  }

  resultsEl.style.display = 'block';
  resultsEl.innerHTML = data.map(p => {
    const margen = p.precio_costo > 0
      ? Math.round(((p.precio_venta - p.precio_costo) / p.precio_venta) * 100)
      : null;
    const dot = p.stock_actual <= p.stock_minimo ? 'stock-crit'
      : p.stock_actual <= p.stock_minimo * 1.5 ? 'stock-warn' : 'stock-ok';
    return `
      <div class="sidebar-result-item">
        <div style="min-width:0">
          <div style="font-weight:500;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.nombre}</div>
          <div style="font-size:11px;color:var(--text-dim)">${p.categoria}</div>
        </div>
        <div style="text-align:right;flex-shrink:0;padding-left:8px">
          <div style="font-family:'Syne',sans-serif;font-weight:700;color:var(--teal);white-space:nowrap">${formatMoney(p.precio_venta)}</div>
          <div class="${dot}" style="font-size:11px;white-space:nowrap">
            ${p.stock_actual} u.${margen !== null ? ` · ${margen}%` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Panel de configuración ────────────────────────────────
function injectSettingsPanel() {
  const s = getSettings();

  // Botón flotante
  const btn = document.createElement('button');
  btn.id = 'settings-btn';
  btn.innerHTML = '⚙️';
  btn.title = 'Configuración visual';
  document.body.appendChild(btn);

  // Panel (sin overlay — la página sigue visible)
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.innerHTML = `
    <div class="settings-header">
      <span>⚙️ Apariencia</span>
      <button id="settings-close" title="Cerrar">✕</button>
    </div>

    <div class="settings-section">
      <div class="settings-label">Tema</div>
      <div style="display:flex;gap:8px">
        <button class="settings-opt ${s.theme === 'dark' ? 'active' : ''}" data-theme-val="dark" style="flex:1;text-align:center">🌙 Oscuro</button>
        <button class="settings-opt ${s.theme === 'light' ? 'active' : ''}" data-theme-val="light" style="flex:1;text-align:center">☀️ Claro</button>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Color de acento</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${COLORES.map(c => `
          <div class="color-swatch ${c.color === s.color ? 'active' : ''}"
            style="background:${c.color}"
            data-color="${c.color}"
            data-dim="${c.dim}"
            title="${c.name}"></div>`).join('')}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Tamaño de texto</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        ${TAMAÑOS.map(t => `
          <button class="settings-opt ${t.value === s.fontSize ? 'active' : ''}" data-size="${t.value}">
            ${t.name}
          </button>`).join('')}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Tipografía</div>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${FUENTES.map(f => `
          <button class="settings-opt ${f.name === s.font ? 'active' : ''}"
            data-font="${f.name}"
            style="font-family:'${f.name}',sans-serif;text-align:left">
            ${f.name} — <span style="font-weight:300">AaBbCc 123</span>
          </button>`).join('')}
      </div>
    </div>

    <div class="settings-section">
      <button class="btn btn-danger" id="settings-reset" style="width:100%;font-size:0.867rem">
        ↺ Restaurar por defecto
      </button>
    </div>`;
  document.body.appendChild(panel);

  // Abrir / cerrar
  const togglePanel = () => {
    const open = panel.classList.toggle('open');
    btn.innerHTML = open ? '✕' : '⚙️';
  };

  btn.addEventListener('click', togglePanel);
  document.getElementById('settings-close').addEventListener('click', togglePanel);

  // Cerrar al hacer click fuera
  document.addEventListener('click', e => {
    if (panel.classList.contains('open') && !panel.contains(e.target) && e.target !== btn) {
      panel.classList.remove('open');
      btn.innerHTML = '⚙️';
    }
  });

  // Tema
  panel.querySelectorAll('[data-theme-val]').forEach(el => {
    el.addEventListener('click', () => {
      panel.querySelectorAll('[data-theme-val]').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      saveSetting('theme', el.dataset.themeVal);
      applySettings();
    });
  });

  // Colores
  panel.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      panel.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      saveSetting('color', sw.dataset.color);
      saveSetting('colorDim', sw.dataset.dim);
      applySettings();
    });
  });

  // Tamaños
  panel.querySelectorAll('[data-size]').forEach(el => {
    el.addEventListener('click', () => {
      panel.querySelectorAll('[data-size]').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      saveSetting('fontSize', Number(el.dataset.size));
      applySettings();
    });
  });

  // Fuentes
  panel.querySelectorAll('[data-font]').forEach(el => {
    el.addEventListener('click', () => {
      panel.querySelectorAll('[data-font]').forEach(e => e.classList.remove('active'));
      el.classList.add('active');
      saveSetting('font', el.dataset.font);
      applySettings();
    });
  });

  // Reset
  document.getElementById('settings-reset').addEventListener('click', () => {
    localStorage.removeItem('ort_settings');
    location.reload();
  });
}

// ── Init ──────────────────────────────────────────────────
injectSidebarSearch();
injectSettingsPanel();
