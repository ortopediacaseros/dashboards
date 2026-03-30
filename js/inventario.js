import { supabase, formatMoney, showToast } from './supabase.js';
import { checkAuth } from './auth.js';

let todosProductos = [];
let filtroCategoria = '';
let filtroStock = '';
let filtroTexto = '';

async function init() {
  const session = await checkAuth();
  if (!session) return;

  await cargarProductos();

  // Realtime
  supabase.channel('inv-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'productos' }, () => {
      cargarProductos();
    })
    .subscribe();
}

async function cargarProductos() {
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .order('nombre');

  if (error) { showToast('Error al cargar productos', 'error'); return; }
  todosProductos = data || [];
  actualizarKPIs();
  llenarFiltros();
  renderTabla();
}

function actualizarKPIs() {
  const total = todosProductos.length;
  const criticos = todosProductos.filter(p => p.stock_actual <= p.stock_minimo).length;
  const valorInventario = todosProductos.reduce((s, p) => s + p.stock_actual * Number(p.precio_costo), 0);
  const unidades = todosProductos.reduce((s, p) => s + p.stock_actual, 0);

  document.getElementById('kpi-total').textContent = total;
  document.getElementById('kpi-criticos').textContent = criticos;
  document.getElementById('kpi-valor').textContent = formatMoney(valorInventario);
  document.getElementById('kpi-unidades').textContent = unidades.toLocaleString('es-AR');
}

function llenarFiltros() {
  const cats = [...new Set(todosProductos.map(p => p.categoria))].sort();
  const sel = document.getElementById('filtro-categoria');
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas las categorías</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === current) opt.selected = true;
    sel.appendChild(opt);
  });
}

function renderTabla() {
  let productos = todosProductos;

  if (filtroCategoria) productos = productos.filter(p => p.categoria === filtroCategoria);
  if (filtroStock === 'critico') productos = productos.filter(p => p.stock_actual <= p.stock_minimo);
  if (filtroStock === 'bajo') productos = productos.filter(p => p.stock_actual > p.stock_minimo && p.stock_actual <= p.stock_minimo * 1.5);
  if (filtroStock === 'ok') productos = productos.filter(p => p.stock_actual > p.stock_minimo * 1.5);
  if (filtroTexto) {
    const q = filtroTexto.toLowerCase();
    productos = productos.filter(p =>
      p.nombre.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.ean?.includes(q) ||
      p.categoria.toLowerCase().includes(q)
    );
  }

  const tbody = document.getElementById('inventario-tbody');
  if (productos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:32px">Sin productos</td></tr>`;
    return;
  }

  tbody.innerHTML = productos.map(p => {
    const margen = p.precio_costo > 0
      ? Math.round(((p.precio_venta - p.precio_costo) / p.precio_venta) * 100)
      : 0;

    let stockClass, stockLabel;
    if (p.stock_actual <= p.stock_minimo) {
      stockClass = 'stock-crit'; stockLabel = 'Crítico';
    } else if (p.stock_actual <= p.stock_minimo * 1.5) {
      stockClass = 'stock-warn'; stockLabel = 'Bajo';
    } else {
      stockClass = 'stock-ok'; stockLabel = 'OK';
    }

    return `
      <tr>
        <td>
          <div style="font-weight:500">${p.nombre}</div>
          <div style="font-size:11px;color:var(--text-dim)">${p.categoria}</div>
        </td>
        <td style="font-size:12px;color:var(--text-muted)">${p.sku}</td>
        <td style="font-size:12px;color:var(--text-dim)">${p.ean || '—'}</td>
        <td class="${stockClass}">${p.stock_actual}</td>
        <td style="font-size:12px;color:var(--text-dim)">${p.stock_minimo}</td>
        <td>${formatMoney(p.precio_venta)}</td>
        <td style="color:var(--text-muted)">${formatMoney(p.precio_costo)}</td>
        <td><span class="badge ${margen >= 40 ? 'badge-green' : margen >= 20 ? 'badge-amber' : 'badge-red'}">${margen}%</span></td>
        <td>
          <div style="display:flex;gap:6px">
            <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px"
              onclick="window.editarProducto('${p.id}')">✏️</button>
            <button class="btn btn-amber" style="padding:5px 10px;font-size:12px"
              onclick="window.ajustarStock('${p.id}','${p.nombre}',${p.stock_actual})">±</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

// Filtros
document.getElementById('filtro-categoria').addEventListener('change', e => {
  filtroCategoria = e.target.value;
  renderTabla();
});

document.getElementById('filtro-stock').addEventListener('change', e => {
  filtroStock = e.target.value;
  renderTabla();
});

let searchTimer;
document.getElementById('busqueda').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filtroTexto = e.target.value.trim();
    renderTabla();
  }, 200);
});

// Modal editar
window.editarProducto = (id) => {
  const p = todosProductos.find(x => x.id === id);
  if (!p) return;
  const modal = document.getElementById('modal-editar');
  modal.classList.remove('hidden');
  document.getElementById('edit-id').value = p.id;
  document.getElementById('edit-nombre').value = p.nombre;
  document.getElementById('edit-categoria').value = p.categoria;
  document.getElementById('edit-ean').value = p.ean || '';
  document.getElementById('edit-precio-venta').value = p.precio_venta;
  document.getElementById('edit-precio-costo').value = p.precio_costo;
  document.getElementById('edit-stock-minimo').value = p.stock_minimo;
};

document.getElementById('btn-cerrar-editar').addEventListener('click', () => {
  document.getElementById('modal-editar').classList.add('hidden');
});

document.getElementById('modal-editar').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-editar'))
    document.getElementById('modal-editar').classList.add('hidden');
});

document.getElementById('form-editar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const updates = {
    nombre: document.getElementById('edit-nombre').value,
    categoria: document.getElementById('edit-categoria').value,
    ean: document.getElementById('edit-ean').value.trim() || null,
    precio_venta: parseFloat(document.getElementById('edit-precio-venta').value),
    precio_costo: parseFloat(document.getElementById('edit-precio-costo').value),
    stock_minimo: parseInt(document.getElementById('edit-stock-minimo').value)
  };

  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  const { error } = await supabase.from('productos').update(updates).eq('id', id);
  btn.disabled = false;

  if (error) { showToast('Error al guardar: ' + error.message, 'error'); return; }
  showToast('Producto actualizado', 'success');
  document.getElementById('modal-editar').classList.add('hidden');
  cargarProductos();
});

// Modal ajustar stock
window.ajustarStock = (id, nombre, stockActual) => {
  document.getElementById('ajuste-id').value = id;
  document.getElementById('ajuste-nombre').textContent = nombre;
  document.getElementById('ajuste-actual').textContent = stockActual;
  document.getElementById('ajuste-cantidad').value = 0;
  document.getElementById('preview-nuevo').textContent = stockActual;
  document.getElementById('modal-ajuste').classList.remove('hidden');
};

document.getElementById('ajuste-cantidad').addEventListener('input', e => {
  const id = document.getElementById('ajuste-id').value;
  const p = todosProductos.find(x => x.id === id);
  if (!p) return;
  const delta = parseInt(e.target.value) || 0;
  const nuevo = p.stock_actual + delta;
  document.getElementById('preview-nuevo').textContent = nuevo;
  document.getElementById('preview-nuevo').style.color = nuevo < 0 ? 'var(--red)' : 'var(--text)';
});

document.getElementById('btn-cerrar-ajuste').addEventListener('click', () => {
  document.getElementById('modal-ajuste').classList.add('hidden');
});

document.getElementById('modal-ajuste').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-ajuste'))
    document.getElementById('modal-ajuste').classList.add('hidden');
});

document.getElementById('form-ajuste').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('ajuste-id').value;
  const delta = parseInt(document.getElementById('ajuste-cantidad').value) || 0;
  const p = todosProductos.find(x => x.id === id);
  const nuevo = (p?.stock_actual || 0) + delta;

  if (nuevo < 0) { showToast('El stock no puede quedar negativo', 'warning'); return; }

  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  const { error } = await supabase.from('productos').update({ stock_actual: nuevo }).eq('id', id);
  btn.disabled = false;

  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Stock actualizado', 'success');
  document.getElementById('modal-ajuste').classList.add('hidden');
  cargarProductos();
});

// Modal nuevo producto
document.getElementById('btn-agregar').addEventListener('click', () => {
  document.getElementById('form-nuevo-inventario').reset();
  document.getElementById('modal-nuevo').classList.remove('hidden');
});

document.getElementById('btn-cerrar-nuevo').addEventListener('click', () => {
  document.getElementById('modal-nuevo').classList.add('hidden');
});

document.getElementById('modal-nuevo').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-nuevo'))
    document.getElementById('modal-nuevo').classList.add('hidden');
});

document.getElementById('form-nuevo-inventario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const ean = fd.get('ean').trim() || null;
  const sku = ean ? `EAN-${ean}` : `SKU-${Date.now()}`;

  const producto = {
    ean,
    sku,
    nombre: fd.get('nombre'),
    categoria: fd.get('categoria'),
    precio_venta: parseFloat(fd.get('precio_venta')),
    precio_costo: parseFloat(fd.get('precio_costo')),
    stock_actual: parseInt(fd.get('stock_actual')) || 0,
    stock_minimo: parseInt(fd.get('stock_minimo')) || 5
  };

  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  const { error } = await supabase.from('productos').insert(producto);
  btn.disabled = false;

  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Producto agregado', 'success');
  document.getElementById('modal-nuevo').classList.add('hidden');
  cargarProductos();
});

init();

// ══════════════════════════════════════════════════════════
// CARGA MASIVA
// ══════════════════════════════════════════════════════════

let bulkScanner = null;
let bulkCount = 0;
let csvData = [];

// Abrir / cerrar modal
document.getElementById('btn-carga-masiva').addEventListener('click', () => {
  bulkCount = 0;
  actualizarContador();
  document.getElementById('modal-carga-masiva').classList.remove('hidden');
});

document.getElementById('btn-cerrar-masiva').addEventListener('click', cerrarMasiva);
document.getElementById('modal-carga-masiva').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-carga-masiva')) cerrarMasiva();
});

async function cerrarMasiva() {
  await detenerScanBulk();
  document.getElementById('modal-carga-masiva').classList.add('hidden');
  document.getElementById('bulk-scan-form').style.display = 'none';
  document.getElementById('btn-iniciar-scan-bulk').style.display = '';
  if (bulkCount > 0) cargarProductos();
}

// Tabs
document.querySelectorAll('.bulk-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.bulk-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bulk-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ── Escaneo rápido ───────────────────────────────────────

function actualizarContador() {
  document.getElementById('scan-counter').innerHTML =
    `${bulkCount} <span>producto${bulkCount !== 1 ? 's' : ''} cargado${bulkCount !== 1 ? 's' : ''} en esta sesión</span>`;
}

document.getElementById('btn-iniciar-scan-bulk').addEventListener('click', async () => {
  const container = document.getElementById('scan-bulk-container');
  container.style.display = '';
  document.getElementById('btn-iniciar-scan-bulk').style.display = 'none';

  bulkScanner = new Html5Qrcode('scan-bulk-container');
  try {
    await bulkScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 160 } },
      onBulkEAN,
      () => {}
    );
  } catch (err) {
    showToast('Error al acceder a la cámara: ' + err.message, 'error');
    container.style.display = 'none';
    document.getElementById('btn-iniciar-scan-bulk').style.display = '';
  }
});

async function detenerScanBulk() {
  if (bulkScanner) {
    try { await bulkScanner.stop(); bulkScanner.clear(); } catch (e) {}
    bulkScanner = null;
  }
  document.getElementById('scan-bulk-container').style.display = 'none';
}

async function onBulkEAN(ean) {
  await detenerScanBulk();

  // Verificar si ya existe
  const { data } = await supabase.from('productos').select('id,nombre').eq('ean', ean).maybeSingle();
  if (data) {
    showToast(`Ya existe: ${data.nombre}`, 'warning', 2500);
    reiniciarScanBulk();
    return;
  }

  // Mostrar form
  document.getElementById('bulk-ean-detectado').textContent = ean;
  document.getElementById('bulk-nombre').value = '';
  document.getElementById('bulk-categoria').value = '';
  document.getElementById('bulk-precio-venta').value = '';
  document.getElementById('bulk-precio-costo').value = '';
  document.getElementById('bulk-stock').value = '1';
  document.getElementById('bulk-stock-min').value = '5';
  document.getElementById('bulk-scan-form').style.display = '';

  // Sugerencias de categorías existentes
  const cats = [...new Set(todosProductos.map(p => p.categoria))].sort().slice(0, 8);
  document.getElementById('bulk-cat-sugerencias').innerHTML = cats.map(c =>
    `<button type="button" class="btn btn-secondary" style="padding:3px 10px;font-size:11px"
      onclick="document.getElementById('bulk-categoria').value='${c}'">${c}</button>`
  ).join('');

  setTimeout(() => document.getElementById('bulk-nombre').focus(), 100);
}

document.getElementById('btn-guardar-bulk').addEventListener('click', async () => {
  const nombre = document.getElementById('bulk-nombre').value.trim();
  const categoria = document.getElementById('bulk-categoria').value.trim();
  const precio_venta = parseFloat(document.getElementById('bulk-precio-venta').value);
  const ean = document.getElementById('bulk-ean-detectado').textContent;

  if (!nombre || !categoria || !precio_venta) {
    showToast('Nombre, categoría y precio venta son obligatorios', 'warning');
    return;
  }

  const btn = document.getElementById('btn-guardar-bulk');
  btn.disabled = true;

  const { error } = await supabase.from('productos').insert({
    ean,
    sku: `EAN-${ean}`,
    nombre,
    categoria,
    precio_venta,
    precio_costo: parseFloat(document.getElementById('bulk-precio-costo').value) || 0,
    stock_actual: parseInt(document.getElementById('bulk-stock').value) || 1,
    stock_minimo: parseInt(document.getElementById('bulk-stock-min').value) || 5,
  });

  btn.disabled = false;

  if (error) { showToast('Error: ' + error.message, 'error'); return; }

  bulkCount++;
  actualizarContador();
  showToast(`${nombre} guardado`, 'success', 1500);
  reiniciarScanBulk();
});

document.getElementById('btn-skip-bulk').addEventListener('click', reiniciarScanBulk);

async function reiniciarScanBulk() {
  document.getElementById('bulk-scan-form').style.display = 'none';
  document.getElementById('btn-iniciar-scan-bulk').style.display = '';
  document.getElementById('scan-bulk-container').style.display = 'none';

  // Reiniciar escáner automáticamente
  const container = document.getElementById('scan-bulk-container');
  container.style.display = '';
  document.getElementById('btn-iniciar-scan-bulk').style.display = 'none';
  bulkScanner = new Html5Qrcode('scan-bulk-container');
  try {
    await bulkScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 160 } },
      onBulkEAN,
      () => {}
    );
  } catch (err) {
    container.style.display = 'none';
    document.getElementById('btn-iniciar-scan-bulk').style.display = '';
  }
}

// ── Importar CSV ─────────────────────────────────────────

const csvDrop = document.getElementById('csv-drop-zone');
const csvInput = document.getElementById('csv-input');

csvDrop.addEventListener('click', () => csvInput.click());
csvDrop.addEventListener('dragover', e => { e.preventDefault(); csvDrop.classList.add('dragover'); });
csvDrop.addEventListener('dragleave', () => csvDrop.classList.remove('dragover'));
csvDrop.addEventListener('drop', e => {
  e.preventDefault(); csvDrop.classList.remove('dragover');
  if (e.dataTransfer.files[0]) procesarCSV(e.dataTransfer.files[0]);
});
csvInput.addEventListener('change', () => { if (csvInput.files[0]) procesarCSV(csvInput.files[0]); });

function parseCSVLine(line) {
  const vals = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      vals.push(cur.trim()); cur = '';
    } else cur += ch;
  }
  vals.push(cur.trim());
  return vals;
}

function procesarCSV(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.split('\n').map(l => l.trim()).filter(l => l);
    if (lines.length < 2) { showToast('El CSV está vacío o solo tiene encabezado', 'warning'); return; }

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const required = ['nombre', 'precio_venta', 'categoria'];
    const missing = required.filter(r => !headers.includes(r));
    if (missing.length) {
      showToast(`Faltan columnas: ${missing.join(', ')}`, 'error');
      return;
    }

    csvData = lines.slice(1).map(line => {
      const vals = parseCSVLine(line);
      const obj = {};
      headers.forEach((h, i) => obj[h] = vals[i] || '');
      return obj;
    }).filter(r => r.nombre);

    renderCSVPreview();
  };
  reader.readAsText(file);
}

function validarCSVRow(r) {
  const warnings = [];
  const pv = parseFloat(r.precio_venta);
  const pc = parseFloat(r.precio_costo);
  const sa = parseInt(r.stock_actual);
  if (!pv || pv <= 0) warnings.push('precio_venta vacío o cero');
  if (pc < 0) warnings.push('precio_costo negativo');
  if (sa > 9999) warnings.push(`stock_actual sospechoso (${sa}) — ¿se corrieron columnas?`);
  if (r.ean && (r.ean.length < 8 || isNaN(Number(r.ean)))) warnings.push('EAN inválido');
  return warnings;
}

function renderCSVPreview() {
  const el = document.getElementById('csv-preview');
  const btn = document.getElementById('btn-importar-csv');

  if (csvData.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.867rem">No se encontraron filas válidas</p>';
    btn.style.display = 'none';
    return;
  }

  const conWarnings = csvData.filter(r => validarCSVRow(r).length > 0);
  const preview = csvData.slice(0, 8);

  el.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px">
      ${csvData.length} productos encontrados
      ${conWarnings.length ? `· <span style="color:var(--amber)">⚠️ ${conWarnings.length} con advertencias</span>` : '· <span style="color:var(--green)">✅ Sin problemas detectados</span>'}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Categoría</th><th>EAN</th><th>P.Venta</th><th>P.Costo</th><th>Stock</th><th></th></tr></thead>
        <tbody>
          ${preview.map(r => {
            const warns = validarCSVRow(r);
            const rowStyle = warns.length ? 'background:var(--amber-dim)' : '';
            return `<tr style="${rowStyle}">
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.nombre}</td>
              <td>${r.categoria || '—'}</td>
              <td style="color:var(--text-dim);font-size:0.8rem">${r.ean || '—'}</td>
              <td style="color:var(--teal)">${r.precio_venta ? '$' + parseFloat(r.precio_venta).toLocaleString('es-AR') : '<span style="color:var(--red)">—</span>'}</td>
              <td style="color:var(--text-muted)">${r.precio_costo ? '$' + parseFloat(r.precio_costo).toLocaleString('es-AR') : '—'}</td>
              <td>${r.stock_actual || '0'}</td>
              <td style="font-size:0.733rem;color:var(--amber)">${warns.join('<br>')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${csvData.length > 8 ? `<div style="font-size:0.8rem;color:var(--text-dim);margin-top:6px">…y ${csvData.length - 8} más</div>` : ''}
    ${conWarnings.length ? `<div style="margin-top:10px;padding:10px 14px;background:var(--amber-dim);border-radius:var(--radius-sm);font-size:0.867rem;color:var(--amber)">
      ⚠️ Hay ${conWarnings.length} filas con posibles problemas de columnas. Revisá los valores antes de importar.
    </div>` : ''}`;

  btn.style.display = '';
  btn.textContent = `✅ Importar ${csvData.length} productos`;
}

document.getElementById('btn-importar-csv').addEventListener('click', async () => {
  if (!csvData.length) return;
  const btn = document.getElementById('btn-importar-csv');
  const previewEl = document.getElementById('csv-preview');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  let ok = 0, skip = 0;
  const errores = [];

  for (const row of csvData) {
    const ean = row.ean?.trim() || null;
    const sku = row.sku?.trim() || (ean ? `EAN-${ean}` : `SKU-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
    const producto = {
      ean,
      sku,
      nombre: row.nombre,
      categoria: row.categoria || 'General',
      precio_venta: parseFloat(row.precio_venta) || 0,
      precio_costo: parseFloat(row.precio_costo) || 0,
      stock_actual: parseInt(row.stock_actual) || 0,
      stock_minimo: parseInt(row.stock_minimo) || 5,
    };
    let error;
    if (ean) {
      // Con EAN: upsert — actualiza si ya existe, inserta si no
      ({ error } = await supabase.from('productos').upsert(producto, { onConflict: 'ean' }));
    } else {
      // Sin EAN: insert simple
      ({ error } = await supabase.from('productos').insert(producto));
    }
    if (error) {
      errores.push({ nombre: row.nombre, motivo: error.message || error.code });
    } else ok++;
  }

  btn.disabled = false;
  showToast(
    `${ok} importados/actualizados${errores.length ? ` · ${errores.length} errores` : ''}`,
    errores.length > 0 ? 'warning' : 'success', 6000
  );

  // Log de resultados
  previewEl.innerHTML = `
    <div style="margin-bottom:10px;font-size:0.867rem">
      <span style="color:var(--green)">✅ ${ok} importados</span>
      ${skip ? `&nbsp;·&nbsp;<span style="color:var(--text-muted)">⏭ ${skip} saltados</span>` : ''}
      ${errores.length ? `&nbsp;·&nbsp;<span style="color:var(--red)">❌ ${errores.length} fallaron</span>` : ''}
    </div>
    ${errores.length ? `
    <div class="table-wrap">
      <table>
        <thead><tr><th>Producto</th><th>Error</th></tr></thead>
        <tbody>
          ${errores.map(e => `<tr>
            <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${e.nombre}</td>
            <td style="color:var(--red);font-size:0.8rem">${e.motivo}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}`;

  csvData = [];
  btn.style.display = 'none';
});

document.getElementById('btn-descargar-template').addEventListener('click', () => {
  const csv = 'nombre,ean,categoria,precio_venta,precio_costo,stock_actual,stock_minimo\nMulteta aluminio M,7891234567890,Muletas,15000,8000,10,3\nRodillera talle M,,Rodilleras,8500,4500,5,2';
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'template_productos.csv';
  a.click();
});
