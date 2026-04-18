import { supabase, formatMoney, formatDate, showToast } from './supabase.js';
import { checkAuth } from './auth.js';

let todosAlquileres = [];
let filtroEstado = '';
let filtroTexto  = '';

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  const session = await checkAuth();
  if (!session) return;

  const hoy = new Date().toISOString().split('T')[0];
  const en7  = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
  document.getElementById('alq-fecha-inicio').value = hoy;
  document.getElementById('alq-fecha-fin').value    = en7;

  await cargarAlquileres();
  bindEvents();

  supabase.channel('alq-cambios')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'alquileres' }, cargarAlquileres)
    .subscribe();
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function cargarAlquileres() {
  const { data, error } = await supabase
    .from('alquileres')
    .select('*, productos(nombre, sku)')
    .order('fecha_fin_prevista');

  if (error) {
    if (error.code === '42P01') {
      document.getElementById('alq-tbody').innerHTML =
        `<tr><td colspan="9" style="text-align:center;padding:32px;color:var(--text-muted)">
          La tabla <strong>alquileres</strong> todavía no existe en Supabase.
        </td></tr>`;
      return;
    }
    showToast('Error al cargar alquileres', 'error');
    return;
  }

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  todosAlquileres = (data || []).map(a => {
    if (a.estado === 'activo' && new Date(a.fecha_fin_prevista) < hoy) a.estado = 'vencido';
    return a;
  });

  actualizarKPIs();
  renderTabla();
}

function actualizarKPIs() {
  const activos  = todosAlquileres.filter(a => a.estado === 'activo').length;
  const vencidos = todosAlquileres.filter(a => a.estado === 'vencido').length;
  const depositos = todosAlquileres
    .filter(a => a.estado === 'activo' || a.estado === 'vencido')
    .reduce((s, a) => s + Number(a.deposito || 0), 0);
  const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const devueltosMes = todosAlquileres.filter(a =>
    a.estado === 'devuelto' && new Date(a.fecha_devolucion || a.updated_at) >= inicioMes
  ).length;

  // Duración promedio (solo devueltos con fecha_devolucion)
  const devueltos = todosAlquileres.filter(a => a.estado === 'devuelto' && a.fecha_devolucion && a.fecha_inicio);
  const durPromedio = devueltos.length > 0
    ? Math.round(devueltos.reduce((s, a) => {
        return s + (new Date(a.fecha_devolucion) - new Date(a.fecha_inicio)) / 86400000;
      }, 0) / devueltos.length)
    : null;

  // Producto más alquilado (entre todos los alquileres)
  const conteo = {};
  todosAlquileres.forEach(a => {
    const nom = a.productos?.nombre;
    if (nom) conteo[nom] = (conteo[nom] || 0) + 1;
  });
  const masAlq = Object.entries(conteo).sort((a, b) => b[1] - a[1])[0];

  // Ingresos totales (precio_dia × dias reales de todos los alquileres)
  const ingresos = todosAlquileres.reduce((s, a) => s + Number(a.precio_dia || 0) * Math.max(1,
    Math.ceil((new Date(a.fecha_devolucion || a.fecha_fin_prevista) - new Date(a.fecha_inicio)) / 86400000)
  ), 0);

  document.getElementById('kpi-activos').textContent       = activos;
  document.getElementById('kpi-vencidos').textContent      = vencidos;
  document.getElementById('kpi-depositos').textContent     = formatMoney(depositos);
  document.getElementById('kpi-devueltos-mes').textContent = devueltosMes;
  document.getElementById('kpi-duracion-prom').textContent = durPromedio !== null ? durPromedio : '—';
  document.getElementById('kpi-mas-alquilado').textContent = masAlq ? masAlq[0] : '—';
  document.getElementById('kpi-mas-alquilado-cnt').textContent = masAlq ? `${masAlq[1]} vez${masAlq[1] !== 1 ? 'es' : ''}` : '—';
  document.getElementById('kpi-ingresos-alq').textContent  = formatMoney(ingresos);
}

function renderTabla() {
  let lista = todosAlquileres;
  if (filtroEstado) lista = lista.filter(a => a.estado === filtroEstado);
  if (filtroTexto) {
    const q = filtroTexto.toLowerCase();
    lista = lista.filter(a =>
      a.cliente_nombre?.toLowerCase().includes(q) ||
      a.productos?.nombre?.toLowerCase().includes(q)
    );
  }

  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const tbody = document.getElementById('alq-tbody');

  if (lista.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:32px">Sin alquileres</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map((a, idx) => {
    const inicio  = new Date(a.fecha_inicio);
    const fin     = new Date(a.fecha_fin_prevista);
    const diasTotal = Math.ceil((fin - inicio) / 86400000);
    const diasRestantes = Math.ceil((fin - hoy) / 86400000);

    let estadoClass, estadoLabel;
    if (a.estado === 'activo')        { estadoClass = 'alq-estado-activo';   estadoLabel = 'Activo'; }
    else if (a.estado === 'vencido')  { estadoClass = 'alq-estado-vencido';  estadoLabel = 'Vencido'; }
    else                              { estadoClass = 'alq-estado-devuelto'; estadoLabel = 'Devuelto'; }

    let diasHtml;
    if (a.estado === 'devuelto') {
      diasHtml = `<span class="dias-badge" style="color:var(--text-3);background:var(--surface-2)">${diasTotal}d</span>`;
    } else if (a.estado === 'vencido') {
      diasHtml = `<span class="dias-badge" style="color:var(--red);background:var(--red-bg)">+${Math.abs(diasRestantes)}d vencido</span>`;
    } else {
      diasHtml = diasRestantes > 0
        ? `<span class="dias-badge" style="color:${diasRestantes <= 2 ? 'var(--amber)' : 'var(--text-2)'};background:${diasRestantes <= 2 ? 'var(--amber-bg)' : 'var(--surface-2)'}">${diasRestantes}d restantes</span>`
        : `<span class="dias-badge" style="color:var(--red);background:var(--red-bg)">hoy vence</span>`;
    }

    const acciones = a.estado !== 'devuelto'
      ? `<button class="btn btn-ghost btn-sm" onclick="window.abrirDetalle('${a.id}')">Ver</button>
         <button class="btn btn-secondary btn-sm" onclick="window.marcarDevuelto('${a.id}')">Devuelto</button>
         <button class="btn btn-danger btn-sm" onclick="window.borrarAlquiler('${a.id}')">🗑</button>`
      : `<button class="btn btn-ghost btn-sm" onclick="window.abrirDetalle('${a.id}')">Ver</button>
         <button class="btn btn-danger btn-sm" onclick="window.borrarAlquiler('${a.id}')">🗑</button>`;

    return `
      <tr>
        <td style="text-align:center;font-size:12px;color:var(--text-muted);font-weight:600">${idx + 1}</td>
        <td>
          <div style="font-weight:500">${a.cliente_nombre}</div>
          <div style="font-size:11px;color:var(--text-dim)">${a.cliente_telefono || ''}</div>
        </td>
        <td>
          <div style="font-weight:500">${a.productos?.nombre || a.producto_nombre || '—'}</div>
          <div style="font-size:11px;color:var(--text-dim)">${a.productos?.sku || ''}</div>
        </td>
        <td style="font-size:12px">${formatDate(a.fecha_inicio)}</td>
        <td style="font-size:12px">${formatDate(a.fecha_fin_prevista)}</td>
        <td>${diasHtml}</td>
        <td style="font-weight:600">${formatMoney(a.deposito)}</td>
        <td><span class="badge dias-badge ${estadoClass}">${estadoLabel}</span></td>
        <td><div style="display:flex;gap:6px">${acciones}</div></td>
      </tr>`;
  }).join('');
}

// ── Detalle ───────────────────────────────────────────────────────────────────
window.abrirDetalle = (id) => {
  const a = todosAlquileres.find(x => x.id === id);
  if (!a) return;

  const content = document.getElementById('detalle-alq-content');
  const actions = document.getElementById('detalle-alq-actions');
  const producto = a.productos?.nombre || a.producto_nombre || '—';
  const fuenteLabel = a.fuente_stock === 'nuevo' ? '📦 Stock nuevo' : '🔄 Pool alquiler';

  const waLink = a.cliente_telefono
    ? (() => {
        const tel = a.cliente_telefono.replace(/\D/g, '');
        const num = tel.startsWith('0') ? '54' + tel.slice(1) : tel.startsWith('54') ? tel : '54' + tel;
        const vence = formatDate(a.fecha_fin_prevista);
        const msg = encodeURIComponent(`Hola ${a.cliente_nombre}! Te recordamos que el alquiler de *${producto}* vence el *${vence}*. Cualquier consulta estamos a disposición.\n\n🦴 *Ortopedia Caseros*\nValentín Gómez 4784, Caseros\n+54 11 3578-9985`);
        return `https://wa.me/${num}?text=${msg}`;
      })()
    : null;

  content.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">CLIENTE</div><strong>${a.cliente_nombre}</strong></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">TELÉFONO</div>${a.cliente_telefono || '—'}</div>
      <div style="grid-column:1/-1"><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">PRODUCTO</div><strong>${producto}</strong></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">ORIGEN</div>${fuenteLabel}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">INICIO</div>${formatDate(a.fecha_inicio)}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">VENCE</div>${formatDate(a.fecha_fin_prevista)}</div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">DEPÓSITO</div><strong>${formatMoney(a.deposito)}</strong></div>
      <div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">PRECIO / DÍA</div>${formatMoney(a.precio_por_dia)}</div>
      ${a.fecha_devolucion ? `<div><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">DEVUELTO</div>${formatDate(a.fecha_devolucion)}</div>` : ''}
      ${a.notas ? `<div style="grid-column:1/-1"><div style="color:var(--text-3);font-size:11px;margin-bottom:2px">NOTAS</div><span style="color:var(--text-2)">${a.notas}</span></div>` : ''}
    </div>`;

  const calLink = a.fecha_fin_prevista
    ? `<a href="calendario.html?fecha=${a.fecha_fin_prevista}&titulo=${encodeURIComponent('Vence alquiler: ' + a.cliente_nombre)}&tipo=evento" class="btn btn-ghost btn-sm" style="text-decoration:none">📅 Cal.</a>`
    : '';
  actions.innerHTML = a.estado !== 'devuelto'
    ? `<button class="btn btn-primary btn-full" onclick="window.marcarDevuelto('${a.id}');document.getElementById('modal-detalle-alq').classList.add('hidden')">✅ Marcar como devuelto</button>
       ${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">📲 WhatsApp</a>` : ''}
       ${calLink}
       <button class="btn btn-secondary" onclick="window.abrirEditarAlq('${a.id}')">✏️ Editar</button>
       <button class="btn btn-danger" onclick="window.borrarAlquiler('${a.id}');document.getElementById('modal-detalle-alq').classList.add('hidden')">🗑 Borrar</button>`
    : `${waLink ? `<a href="${waLink}" target="_blank" class="btn btn-secondary" style="display:inline-flex;align-items:center;gap:6px;text-decoration:none">📲 WhatsApp</a>` : ''}
       ${calLink}
       <button class="btn btn-secondary" onclick="window.abrirEditarAlq('${a.id}')">✏️ Editar</button>
       <button class="btn btn-danger" onclick="window.borrarAlquiler('${a.id}');document.getElementById('modal-detalle-alq').classList.add('hidden')">🗑 Borrar alquiler</button>`;

  document.getElementById('modal-detalle-alq').classList.remove('hidden');
};

// ── Marcar devuelto — siempre suma a stock_alquiler ───────────────────────────
window.marcarDevuelto = async (id) => {
  const a = todosAlquileres.find(x => x.id === id);
  const { error } = await supabase
    .from('alquileres')
    .update({ estado: 'devuelto', fecha_devolucion: new Date().toISOString() })
    .eq('id', id);
  if (error) { showToast('Error: ' + error.message, 'error'); return; }

  // El producto devuelto siempre entra al pool de alquiler
  if (a?.producto_id) {
    const { data: prod } = await supabase
      .from('productos').select('stock_alquiler').eq('id', a.producto_id).single();
    if (prod) {
      await supabase.from('productos')
        .update({ stock_alquiler: (prod.stock_alquiler || 0) + 1 })
        .eq('id', a.producto_id);
    }
  }

  showToast('Alquiler marcado como devuelto — producto vuelve al pool', 'success');
  cargarAlquileres();
};

// ── Borrar — restaura stock si el alquiler estaba activo ──────────────────────
window.borrarAlquiler = async (id) => {
  const a = todosAlquileres.find(x => x.id === id);
  if (!a) return;
  const nombre = a.productos?.nombre || a.producto_nombre || 'este producto';
  if (!confirm(`¿Borrar el alquiler de ${a.cliente_nombre} (${nombre})? Esta acción no se puede deshacer.`)) return;

  // Si estaba activo/vencido, devolver el producto al stock correspondiente
  if (a.estado !== 'devuelto' && a.producto_id) {
    const campo = a.fuente_stock === 'nuevo' ? 'stock_actual' : 'stock_alquiler';
    const { data: prod } = await supabase
      .from('productos').select(campo).eq('id', a.producto_id).single();
    if (prod) {
      await supabase.from('productos')
        .update({ [campo]: (prod[campo] || 0) + 1 })
        .eq('id', a.producto_id);
    }
  }

  const { error } = await supabase.from('alquileres').delete().eq('id', id);
  if (error) { showToast('Error al borrar: ' + error.message, 'error'); return; }
  showToast('Alquiler eliminado', 'success');
  cargarAlquileres();
};

// ── Nuevo alquiler ────────────────────────────────────────────────────────────
function bindEvents() {
  document.getElementById('btn-nuevo-alquiler').addEventListener('click', () => {
    document.getElementById('form-nuevo-alq').reset();
    document.getElementById('alq-producto-id').value = '';
    document.getElementById('alq-fuente-stock').value = 'alquiler';
    document.getElementById('alq-fuente-indicator').innerHTML = '';
    const hoy = new Date().toISOString().split('T')[0];
    const en7  = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    document.getElementById('alq-fecha-inicio').value = hoy;
    document.getElementById('alq-fecha-fin').value    = en7;
    document.getElementById('modal-nuevo-alq').classList.remove('hidden');
  });

  document.getElementById('btn-cerrar-nuevo-alq').addEventListener('click', () => {
    document.getElementById('modal-nuevo-alq').classList.add('hidden');
  });
  document.getElementById('btn-cerrar-detalle-alq').addEventListener('click', () => {
    document.getElementById('modal-detalle-alq').classList.add('hidden');
  });

  [document.getElementById('modal-nuevo-alq'), document.getElementById('modal-detalle-alq')].forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) m.classList.add('hidden'); });
  });

  document.getElementById('filtro-estado').addEventListener('change', e => {
    filtroEstado = e.target.value; renderTabla();
  });
  let timer;
  document.getElementById('busqueda-alq').addEventListener('input', e => {
    clearTimeout(timer);
    timer = setTimeout(() => { filtroTexto = e.target.value.trim(); renderTabla(); }, 200);
  });

  // Búsqueda de producto con disponibilidad de stock
  const searchInput = document.getElementById('alq-producto-search');
  const sugerencias = document.getElementById('alq-producto-sugerencias');

  searchInput.addEventListener('input', async () => {
    const q = searchInput.value.trim();
    document.getElementById('alq-producto-id').value = '';
    document.getElementById('alq-fuente-stock').value = 'alquiler';
    document.getElementById('alq-fuente-indicator').innerHTML = '';
    if (!q) { sugerencias.style.display = 'none'; return; }

    const { data } = await supabase
      .from('productos')
      .select('id, nombre, sku, stock_actual, stock_alquiler')
      .eq('activo', true)
      .or(`nombre.ilike.%${q}%,sku.ilike.%${q}%`)
      .limit(8);

    if (!data || !data.length) { sugerencias.style.display = 'none'; return; }

    sugerencias.style.display = 'block';
    sugerencias.innerHTML = data.map(p => {
      const alq = p.stock_alquiler || 0;
      const nuevo = p.stock_actual || 0;
      let stockHtml;
      if (alq > 0 && nuevo > 0) {
        stockHtml = `<span style="color:var(--teal)">🔄 ${alq} para alquiler</span> · <span style="color:var(--text-muted)">📦 ${nuevo} nuevas</span>`;
      } else if (alq > 0) {
        stockHtml = `<span style="color:var(--teal)">🔄 ${alq} disponibles para alquiler</span>`;
      } else if (nuevo > 0) {
        stockHtml = `<span style="color:var(--text-muted)">📦 ${nuevo} nuevas en stock</span>`;
      } else {
        stockHtml = `<span style="color:var(--red)">⚠ Sin stock disponible</span>`;
      }
      return `
        <div style="padding:8px 14px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border)"
          onmousedown="event.preventDefault()"
          onclick="window.seleccionarProductoAlq('${p.id}','${p.nombre.replace(/'/g, "\\'")}',${alq},${nuevo})">
          <div style="font-weight:500">${p.nombre}</div>
          <div style="font-size:11px;margin-top:2px">${stockHtml}</div>
        </div>`;
    }).join('');
  });

  searchInput.addEventListener('blur', () => {
    setTimeout(() => { sugerencias.style.display = 'none'; }, 150);
  });

  // Submit
  document.getElementById('form-nuevo-alq').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const productoId = document.getElementById('alq-producto-id').value;
    const fuente = document.getElementById('alq-fuente-stock').value;

    // Verificar stock antes de continuar
    if (productoId) {
      const campo = fuente === 'nuevo' ? 'stock_actual' : 'stock_alquiler';
      const { data: prod } = await supabase.from('productos').select(campo).eq('id', productoId).single();
      if (!prod || (prod[campo] || 0) <= 0) {
        showToast(`Sin stock disponible en ${fuente === 'nuevo' ? 'inventario' : 'pool de alquiler'}`, 'error');
        return;
      }
    }

    const registro = {
      cliente_nombre:     fd.get('cliente_nombre'),
      cliente_telefono:   fd.get('cliente_telefono') || null,
      producto_id:        productoId || null,
      producto_nombre:    fd.get('producto_nombre'),
      fecha_inicio:       fd.get('fecha_inicio'),
      fecha_fin_prevista: fd.get('fecha_fin_prevista'),
      deposito:           parseFloat(fd.get('deposito')) || 0,
      precio_por_dia:     parseFloat(fd.get('precio_por_dia')) || 0,
      notas:              fd.get('notas') || null,
      estado:             'activo',
      fuente_stock:       fuente,
    };

    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    const { error } = await supabase.from('alquileres').insert(registro);

    if (error) {
      showToast('Error: ' + error.message, 'error');
      btn.disabled = false;
      return;
    }

    // Descontar stock del pool correspondiente
    if (productoId) {
      const campo = fuente === 'nuevo' ? 'stock_actual' : 'stock_alquiler';
      const { data: prod } = await supabase.from('productos').select(campo).eq('id', productoId).single();
      if (prod) {
        await supabase.from('productos')
          .update({ [campo]: Math.max(0, (prod[campo] || 0) - 1) })
          .eq('id', productoId);
      }
    }

    btn.disabled = false;
    showToast('Alquiler registrado', 'success');
    document.getElementById('modal-nuevo-alq').classList.add('hidden');
    cargarAlquileres();
  });
}

window.seleccionarProductoAlq = (id, nombre, stockAlq, stockNuevo) => {
  document.getElementById('alq-producto-id').value     = id;
  document.getElementById('alq-producto-search').value = nombre;
  document.getElementById('alq-producto-sugerencias').style.display = 'none';

  // Auto-seleccionar fuente: pool primero, stock nuevo si no hay pool
  const fuente = stockAlq > 0 ? 'alquiler' : 'nuevo';
  document.getElementById('alq-fuente-stock').value = fuente;
  renderFuenteIndicator(id, stockAlq, stockNuevo, fuente);
};

function renderFuenteIndicator(productoId, stockAlq, stockNuevo, fuente) {
  const el = document.getElementById('alq-fuente-indicator');
  if (!el) return;

  if (stockAlq === 0 && stockNuevo === 0) {
    el.innerHTML = `<span style="color:var(--red)">⚠ Sin stock disponible para alquilar</span>`;
    return;
  }

  const fuenteTexto = fuente === 'alquiler'
    ? `🔄 <strong>Pool de alquiler</strong> (${stockAlq} disponibles)`
    : `📦 <strong>Stock nuevo</strong> (${stockNuevo} disponibles)`;

  const btnCambiar = stockAlq > 0 && stockNuevo > 0
    ? `<button type="button" style="margin-left:8px;font-size:11px;background:none;border:1px solid var(--border);border-radius:4px;padding:1px 7px;cursor:pointer;color:var(--text-muted)"
         onclick="window.cambiarFuenteAlq('${productoId}',${stockAlq},${stockNuevo},'${fuente === 'alquiler' ? 'nuevo' : 'alquiler'}')">
         Usar ${fuente === 'alquiler' ? 'stock nuevo' : 'pool alquiler'}
       </button>`
    : '';

  el.innerHTML = `<span style="color:${fuente === 'alquiler' ? 'var(--teal)' : 'var(--text-muted)'}">${fuenteTexto}</span>${btnCambiar}`;
}

window.cambiarFuenteAlq = (productoId, stockAlq, stockNuevo, nuevaFuente) => {
  document.getElementById('alq-fuente-stock').value = nuevaFuente;
  renderFuenteIndicator(productoId, stockAlq, stockNuevo, nuevaFuente);
};

// ── Editar alquiler ───────────────────────────────────────────────────────────
window.abrirEditarAlq = (id) => {
  const a = todosAlquileres.find(x => x.id === id);
  if (!a) return;
  document.getElementById('modal-detalle-alq').classList.add('hidden');
  document.getElementById('edit-alq-id').value = a.id;
  document.getElementById('edit-alq-nombre').value = a.cliente_nombre || '';
  document.getElementById('edit-alq-telefono').value = a.cliente_telefono || '';
  document.getElementById('edit-alq-fecha-inicio').value = a.fecha_inicio || '';
  document.getElementById('edit-alq-fecha-fin').value = a.fecha_fin_prevista || '';
  document.getElementById('edit-alq-deposito').value = a.deposito || 0;
  document.getElementById('edit-alq-precio-dia').value = a.precio_por_dia || 0;
  document.getElementById('edit-alq-notas').value = a.notas || '';
  document.getElementById('modal-editar-alq').classList.remove('hidden');
};

document.getElementById('btn-cerrar-editar-alq').addEventListener('click', () => {
  document.getElementById('modal-editar-alq').classList.add('hidden');
});
document.getElementById('modal-editar-alq').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-editar-alq')) document.getElementById('modal-editar-alq').classList.add('hidden');
});
document.getElementById('form-editar-alq').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('edit-alq-id').value;
  const updates = {
    cliente_nombre:     document.getElementById('edit-alq-nombre').value,
    cliente_telefono:   document.getElementById('edit-alq-telefono').value || null,
    fecha_inicio:       document.getElementById('edit-alq-fecha-inicio').value || null,
    fecha_fin_prevista: document.getElementById('edit-alq-fecha-fin').value || null,
    deposito:           parseFloat(document.getElementById('edit-alq-deposito').value) || 0,
    precio_por_dia:     parseFloat(document.getElementById('edit-alq-precio-dia').value) || 0,
    notas:              document.getElementById('edit-alq-notas').value || null,
  };
  const btn = e.target.querySelector('[type=submit]');
  btn.disabled = true;
  const { error } = await supabase.from('alquileres').update(updates).eq('id', id);
  btn.disabled = false;
  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Alquiler actualizado', 'success');
  document.getElementById('modal-editar-alq').classList.add('hidden');
  cargarAlquileres();
});

init();
