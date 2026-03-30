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
