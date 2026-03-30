import { supabase, formatMoney } from './supabase.js';

// ── Configuración disponible ──────────────────────────────
const DEFAULTS = { color: '#00D4B4', colorDim: 'rgba(0,212,180,0.12)', fontSize: 15, font: 'IBM Plex Sans' };

const COLORES = [
  { name: 'Turquesa', color: '#00D4B4', dim: 'rgba(0,212,180,0.12)' },
  { name: 'Ámbar',    color: '#FFB547', dim: 'rgba(255,181,71,0.12)' },
  { name: 'Azul',     color: '#5B9BFF', dim: 'rgba(91,155,255,0.12)' },
  { name: 'Verde',    color: '#4ADE80', dim: 'rgba(74,222,128,0.10)' },
  { name: 'Púrpura',  color: '#A78BFA', dim: 'rgba(167,139,250,0.12)' },
  { name: 'Rosa',     color: '#F472B6', dim: 'rgba(244,114,182,0.12)' },
];

const FUENTES = [
  { name: 'IBM Plex Sans', value: "'IBM Plex Sans', sans-serif" },
  { name: 'Inter',         value: "'Inter', sans-serif" },
  { name: 'Nunito',        value: "'Nunito', sans-serif" },
  { name: 'Roboto',        value: "'Roboto', sans-serif" },
];

const TAMAÑOS = [
  { name: 'Chico',     value: 13 },
  { name: 'Normal',    value: 15 },
  { name: 'Grande',    value: 16 },
  { name: 'Muy grande',value: 18 },
];

// ── Settings helpers ──────────────────────────────────────
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
  root.style.setProperty('--teal', s.color);
  root.style.setProperty('--teal-dim', s.colorDim);
  root.style.fontSize = s.fontSize + 'px';
  document.body.style.fontFamily = s.font + ', sans-serif';
  // Precargar fuente si no es la default
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

// ── Inyección del sidebar search ──────────────────────────
function injectSidebarSearch() {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar) return;

  const wrap = document.createElement('div');
  wrap.className = 'sidebar-search-wrap';
  wrap.innerHTML = `
    <input type="text" class="input sidebar-search-input" id="sidebar-search"
      placeholder="🔍 Buscar producto..." autocomplete="off">
    <div class="sidebar-search-results" id="sidebar-search-results"></div>`;

  const logo = sidebar.querySelector('.logo');
  if (logo) logo.insertAdjacentElement('afterend', wrap);
  else sidebar.insertBefore(wrap, sidebar.firstChild);

  let timer;
  const input = wrap.querySelector('#sidebar-search');
  const results = wrap.querySelector('#sidebar-search-results');

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) { results.style.display = 'none'; return; }
    timer = setTimeout(() => buscarGlobal(q, results), 220);
  });

  document.addEventListener('click', e => {
    if (!wrap.contains(e.target)) results.style.display = 'none';
  });
}

async function buscarGlobal(q, resultsEl) {
  const { data } = await supabase
    .from('productos').select('nombre,sku,ean,precio_venta,precio_costo,stock_actual,stock_minimo,categoria')
    .eq('activo', true)
    .or(`nombre.ilike.%${q}%,sku.ilike.%${q}%,ean.ilike.%${q}%`)
    .order('nombre').limit(10);

  if (!data || !data.length) {
    resultsEl.style.display = '';
    resultsEl.innerHTML = '<div style="padding:12px 14px;color:var(--text-muted);font-size:13px">Sin resultados</div>';
    return;
  }

  resultsEl.style.display = '';
  resultsEl.innerHTML = data.map(p => {
    const margen = p.precio_costo > 0 ? Math.round(((p.precio_venta - p.precio_costo) / p.precio_venta) * 100) : null;
    const dot = p.stock_actual <= p.stock_minimo ? 'stock-crit' : p.stock_actual <= p.stock_minimo * 1.5 ? 'stock-warn' : 'stock-ok';
    return `
      <div class="sidebar-result-item">
        <div>
          <div style="font-weight:500;font-size:13px">${p.nombre}</div>
          <div style="font-size:11px;color:var(--text-dim)">${p.categoria}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:'Syne',sans-serif;font-weight:700;color:var(--teal)">${formatMoney(p.precio_venta)}</div>
          <div class="${dot}" style="font-size:11px">${p.stock_actual} u.${margen !== null ? ` · ${margen}%` : ''}</div>
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
  btn.title = 'Configuración';
  document.body.appendChild(btn);

  // Overlay
  const overlay = document.createElement('div');
  overlay.id = 'settings-overlay';
  document.body.appendChild(overlay);

  // Panel
  const panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.innerHTML = `
    <div class="settings-header">
      <span style="font-family:'Syne',sans-serif;font-size:16px;font-weight:700">⚙️ Configuración</span>
      <button id="settings-close">✕</button>
    </div>

    <div class="settings-section">
      <div class="settings-label">Color de acento</div>
      <div class="color-swatches" id="color-swatches">
        ${COLORES.map(c => `
          <div class="color-swatch ${c.color === s.color ? 'active' : ''}"
            style="background:${c.color}"
            data-color="${c.color}" data-dim="${c.dim}"
            title="${c.name}"></div>`).join('')}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Tamaño de texto</div>
      <div class="settings-options" id="size-options">
        ${TAMAÑOS.map(t => `
          <button class="settings-opt ${t.value === s.fontSize ? 'active' : ''}" data-size="${t.value}">
            ${t.name}
          </button>`).join('')}
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-label">Tipografía</div>
      <div class="settings-options" id="font-options">
        ${FUENTES.map(f => `
          <button class="settings-opt ${f.name === s.font ? 'active' : ''}"
            data-font="${f.name}" data-fontval="${f.value}"
            style="font-family:${f.value}">
            ${f.name}
          </button>`).join('')}
      </div>
    </div>

    <div class="settings-section" style="margin-top:auto;padding-top:16px;border-top:1px solid var(--border)">
      <button class="btn btn-danger" id="settings-reset" style="width:100%;font-size:13px">
        Restaurar valores por defecto
      </button>
    </div>`;
  document.body.appendChild(panel);

  // Eventos
  btn.addEventListener('click', () => {
    panel.classList.add('open');
    overlay.classList.add('open');
  });

  const close = () => { panel.classList.remove('open'); overlay.classList.remove('open'); };
  overlay.addEventListener('click', close);
  document.getElementById('settings-close').addEventListener('click', close);

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
applySettings();
injectSidebarSearch();
injectSettingsPanel();
