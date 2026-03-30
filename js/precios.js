import { supabase, formatMoney, showToast, formatDate } from './supabase.js';

let todosProductos = [];
let productosFiltrados = [];

async function init() {
  await cargarProductos();
  await cargarHistorial();
}

async function cargarProductos() {
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .eq('activo', true)
    .order('categoria, nombre');

  if (error) { showToast('Error al cargar productos', 'error'); return; }
  todosProductos = data || [];
  llenarCategorias();
}

function llenarCategorias() {
  const cats = [...new Set(todosProductos.map(p => p.categoria))].sort();
  const sel = document.getElementById('sel-categoria');
  sel.innerHTML = '<option value="">Todas las categorías</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
}

document.getElementById('btn-preview').addEventListener('click', () => {
  const cat = document.getElementById('sel-categoria').value;
  const tipo = document.getElementById('sel-tipo').value;
  const pct = parseFloat(document.getElementById('input-pct').value);

  if (isNaN(pct) || pct === 0) {
    showToast('Ingresá un porcentaje distinto de 0', 'warning');
    return;
  }

  productosFiltrados = cat
    ? todosProductos.filter(p => p.categoria === cat)
    : [...todosProductos];

  if (productosFiltrados.length === 0) {
    showToast('No hay productos para la categoría seleccionada', 'warning');
    return;
  }

  renderPreview(productosFiltrados, pct, tipo);
  document.getElementById('card-preview').style.display = '';
  document.getElementById('btn-aplicar').disabled = false;
  document.getElementById('aviso-cantidad').textContent =
    `Se modificarán ${productosFiltrados.length} producto${productosFiltrados.length !== 1 ? 's' : ''}`;

  const tipoLabel = tipo === 'venta' ? 'venta' : tipo === 'costo' ? 'costo' : 'venta y costo';
  const dir = pct > 0 ? `+${pct}%` : `${pct}%`;
  document.getElementById('preview-titulo').textContent = `Preview — ${dir} en precio de ${tipoLabel}`;
  document.getElementById('preview-count').textContent = `${productosFiltrados.length} productos`;
});

function renderPreview(productos, pct, tipo) {
  const factor = 1 + pct / 100;
  const container = document.getElementById('preview-container');

  const header = `
    <div class="preview-row header">
      <span>Producto</span>
      <span>${tipo === 'costo' ? 'P. Costo actual' : 'P. Venta actual'}</span>
      <span></span>
      <span>${tipo === 'costo' ? 'P. Costo nuevo' : 'P. Venta nuevo'}</span>
    </div>`;

  const filas = productos.slice(0, 50).map(p => {
    let actual, nuevo;
    if (tipo === 'venta' || tipo === 'ambos') {
      actual = p.precio_venta;
      nuevo = Math.round(actual * factor * 100) / 100;
    } else {
      actual = p.precio_costo;
      nuevo = Math.round(actual * factor * 100) / 100;
    }
    return `
      <div class="preview-row">
        <span style="font-weight:500">${p.nombre}<br><span style="font-size:11px;color:var(--text-dim)">${p.categoria}</span></span>
        <span style="color:var(--text-muted)">${formatMoney(actual)}</span>
        <span class="arrow">→</span>
        <span class="price-new">${formatMoney(nuevo)}</span>
      </div>`;
  }).join('');

  const mas = productos.length > 50
    ? `<div style="text-align:center;padding:12px;color:var(--text-dim);font-size:12px">... y ${productos.length - 50} más</div>`
    : '';

  container.innerHTML = header + filas + mas;
}

document.getElementById('btn-cancelar-preview').addEventListener('click', () => {
  document.getElementById('card-preview').style.display = 'none';
  document.getElementById('btn-aplicar').disabled = true;
});

document.getElementById('btn-aplicar').addEventListener('click', async () => {
  const pct = parseFloat(document.getElementById('input-pct').value);
  const tipo = document.getElementById('sel-tipo').value;
  const motivo = document.getElementById('input-motivo').value.trim() || null;
  const factor = 1 + pct / 100;
  const btn = document.getElementById('btn-aplicar');

  btn.disabled = true;
  btn.textContent = 'Aplicando...';

  let ok = 0, err = 0;
  const histItems = [];

  for (const p of productosFiltrados) {
    const updates = {};
    if (tipo === 'venta' || tipo === 'ambos') {
      const nuevo = Math.round(p.precio_venta * factor * 100) / 100;
      updates.precio_venta = nuevo;
      histItems.push({ producto_id: p.id, precio_anterior: p.precio_venta, precio_nuevo: nuevo, tipo: 'venta', motivo });
    }
    if (tipo === 'costo' || tipo === 'ambos') {
      const nuevo = Math.round(p.precio_costo * factor * 100) / 100;
      updates.precio_costo = nuevo;
      histItems.push({ producto_id: p.id, precio_anterior: p.precio_costo, precio_nuevo: nuevo, tipo: 'costo', motivo });
    }

    const { error } = await supabase.from('productos').update(updates).eq('id', p.id);
    if (error) err++; else ok++;
  }

  // Registrar historial en batch
  if (histItems.length > 0) {
    await supabase.from('historial_precios').insert(histItems);
  }

  btn.disabled = false;
  btn.textContent = '✅ Aplicar cambios';

  if (err > 0) {
    showToast(`${ok} actualizados, ${err} con error`, 'warning');
  } else {
    showToast(`${ok} producto${ok !== 1 ? 's' : ''} actualizado${ok !== 1 ? 's' : ''} correctamente`, 'success');
  }

  document.getElementById('card-preview').style.display = 'none';
  document.getElementById('input-pct').value = '';
  document.getElementById('input-motivo').value = '';
  await cargarProductos();
  await cargarHistorial();
});

async function cargarHistorial() {
  const { data, error } = await supabase
    .from('historial_precios')
    .select('*, productos(nombre, categoria)')
    .order('created_at', { ascending: false })
    .limit(50);

  const el = document.getElementById('historial-container');
  if (error || !data || data.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="icon">📋</div>Sin historial de cambios</div>';
    return;
  }

  const header = `
    <div class="hist-row" style="font-size:11px;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.06em;border-bottom:1px solid var(--border-strong)">
      <span>Fecha</span>
      <span>Producto</span>
      <span>Tipo</span>
      <span>Anterior</span>
      <span>Nuevo</span>
    </div>`;

  const filas = data.map(h => {
    const diff = h.precio_nuevo - h.precio_anterior;
    const pct = h.precio_anterior > 0 ? Math.round((diff / h.precio_anterior) * 100) : 0;
    const color = diff > 0 ? 'var(--amber)' : diff < 0 ? 'var(--teal)' : 'var(--text-muted)';
    return `
      <div class="hist-row">
        <span style="font-size:12px;color:var(--text-muted)">${formatDate(h.created_at)}</span>
        <span>
          <div style="font-weight:500;font-size:13px">${h.productos?.nombre || '—'}</div>
          <div style="font-size:11px;color:var(--text-dim)">${h.motivo || ''}</div>
        </span>
        <span><span class="badge ${h.tipo === 'venta' ? 'badge-teal' : 'badge-blue'}">${h.tipo}</span></span>
        <span style="color:var(--text-muted)">${formatMoney(h.precio_anterior)}</span>
        <span style="color:${color};font-weight:600">${formatMoney(h.precio_nuevo)} <span style="font-size:11px">(${pct > 0 ? '+' : ''}${pct}%)</span></span>
      </div>`;
  }).join('');

  el.innerHTML = header + filas;
}

init();
