import { supabase, formatMoney, showToast } from './supabase.js';
import { checkAuth } from './auth.js';

let todosProductos = [];
let filtroCategoria = '';
let filtroProveedor = ''; 
let filtroStock = '';
let filtroTexto = '';
let sortCol = 'nombre';
let sortDir = 'asc';

// ══════════════════════════════════════════════════════════
// CONFIGURACIÓN DE PROVEEDORES
// ══════════════════════════════════════════════════════════
const configProveedores = {
  generico: {
    nombreDB: 'Genérico',
    esperadas: ['nombre', 'ean', 'categoria', 'proveedor', 'precio_venta', 'precio_costo', 'stock_actual', 'stock_minimo'],
    mapRow: (row) => ({
      nombre: row.nombre,
      ean: row.ean,
      categoria: row.categoria,
      proveedor: row.proveedor || null,
      precio_venta: parseFloat(row.precio_venta),
      precio_costo: parseFloat(row.precio_costo),
      stock_actual: parseInt(row.stock_actual) || 0,
      stock_minimo: parseInt(row.stock_minimo) || 5
    })
  },
  dema: {
    nombreDB: 'Dema',
    esperadas: ['descripcion', 'codigo_barra', 'linea', 'precio_publico', 'costo'],
    mapRow: (row) => ({
      nombre: row.descripcion,
      ean: row.codigo_barra,
      categoria: row.linea,
      proveedor: 'Dema',
      precio_venta: parseFloat(row.precio_publico),
      precio_costo: parseFloat(row.costo),
      stock_actual: 0,
      stock_minimo: 5
    })
  },
  silfab: {
    nombreDB: 'Silfab',
    esperadas: ['articulo', 'ean', 'rubro', 'precio_sugerido'],
    mapRow: (row) => ({
      nombre: row.articulo,
      ean: row.ean,
      categoria: row.rubro,
      proveedor: 'Silfab',
      precio_venta: parseFloat(row.precio_sugerido),
      precio_costo: parseFloat(row.precio_sugerido) * 0.7, 
      stock_actual: 0,
      stock_minimo: 2
    })
  }
};

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
  const cats = [...new Set(todosProductos.map(p => p.categoria).filter(Boolean))].sort();
  const selCat = document.getElementById('filtro-categoria');
  const currentCat = selCat.value;
  selCat.innerHTML = '<option value="">Todas las categorías</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    if (c === currentCat) opt.selected = true;
    selCat.appendChild(opt);
  });

  const provs = [...new Set(todosProductos.map(p => p.proveedor).filter(Boolean))].sort();
  const selProv = document.getElementById('filtro-proveedor');
  const currentProv = selProv.value;
  selProv.innerHTML = '<option value="">Todos los proveedores</option>';
  provs.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    if (p === currentProv) opt.selected = true;
    selProv.appendChild(opt);
  });
}

function setSortCol(col) {
  if (sortCol === col) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
  else { sortCol = col; sortDir = 'asc'; }
  renderTabla();
}
window.setSortCol = setSortCol;

function sortIcon(col) {
  if (sortCol !== col) return '<span style="opacity:0.25;margin-left:4px">↕</span>';
  return `<span style="margin-left:4px;color:var(--teal)">${sortDir === 'asc' ? '↑' : '↓'}</span>`;
}

function renderTabla() {
  let productos = todosProductos;

  if (filtroCategoria) productos = productos.filter(p => p.categoria === filtroCategoria);
  if (filtroProveedor) productos = productos.filter(p => p.proveedor === filtroProveedor);
  if (filtroStock === 'critico') productos = productos.filter(p => p.stock_actual <= p.stock_minimo);
  if (filtroStock === 'bajo') productos = productos.filter(p => p.stock_actual > p.stock_minimo && p.stock_actual <= p.stock_minimo * 1.5);
  if (filtroStock === 'ok') productos = productos.filter(p => p.stock_actual > p.stock_minimo * 1.5);
  if (filtroTexto) {
    const q = filtroTexto.toLowerCase();
    productos = productos.filter(p =>
      p.nombre.toLowerCase().includes(q) ||
      p.sku?.toLowerCase().includes(q) ||
      p.ean?.includes(q) ||
      p.categoria?.toLowerCase().includes(q) ||
      p.proveedor?.toLowerCase().includes(q)
    );
  }

  productos = [...productos].sort((a, b) => {
    let va = a[sortCol] ?? '', vb = b[sortCol] ?? '';
    const res = typeof va === 'string' ? va.localeCompare(vb, 'es') : va - vb;
    return sortDir === 'asc' ? res : -res;
  });

  const thMap = {
    nombre: 'th-nombre', stock_actual: 'th-stock', precio_venta: 'th-pventa',
    precio_costo: 'th-pcosto', proveedor: 'th-proveedor'
  };
  Object.entries(thMap).forEach(([col, id]) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = el.dataset.label + sortIcon(col);
  });

  const tbody = document.getElementById('inventario-tbody');
  if (productos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align:center;color:var(--text-dim);padding:32px">Sin productos</td></tr>`;
    return;
  }

  tbody.innerHTML = productos.map(p => {
    const margen = p.precio_costo > 0
      ? Math.round(((p.precio_venta - p.precio_costo) / p.precio_venta) * 100)
      : 0;

    let stockClass, fillClass;
    if (p.stock_actual <= p.stock_minimo) {
      stockClass = 'stock-crit'; fillClass = 'crit';
    } else if (p.stock_actual <= p.stock_minimo * 1.5) {
      stockClass = 'stock-warn'; fillClass = 'warn';
    } else {
      stockClass = 'stock-ok'; fillClass = 'ok';
    }
    const maxStock = Math.max(p.stock_actual, p.stock_minimo * 3, 1);
    const fillPct = Math.min(100, Math.round((p.stock_actual / maxStock) * 100));

    return `
      <tr>
        <td>
          <div style="font-weight:500">${p.nombre}</div>
          <div style="font-size:11px;color:var(--text-dim)">${p.categoria}</div>
        </td>
        <td style="font-size:12px;color:var(--text-muted)">${p.sku}</td>
        <td style="font-size:12px;color:var(--text-dim)">${p.ean || '—'}</td>
        <td style="font-size:12px;color:var(--teal);font-weight:500">${p.proveedor || '—'}</td>
        <td>
          <div class="stk">
            <span class="${stockClass}" style="min-width:24px;text-align:right">${p.stock_actual}</span>
            <div class="stk-bar"><div class="stk-fill ${fillClass}" style="width:${fillPct}%"></div></div>
          </div>
        </td>
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

document.getElementById('filtro-categoria').addEventListener('change', e => {
  filtroCategoria = e.target.value; renderTabla();
});
document.getElementById('filtro-proveedor').addEventListener('change', e => {
  filtroProveedor = e.target.value; renderTabla();
});
document.getElementById('filtro-stock').addEventListener('change', e => {
  filtroStock = e.target.value; renderTabla();
});

let searchTimer;
document.getElementById('busqueda').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    filtroTexto = e.target.value.trim(); renderTabla();
  }, 200);
});

// ══════════════════════════════════════════════════════════
// MODALES (Editar, Ajustar, Nuevo)
// ══════════════════════════════════════════════════════════

window.editarProducto = (id) => {
  const p = todosProductos.find(x => x.id === id);
  if (!p) return;
  const modal = document.getElementById('modal-editar');
  modal.classList.remove('hidden');
  document.getElementById('edit-id').value = p.id;
  document.getElementById('edit-nombre').value = p.nombre;
  document.getElementById('edit-categoria').value = p.categoria;
  document.getElementById('edit-proveedor').value = p.proveedor || '';
  document.getElementById('edit-ean').value = p.ean || '';
  document.getElementById('edit-precio-venta').value = p.precio_venta;
  document.getElementById('edit-precio-costo').value = p.precio_costo;
  document.getElementById('edit-stock-minimo').value = p.stock_minimo;
};

document.getElementById('btn-cerrar-editar').addEventListener('click', () => {
  document.getElementById('modal-editar').classList.add('hidden');
});
document.getElementById('modal-editar').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-editar')) document.getElementById('modal-editar').classList.add('hidden');
});

document.getElementById('form-editar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-id').value;
  const updates = {
    nombre: document.getElementById('edit-nombre').value,
    categoria: document.getElementById('edit-categoria').value,
    proveedor: document.getElementById('edit-proveedor').value.trim() || null,
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
  if (e.target === document.getElementById('modal-ajuste')) document.getElementById('modal-ajuste').classList.add('hidden');
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

document.getElementById('btn-agregar').addEventListener('click', () => {
  document.getElementById('form-nuevo-inventario').reset();
  document.getElementById('modal-nuevo').classList.remove('hidden');
});

document.getElementById('btn-cerrar-nuevo').addEventListener('click', () => {
  document.getElementById('modal-nuevo').classList.add('hidden');
});
document.getElementById('modal-nuevo').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-nuevo')) document.getElementById('modal-nuevo').classList.add('hidden');
});

document.getElementById('form-nuevo-inventario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const ean = fd.get('ean').trim() || null;
  const sku = ean ? `EAN-${ean}` : `SKU-${Date.now()}`;

  const producto = {
    ean, sku,
    nombre: fd.get('nombre'),
    categoria: fd.get('categoria'),
    proveedor: fd.get('proveedor').trim() || null,
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
// CARGA MASIVA (Escáner + Excel/CSV Dual Mode)
// ══════════════════════════════════════════════════════════

let bulkScanner = null;
let bulkCount = 0;
let csvData = [];

document.getElementById('btn-carga-masiva').addEventListener('click', () => {
  bulkCount = 0;
  actualizarContador();
  document.getElementById('modal-carga-masiva').classList.remove('hidden');
  document.getElementById('csv-proveedor-selector').dispatchEvent(new Event('change'));
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

document.querySelectorAll('.bulk-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.bulk-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bulk-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

// ── 1. Escaneo rápido ──
function actualizarContador() {
  document.getElementById('scan-counter').innerHTML =
    `${bulkCount} <span>producto${bulkCount !== 1 ? 's' : ''} cargado${bulkCount !== 1 ? 's' : ''} en esta sesión</span>`;
}

document.getElementById('btn-iniciar-scan-bulk').addEventListener('click', async () => {
  const container = document.getElementById('scan-bulk-container');
  container.style.display = '';
  document.getElementById('btn-iniciar-scan-bulk').style.display = 'none';

  const formats = [
    Html5QrcodeSupportedFormats.EAN_13, Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.CODE_128, Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.UPC_A, Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.QR_CODE,
  ];
  bulkScanner = new Html5Qrcode('scan-bulk-container', { formatsToSupport: formats, verbose: false });
  try {
    await bulkScanner.start(
      { facingMode: 'environment' },
      { fps: 15, qrbox: { width: 280, height: 100 } },
      onBulkEAN, () => {}
    );
  } catch {
    try {
      const devices = await Html5Qrcode.getCameras();
      if (devices?.length) await bulkScanner.start(devices[0].id, { fps: 15, qrbox: { width: 280, height: 100 } }, onBulkEAN, () => {});
    } catch (err2) {
      showToast('Error de cámara: ' + (err2?.message || String(err2)), 'error');
      container.style.display = 'none';
      document.getElementById('btn-iniciar-scan-bulk').style.display = '';
    }
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
  const { data } = await supabase.from('productos').select('id,nombre').eq('ean', ean).maybeSingle();
  if (data) {
    showToast(`Ya existe: ${data.nombre}`, 'warning', 2500);
    reiniciarScanBulk();
    return;
  }

  document.getElementById('bulk-ean-detectado').textContent = ean;
  document.getElementById('bulk-nombre').value = '';
  document.getElementById('bulk-categoria').value = '';
  document.getElementById('bulk-proveedor').value = ''; 
  document.getElementById('bulk-precio-venta').value = '';
  document.getElementById('bulk-precio-costo').value = '';
  document.getElementById('bulk-stock').value = '1';
  document.getElementById('bulk-stock-min').value = '5';
  document.getElementById('bulk-scan-form').style.display = '';

  const cats = [...new Set(todosProductos.map(p => p.categoria).filter(Boolean))].sort().slice(0, 8);
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
    showToast('Nombre, categoría y precio venta son obligatorios', 'warning'); return;
  }

  const btn = document.getElementById('btn-guardar-bulk');
  btn.disabled = true;

  const { error } = await supabase.from('productos').insert({
    ean, sku: `EAN-${ean}`, nombre, categoria,
    proveedor: document.getElementById('bulk-proveedor').value.trim() || null,
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
  const container = document.getElementById('scan-bulk-container');
  container.style.display = '';
  document.getElementById('btn-iniciar-scan-bulk').style.display = 'none';
  bulkScanner = new Html5Qrcode('scan-bulk-container');
  try {
    await bulkScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 250, height: 160 } },
      onBulkEAN, () => {}
    );
  } catch (err) {
    container.style.display = 'none';
    document.getElementById('btn-iniciar-scan-bulk').style.display = '';
  }
}

// ── 2. Importar Excel/CSV via SheetJS (Dual Mode) ──

let currentCsvMode = 'upload'; 
let headersExtraidos = []; 

document.getElementById('csv-proveedor-selector').addEventListener('change', (e) => {
  const prov = e.target.value;
  if (configProveedores[prov]) {
    document.getElementById('csv-columnas-esperadas').innerHTML = `Columnas esperadas: <strong>${configProveedores[prov].esperadas.join(', ')}</strong>`;
  }
});

document.querySelectorAll('.csv-mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.csv-mode-btn').forEach(b => {
      b.classList.remove('active');
      b.style.background = 'transparent';
      b.style.color = 'var(--text-main)';
    });
    const target = e.target;
    target.classList.add('active');
    target.style.background = 'var(--teal-dim)';
    target.style.color = 'var(--teal)';

    currentCsvMode = target.dataset.mode;
    
    document.getElementById('csv-mode-upload').style.display = currentCsvMode === 'upload' ? 'block' : 'none';
    document.getElementById('csv-mode-new-prov').style.display = currentCsvMode === 'new-prov' ? 'block' : 'none';
    document.getElementById('csv-preview').innerHTML = '';
    document.getElementById('btn-importar-csv').style.display = 'none';
    document.getElementById('new-prov-mapping').style.display = 'none';
  });
});

const csvInput = document.getElementById('csv-input');
const drops = [document.getElementById('csv-drop-zone-upload'), document.getElementById('csv-drop-zone-template')];

drops.forEach(drop => {
  drop.addEventListener('click', () => csvInput.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('dragover');
    if (e.dataTransfer.files[0]) procesarArchivoExcelOCSV(e.dataTransfer.files[0]);
  });
});

csvInput.addEventListener('change', () => { if (csvInput.files[0]) procesarArchivoExcelOCSV(csvInput.files[0]); });

function procesarArchivoExcelOCSV(file) {
  if (!window.XLSX) {
    showToast('La librería para procesar Excel aún no cargó. Intentá en 2 segundos.', 'warning');
    return;
  }

  const reader = new FileReader();
  
  // Usamos readAsArrayBuffer para que SheetJS lea el Excel en crudo correctamente
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // header: 1 nos devuelve un Array de Arrays (para aislar los nombres de las columnas)
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // Filtramos filas que estén totalmente vacías
      const validRows = rows.filter(r => r.length > 0 && r.some(c => c !== '' && c !== undefined && c !== null));
      
      if (validRows.length < 2) { 
        showToast('El archivo está vacío o solo tiene la cabecera', 'warning'); 
        return; 
      }

      // Procesamos las cabeceras limpiándolas
      const rawHeaders = validRows[0];
      const headers = rawHeaders.map(h => String(h || '').toLowerCase().trim());

      // Mapeamos el resto de las filas a un diccionario {columna: valor}
      const dataObjects = validRows.slice(1).map(rowArray => {
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = rowArray[i] !== undefined ? rowArray[i] : '';
        });
        return obj;
      });

      if (currentCsvMode === 'upload') {
        procesarDataConProveedor(headers, dataObjects);
      } else {
        // Para evitar duplicidad de columnas vacías en los dropdowns
        headersExtraidos = [...new Set(headers.filter(h => h !== ''))];
        armarUIAsignacionDeColumnas(headersExtraidos);
      }

    } catch (err) {
      showToast('Error al leer el archivo. ¿Es un Excel o CSV válido?', 'error');
      console.error(err);
    }
  };
  
  reader.readAsArrayBuffer(file);
  csvInput.value = ''; // Reset input
}

function armarUIAsignacionDeColumnas(headersFile) {
  const camposRequeridos = {
    'nombre': 'Nombre / Descripción *',
    'ean': 'EAN / Código de Barras',
    'categoria': 'Categoría / Rubro',
    'precio_venta': 'Precio de Venta *',
    'precio_costo': 'Precio de Costo'
  };

  let html = '';
  for (const [keyDb, labelUI] of Object.entries(camposRequeridos)) {
    let options = `<option value="">-- No importar --</option>`;
    
    // Bandera para no seleccionar múltiples opciones
    let yaSeleccionado = false;

    headersFile.forEach(h => {
      let selected = '';
      const terminoBusqueda = keyDb.split('_')[0]; 
      
      // Heurística de selección inteligente (solo selecciona el primero que coincide)
      if (!yaSeleccionado && h.includes(terminoBusqueda)) {
        selected = 'selected';
        yaSeleccionado = true;
      }
      
      options += `<option value="${h}" ${selected}>Columna: ${h}</option>`;
    });

    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
        <span style="font-weight:500; width:45%;">${labelUI}</span>
        <select class="select map-select" data-db="${keyDb}" style="width:50%; padding:4px;">
          ${options}
        </select>
      </div>`;
  }

  document.getElementById('mapping-fields').innerHTML = html;
  document.getElementById('new-prov-mapping').style.display = 'block';
  showToast('Columnas leídas con éxito. Revisá las asignaciones.', 'success');
}

document.getElementById('btn-save-provider').addEventListener('click', () => {
  const nombreProv = document.getElementById('new-prov-name').value.trim();
  if (!nombreProv) { showToast('Falta el nombre del proveedor', 'warning'); return; }

  const idProv = nombreProv.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapeoActual = {};
  
  document.querySelectorAll('.map-select').forEach(sel => {
    mapeoActual[sel.dataset.db] = sel.value;
  });

  configProveedores[idProv] = {
    nombreDB: nombreProv,
    esperadas: Object.values(mapeoActual).filter(v => v !== ''),
    mapRow: (row) => ({
      nombre: mapeoActual.nombre && row[mapeoActual.nombre] ? String(row[mapeoActual.nombre]) : 'Sin nombre',
      ean: mapeoActual.ean && row[mapeoActual.ean] ? String(row[mapeoActual.ean]) : null,
      categoria: mapeoActual.categoria && row[mapeoActual.categoria] ? String(row[mapeoActual.categoria]) : 'General',
      proveedor: nombreProv,
      precio_venta: mapeoActual.precio_venta ? parseFloat(row[mapeoActual.precio_venta]) : 0,
      precio_costo: mapeoActual.precio_costo ? parseFloat(row[mapeoActual.precio_costo]) : 0,
      stock_actual: 0,
      stock_minimo: 5
    })
  };

  const selector = document.getElementById('csv-proveedor-selector');
  const opt = document.createElement('option');
  opt.value = idProv;
  opt.textContent = nombreProv;
  selector.appendChild(opt);

  showToast(`Proveedor ${nombreProv} configurado con éxito`, 'success');
  document.querySelector('.csv-mode-btn[data-mode="upload"]').click();
  selector.value = idProv;
  selector.dispatchEvent(new Event('change'));
});

function procesarDataConProveedor(headers, dataObjects) {
  const proveedorKey = document.getElementById('csv-proveedor-selector').value;
  const config = configProveedores[proveedorKey];

  if (!config) { showToast('Proveedor no configurado', 'error'); return; }

  const missing = config.esperadas.filter(r => !headers.includes(r));
  if (missing.length) {
    showToast(`El formato no coincide. Faltan las columnas: ${missing.join(', ')}`, 'error'); return;
  }

  csvData = dataObjects.map(rowObj => {
    return config.mapRow(rowObj);
  }).filter(r => r.nombre !== 'Sin nombre');

  renderCSVPreview();
}

function validarCSVRow(r) {
  const warnings = [];
  const pv = parseFloat(r.precio_venta);
  const pc = parseFloat(r.precio_costo);
  if (!pv || pv <= 0 || isNaN(pv)) warnings.push('precio_venta vacío o inválido');
  if (pc < 0 || isNaN(pc)) warnings.push('precio_costo negativo o inválido');
  if (r.ean && (String(r.ean).length < 8 || isNaN(Number(r.ean)))) warnings.push('EAN con formato sospechoso');
  return warnings;
}

function renderCSVPreview() {
  const el = document.getElementById('csv-preview');
  const btn = document.getElementById('btn-importar-csv');

  if (csvData.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.867rem">No se encontraron filas válidas</p>';
    btn.style.display = 'none'; return;
  }

  const conWarnings = csvData.filter(r => validarCSVRow(r).length > 0);
  const preview = csvData.slice(0, 8);

  el.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px">
      ${csvData.length} productos listos para procesar
      ${conWarnings.length ? `· <span style="color:var(--amber)">⚠️ ${conWarnings.length} con advertencias</span>` : '· <span style="color:var(--green)">✅ Sin problemas detectados</span>'}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Nombre</th><th>Prov.</th><th>EAN</th><th>P.Venta</th><th>P.Costo</th><th></th></tr></thead>
        <tbody>
          ${preview.map(r => {
            const warns = validarCSVRow(r);
            const rowStyle = warns.length ? 'background:var(--amber-dim)' : '';
            return `<tr style="${rowStyle}">
              <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.nombre}</td>
              <td style="font-size:0.8rem;color:var(--teal)">${r.proveedor || '—'}</td>
              <td style="color:var(--text-dim);font-size:0.8rem">${r.ean || '—'}</td>
              <td style="color:var(--teal)">${r.precio_venta ? '$' + parseFloat(r.precio_venta).toLocaleString('es-AR') : '<span style="color:var(--red)">—</span>'}</td>
              <td style="color:var(--text-muted)">${r.precio_costo ? '$' + parseFloat(r.precio_costo).toLocaleString('es-AR') : '—'}</td>
              <td style="font-size:0.733rem;color:var(--amber)">${warns.join('<br>')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${csvData.length > 8 ? `<div style="font-size:0.8rem;color:var(--text-dim);margin-top:6px">…y ${csvData.length - 8} más</div>` : ''}`;

  btn.style.display = '';
  btn.textContent = `✅ Importar ${csvData.length} productos`;
}

document.getElementById('btn-importar-csv').addEventListener('click', async () => {
  if (!csvData.length) return;
  const btn = document.getElementById('btn-importar-csv');
  const previewEl = document.getElementById('csv-preview');
  btn.disabled = true;
  btn.textContent = 'Importando...';

  let ok = 0;
  const errores = [];

  for (const row of csvData) {
    const ean = row.ean ? String(row.ean).trim() : null;
    const sku = row.sku ? String(row.sku).trim() : (ean ? `EAN-${ean}` : `SKU-${Date.now()}-${Math.random().toString(36).slice(2,6)}`);
    const producto = {
      ean, sku,
      nombre: row.nombre,
      categoria: row.categoria || 'General',
      proveedor: row.proveedor || null,
      precio_venta: parseFloat(row.precio_venta) || 0,
      precio_costo: parseFloat(row.precio_costo) || 0,
      stock_actual: parseInt(row.stock_actual) || 0,
      stock_minimo: parseInt(row.stock_minimo) || 5,
    };
    
    let error;
    if (ean) {
      ({ error } = await supabase.from('productos').upsert(producto, { onConflict: 'ean' }));
    } else {
      ({ error } = await supabase.from('productos').insert(producto));
    }
    
    if (error) errores.push({ nombre: row.nombre, motivo: error.message || error.code });
    else ok++;
  }

  btn.disabled = false;
  showToast(`${ok} guardados ${errores.length ? ` · ${errores.length} errores` : ''}`, errores.length > 0 ? 'warning' : 'success', 6000);

  previewEl.innerHTML = `
    <div style="margin-bottom:10px;font-size:0.867rem">
      <span style="color:var(--green)">✅ ${ok} guardados en base de datos</span>
      ${errores.length ? `&nbsp;·&nbsp;<span style="color:var(--red)">❌ ${errores.length} fallaron</span>` : ''}
    </div>`;

  csvData = [];
  btn.style.display = 'none';
});
