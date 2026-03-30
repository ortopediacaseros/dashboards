import { supabase, formatMoney, showToast, formatDate } from './supabase.js';

let archivoSeleccionado = null;
let facturaActualId = null;

async function init() {
  await cargarFacturas();
  setupDropZone();
}

// ── Drop zone ──────────────────────────────────────────────
function setupDropZone() {
  const zone = document.getElementById('drop-zone');
  const input = document.getElementById('file-input');

  zone.addEventListener('click', () => input.click());

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('dragover');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('dragover');
    const file = e.dataTransfer.files[0];
    if (file) seleccionarArchivo(file);
  });

  input.addEventListener('change', () => {
    if (input.files[0]) seleccionarArchivo(input.files[0]);
  });

  document.getElementById('btn-cambiar-archivo').addEventListener('click', () => {
    archivoSeleccionado = null;
    document.getElementById('upload-preview').style.display = 'none';
    document.getElementById('drop-zone').style.display = '';
    document.getElementById('file-input').value = '';
  });
}

function seleccionarArchivo(file) {
  const tipos = ['application/pdf', 'image/jpeg', 'image/png', 'text/xml', 'application/xml'];
  if (!tipos.includes(file.type) && !file.name.endsWith('.xml')) {
    showToast('Formato no soportado. Usá PDF, JPG, PNG o XML', 'warning');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('El archivo supera los 10 MB', 'warning');
    return;
  }

  archivoSeleccionado = file;
  document.getElementById('upload-filename').textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  document.getElementById('drop-zone').style.display = 'none';
  document.getElementById('upload-preview').style.display = '';
  // Set fecha por defecto = hoy
  document.getElementById('input-fecha-factura').value = new Date().toISOString().split('T')[0];
}

// ── Subir factura ──────────────────────────────────────────
document.getElementById('btn-subir').addEventListener('click', async () => {
  if (!archivoSeleccionado) { showToast('Seleccioná un archivo primero', 'warning'); return; }

  const proveedor = document.getElementById('input-proveedor').value.trim() || null;
  const numero_factura = document.getElementById('input-nro-factura').value.trim() || null;
  const fecha_factura = document.getElementById('input-fecha-factura').value || null;
  const total = parseFloat(document.getElementById('input-total-factura').value) || null;

  const btn = document.getElementById('btn-subir');
  btn.disabled = true;
  document.getElementById('upload-progress').style.display = '';
  document.getElementById('upload-status').textContent = 'Subiendo archivo...';
  setProgress(30);

  // Nombre único en storage
  const ext = archivoSeleccionado.name.split('.').pop();
  const filename = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;

  const { data: storageData, error: storageError } = await supabase.storage
    .from('facturas')
    .upload(filename, archivoSeleccionado, { contentType: archivoSeleccionado.type });

  setProgress(70);

  if (storageError) {
    showToast('Error al subir el archivo: ' + storageError.message, 'error');
    btn.disabled = false;
    document.getElementById('upload-progress').style.display = 'none';
    return;
  }

  document.getElementById('upload-status').textContent = 'Registrando factura...';

  const { data: urlData } = supabase.storage.from('facturas').getPublicUrl(filename);

  const { error: dbError } = await supabase.from('facturas').insert({
    proveedor,
    numero_factura,
    fecha_factura,
    total,
    archivo_url: storageData.path,
    estado: 'pendiente'
  });

  setProgress(100);

  if (dbError) {
    showToast('Error al registrar: ' + dbError.message, 'error');
    btn.disabled = false;
    document.getElementById('upload-progress').style.display = 'none';
    return;
  }

  showToast('Factura registrada correctamente', 'success');

  // Reset
  archivoSeleccionado = null;
  document.getElementById('upload-preview').style.display = 'none';
  document.getElementById('drop-zone').style.display = '';
  document.getElementById('file-input').value = '';
  document.getElementById('upload-progress').style.display = 'none';
  btn.disabled = false;

  await cargarFacturas();
});

function setProgress(pct) {
  document.getElementById('progress-fill').style.width = pct + '%';
}

// ── Lista de facturas ──────────────────────────────────────
async function cargarFacturas() {
  const filtroEstado = document.getElementById('filtro-estado').value;

  let query = supabase
    .from('facturas')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (filtroEstado) query = query.eq('estado', filtroEstado);

  const { data, error } = await query;
  const el = document.getElementById('facturas-container');

  if (error) { el.innerHTML = '<div class="empty-state">Error al cargar facturas</div>'; return; }
  if (!data || data.length === 0) {
    el.innerHTML = '<div class="empty-state"><div class="icon">🧾</div>Sin facturas registradas</div>';
    return;
  }

  const badgeMap = {
    pendiente: 'badge-amber',
    procesada: 'badge-green',
    error: 'badge-red'
  };

  const header = `
    <div class="factura-row header">
      <span>Proveedor / N° factura</span>
      <span class="hide-mobile">Fecha</span>
      <span>Total</span>
      <span class="hide-mobile">Estado</span>
      <span></span>
    </div>`;

  const filas = data.map(f => `
    <div class="factura-row">
      <div>
        <div style="font-weight:500">${f.proveedor || '(sin nombre)'}</div>
        <div style="font-size:11px;color:var(--text-dim)">${f.numero_factura || '—'}</div>
      </div>
      <div class="hide-mobile" style="color:var(--text-muted);font-size:12px">${f.fecha_factura ? formatDate(f.fecha_factura) : '—'}</div>
      <div style="font-weight:600">${f.total ? formatMoney(f.total) : '—'}</div>
      <div class="hide-mobile"><span class="badge ${badgeMap[f.estado] || 'badge-blue'}">${f.estado}</span></div>
      <div>
        <button class="btn btn-secondary" style="padding:5px 10px;font-size:12px"
          onclick="window.verDetalle('${f.id}')">Ver</button>
      </div>
    </div>`).join('');

  el.innerHTML = header + filas;
}

document.getElementById('filtro-estado').addEventListener('change', cargarFacturas);

// ── Modal detalle ──────────────────────────────────────────
window.verDetalle = async (id) => {
  facturaActualId = id;
  const { data, error } = await supabase
    .from('facturas')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) { showToast('No se pudo cargar la factura', 'error'); return; }

  const badgeMap = { pendiente: 'badge-amber', procesada: 'badge-green', error: 'badge-red' };
  document.getElementById('detalle-content').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      <div><div style="color:var(--text-muted);font-size:11px;margin-bottom:3px">PROVEEDOR</div><div style="font-weight:500">${data.proveedor || '—'}</div></div>
      <div><div style="color:var(--text-muted);font-size:11px;margin-bottom:3px">N° FACTURA</div><div>${data.numero_factura || '—'}</div></div>
      <div><div style="color:var(--text-muted);font-size:11px;margin-bottom:3px">FECHA</div><div>${data.fecha_factura ? formatDate(data.fecha_factura) : '—'}</div></div>
      <div><div style="color:var(--text-muted);font-size:11px;margin-bottom:3px">TOTAL</div><div style="font-weight:600;color:var(--teal)">${data.total ? formatMoney(data.total) : '—'}</div></div>
      <div><div style="color:var(--text-muted);font-size:11px;margin-bottom:3px">ESTADO</div><span class="badge ${badgeMap[data.estado] || ''}">${data.estado}</span></div>
      <div><div style="color:var(--text-muted);font-size:11px;margin-bottom:3px">REGISTRADA</div><div>${formatDate(data.created_at)}</div></div>
    </div>
    ${data.items_detectados ? `<div style="margin-top:14px"><div style="color:var(--text-muted);font-size:11px;margin-bottom:6px">ITEMS DETECTADOS</div><pre style="background:var(--surface-2);border-radius:8px;padding:10px;font-size:11px;overflow:auto;max-height:140px">${JSON.stringify(data.items_detectados, null, 2)}</pre></div>` : ''}
  `;

  // Link archivo
  const linkArchivo = document.getElementById('link-ver-archivo');
  if (data.archivo_url) {
    const { data: urlData } = supabase.storage.from('facturas').getPublicUrl(data.archivo_url);
    linkArchivo.href = urlData?.publicUrl || '#';
    linkArchivo.style.display = '';
  } else {
    linkArchivo.style.display = 'none';
  }

  document.getElementById('btn-marcar-procesada').style.display = data.estado !== 'procesada' ? '' : 'none';
  document.getElementById('modal-detalle').classList.remove('hidden');
};

document.getElementById('btn-cerrar-detalle').addEventListener('click', () => {
  document.getElementById('modal-detalle').classList.add('hidden');
});

document.getElementById('modal-detalle').addEventListener('click', e => {
  if (e.target === document.getElementById('modal-detalle'))
    document.getElementById('modal-detalle').classList.add('hidden');
});

document.getElementById('btn-marcar-procesada').addEventListener('click', async () => {
  if (!facturaActualId) return;
  const { error } = await supabase
    .from('facturas')
    .update({ estado: 'procesada' })
    .eq('id', facturaActualId);

  if (error) { showToast('Error: ' + error.message, 'error'); return; }
  showToast('Factura marcada como procesada', 'success');
  document.getElementById('modal-detalle').classList.add('hidden');
  await cargarFacturas();
});

document.getElementById('btn-eliminar-factura').addEventListener('click', async () => {
  if (!facturaActualId) return;
  if (!confirm('¿Eliminar esta factura? Esta acción no se puede deshacer.')) return;

  const { error } = await supabase
    .from('facturas')
    .delete()
    .eq('id', facturaActualId);

  if (error) { showToast('Error al eliminar: ' + error.message, 'error'); return; }
  showToast('Factura eliminada', 'success');
  document.getElementById('modal-detalle').classList.add('hidden');
  facturaActualId = null;
  await cargarFacturas();
});

init();
