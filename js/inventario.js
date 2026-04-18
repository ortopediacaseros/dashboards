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
// MOTOR DE PERSISTENCIA EN NUBE (SUPABASE) - PERFILES DE PROVEEDOR
// ══════════════════════════════════════════════════════════

const perfilGenerico = {
  nombreDB: 'Genérico (Formato Ortopedia)',
  isBase: true,
  mapeo: {
    nombre: 'nombre', ean: 'ean', categoria: 'categoria', proveedor: 'proveedor',
    precio_venta: 'precio_venta', precio_costo: 'precio_costo'
  }
};

let configProveedores = { generico: perfilGenerico };

async function cargarPerfilesGuardados() {
  const { data, error } = await supabase.from('perfiles_proveedores').select('*');
  
  if (error) { 
    console.error('Error cargando perfiles:', error); 
    showToast('Error cargando perfiles de proveedores', 'error');
    return; 
  }

  configProveedores = { generico: perfilGenerico };
  
  if (data) {
    data.forEach(prov => {
      configProveedores[prov.id] = {
        nombreDB: prov.nombre,
        isBase: false,
        mapeo: prov.mapeo
      };
    });
  }

  const selector = document.getElementById('csv-proveedor-selector');
  if (selector) {
    selector.innerHTML = '';
    for (const [id, config] of Object.entries(configProveedores)) {
      const opt = document.createElement('option');
      opt.value = id; opt.textContent = config.nombreDB;
      selector.appendChild(opt);
    }
  }

  const lista = document.getElementById('lista-perfiles-guardados');
  if (lista) {
    lista.innerHTML = Object.entries(configProveedores).map(([id, config]) => `
      <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card); border:1px solid var(--border); padding:10px; border-radius:var(--radius-sm);">
        <div>
          <strong style="font-size:13px; display:block;">${config.nombreDB}</strong>
          <span style="font-size:11px; color:var(--text-dim)">Mapea ${Object.values(config.mapeo).filter(Boolean).length} columnas</span>
        </div>
        ${config.isBase 
          ? `<span style="font-size:11px; color:var(--text-muted); background:var(--bg-body); padding:4px 8px; border-radius:4px;">Por defecto</span>` 
          : `<button class="btn btn-secondary" style="padding:4px 8px; font-size:12px; color:var(--red);" onclick="window.eliminarPerfilProveedor('${id}')">🗑️ Borrar</button>`
        }
      </div>
    `).join('');
  }
}

window.eliminarPerfilProveedor = async (id) => {
  if(confirm('¿Estás seguro de que querés borrar este perfil de la base de datos?')) {
    const { error } = await supabase.from('perfiles_proveedores').delete().eq('id', id);
    if (error) { showToast('Error al borrar de la nube: ' + error.message, 'error'); return; }
    
    cargarPerfilesGuardados();
    showToast('Perfil eliminado de la base de datos', 'success');
  }
};

// ══════════════════════════════════════════════════════════
// INICIALIZACIÓN Y CARGA DE PRODUCTOS
// ══════════════════════════════════════════════════════════

async function init() {
  const session = await checkAuth();
  if (!session) return;

  await cargarPerfilesGuardados();
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

// ══════════════════════════════════════════════════════════
// KPIs Y TABLA PRINCIPAL
// ══════════════════════════════════════════════════════════

function actualizarKPIs() {
  const total = todosProductos.length;
  const ultimoEnStock = todosProductos.filter(p => p.stock_actual === 1);
  const valorInventario = todosProductos.reduce((s, p) => s + p.stock_actual * Number(p.precio_costo), 0);
  const unidades = todosProductos.reduce((s, p) => s + p.stock_actual, 0);

  document.getElementById('kpi-total').textContent = total;
  document.getElementById('kpi-valor').textContent = formatMoney(valorInventario);
  document.getElementById('kpi-unidades').textContent = unidades.toLocaleString('es-AR');

  const kpiUltimoEl = document.getElementById('kpi-ultimo-stock');
  const listaUltimoEl = document.getElementById('kpi-ultimo-lista');
  const cardUltimoEl = document.getElementById('card-ultimo-stock');
  if (kpiUltimoEl) kpiUltimoEl.textContent = ultimoEnStock.length;
  if (cardUltimoEl) cardUltimoEl.style.display = ultimoEnStock.length === 0 ? 'none' : '';
  if (listaUltimoEl) {
    if (ultimoEnStock.length === 0) {
      listaUltimoEl.innerHTML = '';
    } else {
      listaUltimoEl.innerHTML = ultimoEnStock
        .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
        .map(p => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:13px">
          <div>
            <span style="font-weight:500">${p.nombre}</span>
            <span style="font-size:11px;color:var(--text-dim);margin-left:6px">${p.categoria}</span>
          </div>
          <span class="stock-crit" style="font-weight:700;font-size:13px">1 u.</span>
        </div>`).join('');
    }
  }
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
  if (filtroStock === 'critico') productos = productos.filter(p => p.stock_actual === 1);
  if (filtroStock === 'bajo') productos = productos.filter(p => p.stock_actual > 1 && p.stock_actual <= 5);
  if (filtroStock === 'ok') productos = productos.filter(p => p.stock_actual > 5);
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
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:32px">Sin productos</td></tr>`;
    return;
  }

  tbody.innerHTML = productos.map(p => {
    const costoReal = p.precio_costo * 1.21;
    const margen = p.precio_costo > 0
      ? Math.round(((p.precio_venta - costoReal) / p.precio_venta) * 100)
      : 0;

    let stockClass, fillClass;
    if (p.stock_actual === 0) {
      stockClass = 'stock-zero'; fillClass = 'zero';
    } else if (p.stock_actual === 1) {
      stockClass = 'stock-crit'; fillClass = 'crit';
    } else if (p.stock_actual <= 5) {
      stockClass = 'stock-warn'; fillClass = 'warn';
    } else {
      stockClass = 'stock-ok'; fillClass = 'ok';
    }
    const maxStock = Math.max(p.stock_actual, 10, 1);
    const fillPct = p.stock_actual === 0 ? 100 : Math.min(100, Math.round((p.stock_actual / maxStock) * 100));

    const imgHtml = p.imagen_url
      ? `<img src="${p.imagen_url}" alt="" loading="lazy"
           style="width:40px;height:40px;object-fit:contain;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);flex-shrink:0;cursor:pointer"
           onclick="window.verImagenProducto('${p.imagen_url}','${p.nombre.replace(/'/g,"\\'")}')">`
      : `<div style="width:40px;height:40px;border-radius:6px;border:1px solid var(--border);background:var(--surface-2);flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:16px;color:var(--text-dim)">📦</div>`;

    return `
      <tr${p.stock_actual === 0 ? ' style="background:rgba(239,68,68,0.06)"' : ''}>
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            ${imgHtml}
            <div>
              <div style="font-weight:500">${p.nombre}</div>
              <div style="font-size:11px;color:var(--text-dim)">${p.categoria}</div>
            </div>
          </div>
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
// MODALES MANUALES (Editar, Ajustar, Nuevo)
// ══════════════════════════════════════════════════════════

window.verImagenProducto = (url, nombre) => {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:24px';
  overlay.innerHTML = `
    <div style="max-width:480px;max-height:80vh;text-align:center">
      <img src="${url}" alt="${nombre}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.5)">
      <div style="color:white;font-size:13px;margin-top:12px;opacity:.8">${nombre}</div>
    </div>`;
  overlay.addEventListener('click', () => overlay.remove());
  document.body.appendChild(overlay);
};

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

  // Mostrar imagen actual si existe
  const imgWrap = document.getElementById('edit-imagen-preview');
  if (imgWrap) {
    imgWrap.innerHTML = p.imagen_url
      ? `<img src="${p.imagen_url}" alt="${p.nombre}"
           style="width:80px;height:80px;object-fit:contain;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);cursor:pointer"
           onclick="window.verImagenProducto('${p.imagen_url}','${p.nombre.replace(/'/g,"\\'")}')">
         <span style="font-size:11px;color:var(--text-muted)">Imagen del proveedor</span>`
      : `<span style="font-size:12px;color:var(--text-dim)">Sin imagen cargada</span>`;
  }
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
    precio_costo: parseFloat(document.getElementById('edit-precio-costo').value)
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
    stock_actual: parseInt(fd.get('stock_actual')) || 0
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

// ══════════════════════════════════════════════════════════
// CARGA MASIVA AVANZADA (ESCANER + EXCEL MULTI-HOJA)
// ══════════════════════════════════════════════════════════

let bulkScanner = null;
let bulkCount = 0;
let csvData = [];
let currentCsvMode = 'upload'; 
let headersExtraidos = []; 

document.getElementById('btn-carga-masiva').addEventListener('click', () => {
  bulkCount = 0;
  cargarPerfilesGuardados(); 
  document.getElementById('modal-carga-masiva').classList.remove('hidden');
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
    document.getElementById('csv-mode-manage-prov').style.display = currentCsvMode === 'manage-prov' ? 'block' : 'none';
    
    document.getElementById('csv-preview').innerHTML = '';
    document.getElementById('btn-importar-csv').style.display = 'none';
  });
});

// ── Dropzones Excel ──
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
    showToast('Aguardá un segundo, cargando librería Excel...', 'warning'); return;
  }

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = new Uint8Array(e.target.result);
      
      if (data.byteLength === 0) {
        showToast('El archivo pesa 0 bytes. Asegurate de cerrarlo en Excel antes de subirlo.', 'error');
        return;
      }

      const workbook = XLSX.read(data, { type: 'array' });
      
      let bestRows = [];
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
        if (rows.length > bestRows.length) {
          bestRows = rows;
        }
      }

      if (bestRows.length < 2) { 
        showToast('El archivo no tiene filas suficientes o está vacío.', 'warning'); 
        return; 
      }

      const keywords = ['código', 'codigo', 'descripción', 'descripcion', 'producto', 'artículo', 'articulo', 'precio', 'ean', 'barra', 'rubro', 'categoría', 'talle', 'detalle', 'unitario'];
      let headerIndex = 0; let maxScore = 0;

      for (let i = 0; i < Math.min(bestRows.length, 100); i++) {
        const row = bestRows[i];
        if (!row || !row.length) continue;
        let score = 0;
        row.forEach(cell => {
          const str = String(cell || '').toLowerCase().trim();
          if (keywords.some(kw => str.includes(kw))) score++;
        });
        if (score > maxScore) { maxScore = score; headerIndex = i; }
      }

      const rawHeaders = bestRows[headerIndex];
      const headers = [];
      const headerCounts = {}; 

      for (let i = 0; i < rawHeaders.length; i++) {
        let h = String(rawHeaders[i] || '').toLowerCase().trim();
        if (!h) h = `columna_${i + 1}`; 
        if (headerCounts[h]) { headerCounts[h]++; h = `${h}_${headerCounts[h]}`; } 
        else { headerCounts[h] = 1; }
        headers.push(h);
      }

      const validDataRows = bestRows.slice(headerIndex + 1).filter(r => r.length > 0 && r.some(c => c !== '' && c !== undefined && c !== null));

      const dataObjects = validDataRows.map(rowArray => {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = rowArray[i] !== undefined ? rowArray[i] : ''; });
        return obj;
      });

      if (currentCsvMode === 'upload') {
        aplicarPerfilYMostrar(dataObjects);
      } else if (currentCsvMode === 'new-prov') {
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
      if (!yaSeleccionado && terminos.some(t => h.includes(t))) { selected = 'selected'; yaSeleccionado = true; }
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
  showToast('Excel analizado. Revisá la asignación de columnas.', 'success');
}

document.getElementById('btn-save-provider').addEventListener('click', async () => {
  const nombreProv = document.getElementById('new-prov-name').value.trim();
  if (!nombreProv) { showToast('Falta el nombre del proveedor', 'warning'); return; }

  const idProv = nombreProv.toLowerCase().replace(/[^a-z0-9]/g, '');
  const mapeoActual = {};
  document.querySelectorAll('.map-select').forEach(sel => { 
    if(sel.value) mapeoActual[sel.dataset.db] = sel.value; 
  });

  const btn = document.getElementById('btn-save-provider');
  btn.disabled = true;
  btn.textContent = 'Guardando en la nube...';

  const { error } = await supabase.from('perfiles_proveedores').upsert({
    id: idProv,
    nombre: nombreProv,
    mapeo: mapeoActual
  });

  btn.disabled = false;
  btn.textContent = '💾 Guardar Perfil Permanente';

  if (error) { showToast('Error al guardar en Supabase: ' + error.message, 'error'); return; }

  showToast(`Perfil de ${nombreProv} guardado en la nube.`, 'success');
  
  await cargarPerfilesGuardados(); 
  
  document.querySelector('.csv-mode-btn[data-mode="upload"]').click();
  document.getElementById('csv-proveedor-selector').value = idProv;
  document.getElementById('new-prov-name').value = ''; 
});

function aplicarPerfilYMostrar(dataObjects) {
  const proveedorKey = document.getElementById('csv-proveedor-selector').value;
  const config = configProveedores[proveedorKey];

  if (!config) { showToast('Perfil de proveedor no encontrado', 'error'); return; }
  const m = config.mapeo;

  csvData = dataObjects.map(rowObj => {
    if(m.nombre && !rowObj[m.nombre]) return null;

    return {
      nombre: m.nombre && rowObj[m.nombre] ? String(rowObj[m.nombre]) : 'Sin nombre',
      ean: m.ean && rowObj[m.ean] ? String(rowObj[m.ean]) : null,
      categoria: m.categoria && rowObj[m.categoria] ? String(rowObj[m.categoria]) : 'General',
      proveedor: config.nombreDB || null,
      precio_venta: m.precio_venta && rowObj[m.precio_venta] ? parseFloat(rowObj[m.precio_venta]) : 0,
      precio_costo: m.precio_costo && rowObj[m.precio_costo] ? parseFloat(rowObj[m.precio_costo]) : 0,
      stock_actual: 0,
      stock_minimo: 5
    };
  }).filter(r => r !== null && r.nombre !== 'Sin nombre');

  renderCSVPreview();
}

function validarCSVRow(r) {
  const warnings = [];
  const pv = r.precio_venta;
  if (pv === '' || pv === null || pv === undefined) {
    warnings.push('Precio vacío');
  } else {
    const pvNum = parseFloat(pv);
    if (isNaN(pvNum))  warnings.push('Precio no es un número');
    else if (pvNum < 0) warnings.push('Precio negativo');
    else if (pvNum === 0) warnings.push('Precio = $0');
  }
  return warnings;
}

function renderCSVPreview() {
  const el = document.getElementById('csv-preview');
  const btn = document.getElementById('btn-importar-csv');

  if (csvData.length === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:0.867rem">No se encontraron productos válidos o las columnas del archivo no coinciden con el perfil elegido.</p>';
    btn.style.display = 'none'; return;
  }

  const conWarnings = csvData.filter(r => validarCSVRow(r).length > 0);
  const sinProblemas = csvData.filter(r => validarCSVRow(r).length === 0);
  const omitirCheck = document.getElementById('csv-omitir-sin-precio')?.checked;
  const preview = csvData.slice(0, 8);

  // Detalle de los productos con problema
  let warningDetalle = '';
  if (conWarnings.length) {
    const motivosAgrupados = {};
    conWarnings.forEach(r => {
      const motivo = validarCSVRow(r).join(', ');
      if (!motivosAgrupados[motivo]) motivosAgrupados[motivo] = [];
      motivosAgrupados[motivo].push(r.nombre);
    });
    const detalleRows = Object.entries(motivosAgrupados).map(([motivo, nombres]) => {
      const lista = nombres.slice(0, 3).map(n =>
        `<li style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px">${n}</li>`
      ).join('');
      const resto = nombres.length > 3 ? `<li style="color:var(--text-dim)">…y ${nombres.length - 3} más</li>` : '';
      return `<div style="margin-bottom:6px">
        <strong style="color:var(--amber)">${motivo}</strong> (${nombres.length}):
        <ul style="margin:3px 0 0 16px;font-size:11px;color:var(--text-2)">${lista}${resto}</ul>
      </div>`;
    }).join('');

    warningDetalle = `
      <div style="background:var(--amber-dim);border:1px solid rgba(240,165,0,.3);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:12px;font-size:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <strong style="color:var(--amber)">⚠️ ${conWarnings.length} producto${conWarnings.length>1?'s':''} con problemas de precio</strong>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--text-2)">
            <input type="checkbox" id="csv-omitir-sin-precio" ${omitirCheck?'checked':''} onchange="window.toggleOmitirSinPrecio()">
            Omitir estos al importar
          </label>
        </div>
        ${detalleRows}
      </div>`;
  }

  const totalAImportar = omitirCheck ? sinProblemas.length : csvData.length;

  el.innerHTML = `
    <div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:10px">
      ${csvData.length} productos detectados
      ${conWarnings.length
        ? `· <span style="color:var(--amber)">⚠️ ${conWarnings.length} con problemas</span>${omitirCheck ? ` · <span style="color:var(--green)">se importarán ${sinProblemas.length}</span>` : ''}`
        : '· <span style="color:var(--green)">✅ Datos listos</span>'}
    </div>
    ${warningDetalle}
    <div class="table-wrap">
      <table>
        <thead><tr><th>Producto</th><th>Prov.</th><th>Precio</th><th>Costo</th><th></th></tr></thead>
        <tbody>
          ${preview.map(r => {
            const warns = validarCSVRow(r);
            return `<tr style="${warns.length ? 'background:var(--amber-dim)' : ''}">
              <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.nombre}</td>
              <td style="font-size:0.8rem;color:var(--teal)">${r.proveedor || '—'}</td>
              <td style="color:${warns.length ? 'var(--amber)' : 'var(--teal)'}">
                ${r.precio_venta !== '' && r.precio_venta != null ? '$' + parseFloat(r.precio_venta).toLocaleString('es-AR') : '<em style="color:var(--amber)">vacío</em>'}
              </td>
              <td style="color:var(--text-muted)">${r.precio_costo ? '$' + parseFloat(r.precio_costo).toLocaleString('es-AR') : '—'}</td>
              <td style="font-size:0.7rem;color:var(--amber)">${warns.join(' · ')}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
    ${csvData.length > 8 ? `<div style="font-size:0.8rem;color:var(--text-dim);margin-top:6px">…y ${csvData.length - 8} más</div>` : ''}`;

  btn.style.display = '';
  btn.textContent = `✅ Subir ${totalAImportar} producto${totalAImportar !== 1 ? 's' : ''}`;
}

window.toggleOmitirSinPrecio = () => renderCSVPreview();

document.getElementById('btn-importar-csv').addEventListener('click', async () => {
  if (!csvData.length) return;
  const btn = document.getElementById('btn-importar-csv');
  const previewEl = document.getElementById('csv-preview');

  // Verificar sesión activa antes de empezar
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    showToast('Sesión expirada. Recargá la página e iniciá sesión de nuevo.', 'error', 6000);
    return;
  }

  btn.disabled = true; btn.textContent = 'Guardando en base de datos...';

  const omitir = document.getElementById('csv-omitir-sin-precio')?.checked;
  const filas = omitir ? csvData.filter(r => validarCSVRow(r).length === 0) : csvData;

  const total = filas.length;
  previewEl.innerHTML = `
    <div id="import-progress-wrap" style="padding:12px 0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:13px;font-weight:600">Importando productos…</span>
        <span id="import-progress-counter" style="font-size:12px;color:var(--text-muted)">0 / ${total}</span>
      </div>
      <div style="height:6px;background:var(--border-strong);border-radius:3px;overflow:hidden">
        <div id="import-progress-fill" style="height:100%;width:0%;background:var(--teal);border-radius:3px;transition:width 0.2s"></div>
      </div>
      <div id="import-progress-status" style="font-size:11px;color:var(--text-muted);margin-top:6px"></div>
    </div>`;

  const fillEl = document.getElementById('import-progress-fill');
  const counterEl = document.getElementById('import-progress-counter');
  const statusEl = document.getElementById('import-progress-status');

  let ok = 0; const errores = [];
  for (let i = 0; i < filas.length; i++) {
    const row = filas[i];
    const ean = row.ean ? String(row.ean).trim() : null;
    const sku = ean ? `EAN-${ean}` : `SKU-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;

    let error;
    if (ean) {
      ({ error } = await supabase.from('productos').upsert({ ean, sku, ...row }, { onConflict: 'ean' }));
    } else {
      ({ error } = await supabase.from('productos').insert({ sku, ...row }));
    }
    if (error) {
      errores.push({ nombre: row.nombre, motivo: error.message });
      // Al primer error, parar y mostrar detalle completo
      if (i === 0) {
        btn.disabled = false;
        const detail = `code: ${error.code} | msg: ${error.message} | hint: ${error.hint || '-'} | details: ${error.details || '-'}`;
        console.error('Supabase insert error:', error);
        showToast('Error al guardar: ' + error.message, 'error', 10000);
        previewEl.innerHTML = `<div style="color:var(--red);font-size:12px;font-weight:600;word-break:break-all">❌ Error en primer producto:<br><code style="font-size:11px">${detail}</code></div>`;
        return;
      }
    } else ok++;

    const pct = Math.round((i + 1) / total * 100);
    fillEl.style.width = pct + '%';
    counterEl.textContent = `${i + 1} / ${total}`;
    statusEl.textContent = `${ok} OK${errores.length ? ` · ${errores.length} error${errores.length !== 1 ? 'es' : ''}` : ''}`;
  }

  btn.disabled = false;
  showToast(`${ok} guardados${errores.length ? ` · ${errores.length} errores` : ''}`, errores.length > 0 ? 'warning' : 'success', 6000);
  previewEl.innerHTML = `<div style="color:var(--green);font-size:0.9rem;font-weight:600">✅ Importación finalizada: ${ok} producto${ok !== 1 ? 's' : ''} guardado${ok !== 1 ? 's' : ''}${errores.length ? ` · ${errores.length} con error` : ''}.</div>`;
  csvData = []; btn.style.display = 'none';
  cargarProductos();
});

// ── Lógica del Escáner Rápido ──
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
    await bulkScanner.start({ facingMode: 'environment' }, { fps: 15, qrbox: { width: 280, height: 100 } }, onBulkEAN, () => {});
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
  if (bulkScanner) { try { await bulkScanner.stop(); bulkScanner.clear(); } catch(e){} bulkScanner = null; }
  document.getElementById('scan-bulk-container').style.display = 'none';
}

async function onBulkEAN(ean) {
  await detenerScanBulk();
  const { data } = await supabase.from('productos').select('id,nombre').eq('ean', ean).maybeSingle();
  if (data) {
    showToast(`Ya existe: ${data.nombre}`, 'warning', 2500);
    reiniciarScanBulk(); return;
  }

  document.getElementById('bulk-ean-detectado').textContent = ean;
  document.getElementById('bulk-nombre').value = ''; document.getElementById('bulk-categoria').value = '';
  document.getElementById('bulk-proveedor').value = ''; document.getElementById('bulk-precio-venta').value = '';
  document.getElementById('bulk-precio-costo').value = ''; document.getElementById('bulk-stock').value = '1';
  document.getElementById('bulk-stock-min').value = '5';
  document.getElementById('bulk-scan-form').style.display = '';

  const cats = [...new Set(todosProductos.map(p => p.categoria).filter(Boolean))].sort().slice(0, 8);
  document.getElementById('bulk-cat-sugerencias').innerHTML = cats.map(c => `<button type="button" class="btn btn-secondary" style="padding:3px 10px;font-size:11px" onclick="document.getElementById('bulk-categoria').value='${c}'">${c}</button>`).join('');
  setTimeout(() => document.getElementById('bulk-nombre').focus(), 100);
}

document.getElementById('btn-guardar-bulk').addEventListener('click', async () => {
  const nombre = document.getElementById('bulk-nombre').value.trim();
  const categoria = document.getElementById('bulk-categoria').value.trim();
  const precio_venta = parseFloat(document.getElementById('bulk-precio-venta').value);
  const ean = document.getElementById('bulk-ean-detectado').textContent;

  if (!nombre || !categoria || !precio_venta) { showToast('Nombre, categoría y precio venta son obligatorios', 'warning'); return; }

  const btn = document.getElementById('btn-guardar-bulk'); btn.disabled = true;

  const { error } = await supabase.from('productos').insert({
    ean, sku: `EAN-${ean}`, nombre, categoria,
    proveedor: document.getElementById('bulk-proveedor').value.trim() || null,
    precio_venta, precio_costo: parseFloat(document.getElementById('bulk-precio-costo').value) || 0,
    stock_actual: parseInt(document.getElementById('bulk-stock').value) || 1,
  });

  btn.disabled = false;
  if (error) { showToast('Error: ' + error.message, 'error'); return; }

  bulkCount++; document.getElementById('scan-counter').innerHTML = `${bulkCount} <span>cargados hoy</span>`;
  showToast(`${nombre} guardado`, 'success', 1500); reiniciarScanBulk();
});

document.getElementById('btn-skip-bulk').addEventListener('click', reiniciarScanBulk);

async function reiniciarScanBulk() {
  document.getElementById('bulk-scan-form').style.display = 'none';
  document.getElementById('scan-bulk-container').style.display = '';
  document.getElementById('btn-iniciar-scan-bulk').style.display = 'none';
  bulkScanner = new Html5Qrcode('scan-bulk-container');
  try { await bulkScanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 250, height: 160 } }, onBulkEAN, () => {});
  } catch (err) {
    document.getElementById('scan-bulk-container').style.display = 'none';
    document.getElementById('btn-iniciar-scan-bulk').style.display = '';
  }
}

// Inicializar Script
init();
