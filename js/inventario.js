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
  }
  // Podés dejar Dema y Silfab vacíos por ahora y armarlos directo desde la UI "Nuevo Proveedor"
};

async function init() {
  const session = await checkAuth();
  if (!session) return;

  await cargarProductos();

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
    opt.value = c; opt.textContent = c;
    if (c === currentCat) opt.selected = true;
    selCat.appendChild(opt);
  });

  const provs = [...new Set(todosProductos.map(p => p.proveedor).filter(Boolean))].sort();
  const selProv = document.getElementById('filtro-proveedor');
  const currentProv = selProv.value;
  selProv.innerHTML = '<option value="">Todos los proveedores</option>';
  provs.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p; opt.textContent = p;
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
            <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px" onclick="window.editarProducto('${p.id}')">✏️</button>
            <button class="btn btn-amber" style="padding:5px 10px;font-size:12px" onclick="window.ajustarStock('${p.id}','${p.nombre}',${p.stock_actual})">±</button>
          </div>
        </td>
      </tr>`;
  }).join('');
}

document.getElementById('filtro-categoria').addEventListener('change', e => { filtroCategoria = e.target.value; renderTabla(); });
document.getElementById('filtro-proveedor').addEventListener('change', e => { filtroProveedor = e.target.value; renderTabla(); });
document.getElementById('filtro-stock').addEventListener('change', e => { filtroStock = e.target.value; renderTabla(); });

let searchTimer;
document.getElementById('busqueda').addEventListener('input', e => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { filtroTexto = e.target.value.trim(); renderTabla(); }, 200);
});

// ══════════════════════════════════════════════════════════
// MODALES
// ══════════════════════════════════════════════════════════

window.editarProducto = (id) => {
  const p = todosProductos.find(x => x.id === id);
  if (!p) return;
  document.getElementById('modal-editar').classList.remove('hidden');
  document.getElementById('edit-id').value = p.id;
  document.getElementById('edit-nombre').value = p.nombre;
  document.getElementById('edit-categoria').value = p.categoria;
  document.getElementById('edit-proveedor').value = p.proveedor || '';
  document.getElementById('edit-ean').value = p.ean || '';
  document.getElementById('edit-precio-venta').value = p.precio_venta;
  document.getElementById('edit-precio-costo').value = p.precio_costo;
  document.getElementById('edit-stock-minimo').value = p.stock_minimo;
};

document.getElementById('btn-cerrar-editar').addEventListener('click', () => document.getElementById('modal-editar').classList.add('hidden'));
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
  if (error) { showToast('Error al guardar', 'error'); return; }
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
  const p = todosProductos.find(x => x.id === document.getElementById('ajuste-id').value);
  if (!p) return;
  const nuevo = p.stock_actual + (parseInt(e.target.value) || 0);
  document.getElementById('preview-nuevo').textContent = nuevo;
  document.getElementById('preview-nuevo').style.color = nuevo < 0 ? 'var(--red)' : 'var(--text)';
});

document.getElementById('btn-cerrar-ajuste').addEventListener('click', () => document.getElementById('modal-ajuste').classList.add('hidden'));
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
document.getElementById('btn-cerrar-nuevo').addEventListener('click', () => document.getElementById('modal-nuevo').classList.add('hidden'));
document.getElementById('form-nuevo-inventario').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const ean = fd.get('ean').trim() || null;
  const producto = {
    ean, sku: ean ? `EAN-${ean}` : `SKU-${Date.now()}`,
    nombre: fd.get('nombre'), categoria: fd.get('categoria'),
    proveedor: fd.get('proveedor').trim() || null,
    precio_venta: parseFloat(fd.get('precio_venta')), precio_costo: parseFloat(fd.get('precio_costo')),
    stock_actual: parseInt(fd.get('stock_actual')) || 0, stock_minimo: parseInt(fd.get('stock_minimo')) || 5
  };
  const { error } = await supabase.from('productos').insert(producto);
  if (error) { showToast('Error', 'error'); return; }
  showToast('Producto agregado', 'success');
  document.getElementById('modal-nuevo').classList.add('hidden');
  cargarProductos();
});

init();

// ══════════════════════════════════════════════════════════
// CARGA MASIVA (Escáner + Excel/CSV Dinámico Avanzado)
// ══════════════════════════════════════════════════════════

let bulkScanner = null;
let bulkCount = 0;
let csvData = [];
let currentCsvMode = 'upload'; 
let headersExtraidos = []; 

document.getElementById('btn-carga-masiva').addEventListener('click', () => {
  bulkCount = 0;
  document.getElementById('modal-carga-masiva').classList.remove('hidden');
  document.getElementById('csv-proveedor-selector').dispatchEvent(new Event('change'));
});

document.getElementById('btn-cerrar-masiva').addEventListener('click', async () => {
  if (bulkScanner) { try { await bulkScanner.stop(); bulkScanner.clear(); } catch(e){} }
  document.getElementById('modal-carga-masiva').classList.add('hidden');
  if (bulkCount > 0) cargarProductos();
});

document.querySelectorAll('.bulk-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.bulk-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.bulk-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById('panel-' + tab.dataset.tab).classList.add('active');
  });
});

document.querySelectorAll('.csv-mode-btn').forEach(btn => {
  btn.addEventListener('click', (e) => {
    document.querySelectorAll('.csv-mode-btn').forEach(b => {
      b.classList.remove('active'); b.style.background = 'transparent'; b.style.color = 'var(--text-main)';
    });
    const target = e.target;
    target.classList.add('active'); target.style.background = 'var(--teal-dim)'; target.style.color = 'var(--teal)';
    currentCsvMode = target.dataset.mode;
    document.getElementById('csv-mode-upload').style.display = currentCsvMode === 'upload' ? 'block' : 'none';
    document.getElementById('csv-mode-new-prov').style.display = currentCsvMode === 'new-prov' ? 'block' : 'none';
    document.getElementById('csv-preview').innerHTML = '';
    document.getElementById('btn-importar-csv').style.display = 'none';
    document.getElementById('new-prov-mapping').style.display = 'none';
  });
});

// Dropzones para Excel
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

// ── LA MAGIA: PARSER INTELIGENTE DE EXCEL / CSV ──
function procesarArchivoExcelOCSV(file) {
  if (!window.XLSX) {
    showToast('Aguardá un segundo, cargando librería Excel...', 'warning'); return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      
      // Leemos como matriz para ver el caos en crudo
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
      if (rows.length < 2) { showToast('El archivo está vacío', 'warning'); return; }

      // 1. CAZADOR DE CABECERAS: Buscar la fila que más parezca un encabezado (max 100 filas)
      const keywords = ['código', 'codigo', 'descripción', 'descripcion', 'producto', 'artículo', 'articulo', 'precio', 'ean', 'barra', 'rubro', 'categoría', 'talle', 'detalle'];
      let headerIndex = 0;
      let maxScore = 0;

      for (let i = 0; i < Math.min(rows.length, 100); i++) {
        const row = rows[i];
        if (!row || !row.length) continue;
        let score = 0;
        row.forEach(cell => {
          const str = String(cell || '').toLowerCase().trim();
          if (keywords.some(kw => str.includes(kw))) score++;
        });
        if (score > maxScore) { maxScore = score; headerIndex = i; }
      }

      // 2. EXTRAER CABECERA REAL Y REPARARLA
      const rawHeaders = rows[headerIndex];
      const headers = [];
      const headerCounts = {}; // Para evitar duplicados como "UNITARIO" dos veces en Care-Quip

      for (let i = 0; i < rawHeaders.length; i++) {
        let h = String(rawHeaders[i] || '').toLowerCase().trim();
        
        // Si Dema manda una columna sin nombre, la inventamos
        if (!h) h = `columna_${i + 1}`; 

        // Si Care-Quip repite nombres, los numeramos
        if (headerCounts[h]) {
            headerCounts[h]++;
            h = `${h}_${headerCounts[h]}`;
        } else {
            headerCounts[h] = 1;
        }
        headers.push(h);
      }

      // 3. AISLAR LOS DATOS REALES (Todo lo que está debajo de la cabecera)
      const validDataRows = rows.slice(headerIndex + 1).filter(r => r.length > 0 && r.some(c => c !== '' && c !== undefined && c !== null));

      const dataObjects = validDataRows.map(rowArray => {
        const obj = {};
        headers.forEach((h, i) => {
          obj[h] = rowArray[i] !== undefined ? rowArray[i] : '';
        });
        return obj;
      });

      // 4. DERIVAR FLUJO SEGÚN EL MODO
      if (currentCsvMode === 'upload') {
        procesarDataConProveedor(headers, dataObjects);
      } else {
        headersExtraidos = [...new Set(headers.filter(h => h !== ''))];
        armarUIAsignacionDeColumnas(headersExtraidos);
      }

    } catch (err) {
      showToast('Error leyendo el archivo Excel.', 'error'); console.error(err);
    }
  };
  reader.readAsArrayBuffer(file);
  csvInput.value = ''; 
}

function armarUIAsignacionDeColumnas(headersFile) {
  const camposRequeridos = {
    'nombre': 'Nombre / Descripción *',
    'ean': 'EAN / Cód. Barras (Opcional)',
    'categoria': 'Categoría / Rubro',
    'precio_venta': 'Precio de Venta *',
    'precio_costo': 'Precio de Costo'
  };

  let html = '';
  for (const [keyDb, labelUI] of Object.entries(camposRequeridos)) {
    let options = `<option value="">-- Ignorar / No importar --</option>`;
    let yaSeleccionado = false;

    headersFile.forEach(h => {
      let selected = '';
      const terminos = keyDb === 'nombre' ? ['descrip', 'articul', 'nombre', 'detalle'] : [keyDb.split('_')[0]]; 
      
      // Autoselección inteligente
      if (!yaSeleccionado && terminos.some(t => h.includes(t))) {
        selected = 'selected'; yaSeleccionado = true;
      }
      options += `<option value="${h}" ${selected}>Columna Excel: ${h}</option>`;
    });

    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
        <span style="font-weight:500; width:45%;">${labelUI}</span>
        <select class="select map-select" data-db="${keyDb}" style="width:50%; padding:4px;">${options}</select>
      </div>`;
  }

  document.getElementById('mapping-fields').innerHTML = html;
  document.getElementById('new-prov-mapping').style.display = 'block';
  showToast('Excel leído. Revisá cómo quedaron asignadas las columnas.', 'success');
}

document.getElementById('btn-save-provider').addEventListener('click', () => {
  const nombreProv = document.getElementById('new-prov-name').value.trim();
  if (!nombreProv) { showToast('Falta el nombre del proveedor', 'warning'); return; }

  const idProv = nombreProv.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapeoActual = {};
  document.querySelectorAll('.map-select').forEach(sel => { mapeoActual[sel.dataset.db] = sel.value; });

  // Guardamos el perfil en nuestro diccionario
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
  const opt = document.createElement('option'); opt.value = idProv; opt.textContent = nombreProv;
  selector.appendChild(opt);

  showToast(`Perfil de ${nombreProv} guardado.`, 'success');
  document.querySelector('.csv-mode-btn[data-mode="upload"]').click();
  selector.value = idProv; selector.dispatchEvent(new Event('change'));
});

function procesarDataConProveedor(headers, dataObjects) {
  const proveedorKey = document.getElementById('csv-proveedor-selector').value;
  const config = configProveedores[proveedorKey];

  if (!config) { showToast('Perfil de proveedor no encontrado', 'error'); return; }

  // Verificamos si faltan columnas vitales según el perfil
  const missing = config.esperadas.filter(r => !headers.includes(r));
  if (missing.length) {
    showToast(`Cuidado: En este Excel faltan las columnas: ${missing.join(', ')}. ¿Cambió el formato el proveedor?`, 'error'); 
    return;
  }

  csvData = dataObjects.map(rowObj => config.mapRow(rowObj)).filter(r => r.nombre !== 'Sin nombre');
  renderCSVPreview();
}

function validarCSVRow(r) {
  const warnings = [];
  const pv = parseFloat(r.precio_venta);
  if (!pv || pv <= 0 || isNaN(pv)) warnings.push('Precio Venta inválido');
  return warnings;
}

function renderCSVPreview() {
  const el = document.getElementById('csv-preview');
  const btn = document.getElementById('btn-importar-csv');

  if (csvData.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.867rem">No se encontraron productos válidos.</p>';
    btn.style.display = 'none'; return;
  }

  const conWarnings = csvData.filter(r => validarCSVRow(r).length > 0);
  const preview = csvData.slice(0, 8);

  el.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px">
      ${csvData.length} productos detectados 
      ${conWarnings.length ? `· <span style="color:var(--amber)">⚠️ ${conWarnings.length} con problemas de precio</span>` : '· <span style="color:var(--green)">✅ Datos limpios</span>'}
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Producto</th><th>Prov.</th><th>Precio</th><th>Costo</th><th></th></tr></thead>
        <tbody>
          ${preview.map(r => {
            const warns = validarCSVRow(r);
            return `<tr style="${warns.length ? 'background:var(--amber-dim)' : ''}">
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.nombre}</td>
              <td style="font-size:0.8rem;color:var(--teal)">${r.proveedor || '—'}</td>
              <td style="color:var(--teal)">${r.precio_venta ? '$' + parseFloat(r.precio_venta).toLocaleString('es-AR') : '—'}</td>
              <td style="color:var(--text-muted)">${r.precio_costo ? '$' + parseFloat(r.precio_costo).toLocaleString('es-AR') : '—'}</td>
              <td style="font-size:0.7rem;color:var(--amber)">${warns.join(', ')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${csvData.length > 8 ? `<div style="font-size:0.8rem;color:var(--text-dim);margin-top:6px">…y ${csvData.length - 8} más</div>` : ''}`;

  btn.style.display = '';
  btn.textContent = `✅ Subir ${csvData.length} productos`;
}

document.getElementById('btn-importar-csv').addEventListener('click', async () => {
  if (!csvData.length) return;
  const btn = document.getElementById('btn-importar-csv');
  const previewEl = document.getElementById('csv-preview');
  btn.disabled = true; btn.textContent = 'Guardando en base de datos...';

  let ok = 0; const errores = [];
  for (const row of csvData) {
    const ean = row.ean ? String(row.ean).trim() : null;
    const sku = ean ? `EAN-${ean}` : `SKU-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    
    let error;
    if (ean) {
      ({ error } = await supabase.from('productos').upsert({ ean, sku, ...row }, { onConflict: 'ean' }));
    } else {
      ({ error } = await supabase.from('productos').insert({ sku, ...row }));
    }
    if (error) errores.push({ nombre: row.nombre, motivo: error.message });
    else ok++;
  }

  btn.disabled = false;
  showToast(`${ok} guardados ${errores.length ? ` · Hubo ${errores.length} errores` : ''}`, errores.length > 0 ? 'warning' : 'success', 6000);
  previewEl.innerHTML = `<div style="color:var(--green);font-size:0.9rem;font-weight:600">✅ Importación finalizada.</div>`;
  csvData = []; btn.style.display = 'none';
  cargarProductos();
});

// Selector Hint inicial
document.getElementById('csv-proveedor-selector').addEventListener('change', (e) => {
  const p = configProveedores[e.target.value];
  document.getElementById('csv-columnas-esperadas').innerHTML = p ? `Columnas: <strong>${p.esperadas.join(', ')}</strong>` : '';
});
