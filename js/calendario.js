import { supabase, showToast } from './supabase.js';

// ─────────────────────────────────────────────────
// Tipos de evento
// ─────────────────────────────────────────────────
const TIPOS = {
  evento:   { label: 'Evento',             clase: 'tipo-evento',  dot: 'cal-dot-evento',   icon: '📅' },
  entrega:  { label: 'Entrega mercadería', clase: 'tipo-entrega', dot: 'cal-dot-entrega',  icon: '📦' },
  cheque:   { label: 'Vto. cheque',        clase: 'tipo-cheque',  dot: 'cal-dot-cheque',   icon: '🏦' },
  pago:     { label: 'Pago',              clase: 'tipo-pago',    dot: 'cal-dot-pago',     icon: '💳' },
  reunion:  { label: 'Reunión',            clase: 'tipo-reunion', dot: 'cal-dot-reunion',  icon: '🤝' },
  otro:     { label: 'Otro',              clase: 'tipo-otro',    dot: 'cal-dot-otro',     icon: '📌' },
};

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ─────────────────────────────────────────────────
// Feriados Argentina
// ─────────────────────────────────────────────────
function calcularPascua(anio) {
  const a = anio % 19, b = Math.floor(anio / 100), c = anio % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes - 1, dia);
}

// Mueve feriado al lunes más cercano según ley argentina:
// si cae mar o mié → lunes anterior; si cae jue o vie → lunes siguiente
function lunesCercano(anio, mes, dia) {
  const d = new Date(anio, mes - 1, dia);
  const dow = d.getDay(); // 0=Dom 1=Lun … 6=Sáb
  if (dow === 2) d.setDate(d.getDate() - 1);       // Mar → Lun anterior
  else if (dow === 3) d.setDate(d.getDate() + 4);  // Mié → Lun siguiente... wait
  // Corrección: Mié → lunes siguiente (5 días después sería lunes: 3+4=7? no)
  // dow=3 (mié) +5 días = dom, no. Lun siguiente = 3→1 : +5 no.
  // Mié=3, Lun siguiente = 3+(7-3+1)=8? No.
  // Mié=3, próximo Lun = 3 + (7 - 3 + 1) = 8 días → 3+5=8 no. 3→Jue=4→Vie=5→Sáb=6→Dom=0→Lun=1 → 5 días
  // Corrijo abajo
  return d;
}

function lunesMasCercano(anio, mes, dia) {
  const d = new Date(anio, mes - 1, dia);
  const dow = d.getDay();
  if (dow === 0) d.setDate(d.getDate() + 1);       // Dom → Lun sig
  else if (dow === 2) d.setDate(d.getDate() - 1);  // Mar → Lun ant
  else if (dow === 3) d.setDate(d.getDate() + 5);  // Mié → Lun sig (5 días)
  else if (dow === 4) d.setDate(d.getDate() + 4);  // Jue → Lun sig (4 días)
  else if (dow === 5) d.setDate(d.getDate() + 3);  // Vie → Lun sig (3 días)
  else if (dow === 6) d.setDate(d.getDate() + 2);  // Sáb → Lun sig (2 días)
  // Lun (1) → sin cambio
  return d.toISOString().split('T')[0];
}

const cacheFeriados = {};
function feriadosArgentina(anio) {
  if (cacheFeriados[anio]) return cacheFeriados[anio];

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const pascua = calcularPascua(anio);

  const movDia = (base, delta) => {
    const d = new Date(base);
    d.setDate(d.getDate() + delta);
    return fmt(d);
  };

  const feriados = [
    // Fijos
    { fecha: `${anio}-01-01`, nombre: 'Año Nuevo' },
    { fecha: `${anio}-03-24`, nombre: 'Día de la Memoria' },
    { fecha: `${anio}-04-02`, nombre: 'Veteranos de Malvinas' },
    { fecha: `${anio}-05-01`, nombre: 'Día del Trabajador' },
    { fecha: `${anio}-05-25`, nombre: 'Revolución de Mayo' },
    { fecha: `${anio}-07-09`, nombre: 'Día de la Independencia' },
    { fecha: `${anio}-12-08`, nombre: 'Inmaculada Concepción' },
    { fecha: `${anio}-12-25`, nombre: 'Navidad' },
    // Semana Santa (móviles)
    { fecha: movDia(pascua, -3), nombre: 'Jueves Santo' },
    { fecha: movDia(pascua, -2), nombre: 'Viernes Santo' },
    // Carnaval
    { fecha: movDia(pascua, -48), nombre: 'Carnaval' },
    { fecha: movDia(pascua, -47), nombre: 'Carnaval' },
    // Traslados al lunes más cercano
    { fecha: lunesMasCercano(anio, 6, 20),  nombre: 'Día de Güemes' },
    { fecha: lunesMasCercano(anio, 8, 17),  nombre: 'Paso de San Martín' },
    { fecha: lunesMasCercano(anio, 10, 12), nombre: 'Diversidad Cultural' },
    { fecha: lunesMasCercano(anio, 11, 20), nombre: 'Soberanía Nacional' },
  ];

  const mapa = {};
  feriados.forEach(f => {
    if (!mapa[f.fecha]) mapa[f.fecha] = [];
    mapa[f.fecha].push(f.nombre);
  });

  cacheFeriados[anio] = mapa;
  return mapa;
}

// ─────────────────────────────────────────────────
// Estado
// ─────────────────────────────────────────────────
let mesActual  = new Date().getMonth();
let anioActual = new Date().getFullYear();
let todosEventos   = [];   // tabla calendario
let alqFechas      = {};   // { 'YYYY-MM-DD': [{ cliente, producto }] }
let pltFechas      = {};   // { 'YYYY-MM-DD': [{ cliente, pie }] }
let ventasDias     = new Set(); // fechas con ventas
let diaSeleccionado = null;
let editandoId     = null;
let filtroTipo     = '';

const overlay     = document.getElementById('modal-overlay');
const detalleEl   = document.getElementById('cal-detalle');

// ─────────────────────────────────────────────────
// Carga de datos
// ─────────────────────────────────────────────────
async function cargar() {
  const inicio = new Date(anioActual, mesActual, 1).toISOString().split('T')[0];
  const fin    = new Date(anioActual, mesActual + 1, 0).toISOString().split('T')[0];

  const [
    { data: evs },
    { data: alqs },
    { data: plts },
    { data: ventas },
  ] = await Promise.all([
    supabase.from('calendario').select('*').order('fecha').order('hora'),
    supabase.from('alquileres')
      .select('id,cliente_nombre,productos(nombre),fecha_fin_prevista')
      .not('estado','eq','devuelto')
      .gte('fecha_fin_prevista', inicio).lte('fecha_fin_prevista', fin),
    supabase.from('pedidos_plantillas')
      .select('id,cliente_nombre,pie,fecha_entrega_prevista')
      .not('estado','in','("entregado")')
      .not('fecha_entrega_prevista','is','null')
      .gte('fecha_entrega_prevista', inicio).lte('fecha_entrega_prevista', fin),
    supabase.from('ventas')
      .select('fecha')
      .gte('fecha', inicio+'T00:00:00').lte('fecha', fin+'T23:59:59')
      .not('estado','eq','anulada'),
  ]);

  todosEventos = evs || [];

  alqFechas = {};
  (alqs || []).forEach(a => {
    if (!alqFechas[a.fecha_fin_prevista]) alqFechas[a.fecha_fin_prevista] = [];
    alqFechas[a.fecha_fin_prevista].push({ cliente: a.cliente_nombre, producto: a.productos?.nombre || '—', id: a.id });
  });

  pltFechas = {};
  (plts || []).forEach(p => {
    if (!pltFechas[p.fecha_entrega_prevista]) pltFechas[p.fecha_entrega_prevista] = [];
    pltFechas[p.fecha_entrega_prevista].push({ cliente: p.cliente_nombre, pie: p.pie, id: p.id });
  });

  ventasDias = new Set((ventas || []).map(v => v.fecha.split('T')[0]));

  renderGrid();
  if (diaSeleccionado) renderDetalle(diaSeleccionado);
}

// ─────────────────────────────────────────────────
// Render grid
// ─────────────────────────────────────────────────
function renderGrid() {
  document.getElementById('cal-month-label').textContent = `${MESES[mesActual]} ${anioActual}`;

  const hoy      = new Date().toISOString().split('T')[0];
  const feriados = feriadosArgentina(anioActual);

  const primerDia  = new Date(anioActual, mesActual, 1);
  const ultimoDia  = new Date(anioActual, mesActual + 1, 0);
  const startDow   = primerDia.getDay(); // 0=Dom
  const grid       = document.getElementById('cal-grid');

  // Agrupar eventos del mes por fecha
  const eventosPorDia = {};
  const inicio = primerDia.toISOString().split('T')[0];
  const fin    = ultimoDia.toISOString().split('T')[0];
  let eventosFiltrados = todosEventos.filter(e => e.fecha >= inicio && e.fecha <= fin);
  if (filtroTipo) eventosFiltrados = eventosFiltrados.filter(e => e.tipo === filtroTipo);
  eventosFiltrados.forEach(e => {
    if (!eventosPorDia[e.fecha]) eventosPorDia[e.fecha] = [];
    eventosPorDia[e.fecha].push(e);
  });

  const cells = [];

  // Celdas del mes anterior (relleno)
  const mesPrev = new Date(anioActual, mesActual, 0);
  for (let i = startDow - 1; i >= 0; i--) {
    const d = mesPrev.getDate() - i;
    cells.push({ dia: d, fecha: null, otroMes: true });
  }
  // Celdas del mes actual
  for (let d = 1; d <= ultimoDia.getDate(); d++) {
    const pad = (n) => String(n).padStart(2, '0');
    const fecha = `${anioActual}-${pad(mesActual + 1)}-${pad(d)}`;
    cells.push({ dia: d, fecha, otroMes: false });
  }
  // Celdas del mes siguiente (relleno hasta completar 6 filas = 42 celdas)
  const resto = 42 - cells.length;
  for (let d = 1; d <= resto; d++) {
    cells.push({ dia: d, fecha: null, otroMes: true });
  }

  const DOW_FIN_SEMANA = [0, 6]; // dom, sáb

  grid.innerHTML = cells.map(({ dia, fecha, otroMes }) => {
    if (otroMes) return `<div class="cal-cell otro-mes"><div class="cal-cell-num">${dia}</div></div>`;

    const esHoy   = fecha === hoy;
    const esSel   = fecha === diaSeleccionado;
    const ferList = feriados[fecha];
    const dow     = new Date(fecha + 'T12:00:00').getDay();
    const esFin   = DOW_FIN_SEMANA.includes(dow);
    const tieneAlq = alqFechas[fecha]?.length > 0;
    const tieneVenta = ventasDias.has(fecha);
    const eventosHoy = eventosPorDia[fecha] || [];
    const tienePlt = pltFechas[fecha]?.length > 0;

    const clases = ['cal-cell'];
    if (esHoy) clases.push('hoy');
    if (esSel && !esHoy) clases.push('seleccionado');
    if (ferList) clases.push('feriado');
    if (esFin) clases.push('fin-semana');

    // Dots: feriado + por tipo evento + alquiler + plantilla + venta
    const dots = [];
    if (ferList) dots.push('<span class="cal-dot cal-dot-feriado"></span>');
    const tiposVistos = new Set();
    eventosHoy.forEach(e => {
      const tipo = e.tipo || 'evento';
      if (!tiposVistos.has(tipo)) {
        tiposVistos.add(tipo);
        dots.push(`<span class="cal-dot ${TIPOS[tipo]?.dot || 'cal-dot-evento'}"></span>`);
      }
    });
    if (tieneAlq) dots.push('<span class="cal-dot cal-dot-alquiler"></span>');
    if (tienePlt) dots.push('<span class="cal-dot cal-dot-plantilla"></span>');
    if (tieneVenta) dots.push('<span class="cal-dot cal-dot-venta"></span>');

    const ferNombre = ferList ? `<div class="cal-feriado-label">${ferList[0]}</div>` : '';

    return `<div class="${clases.join(' ')}" data-fecha="${fecha}">
      <div class="cal-cell-num">${dia}</div>
      ${ferNombre}
      <div class="cal-cell-dots">${dots.join('')}</div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.cal-cell[data-fecha]').forEach(el => {
    el.addEventListener('click', () => seleccionarDia(el.dataset.fecha));
  });
}

// ─────────────────────────────────────────────────
// Seleccionar día y mostrar detalle
// ─────────────────────────────────────────────────
function seleccionarDia(fecha) {
  diaSeleccionado = fecha;
  renderGrid();
  renderDetalle(fecha);
}

function renderDetalle(fecha) {
  const hoy      = new Date().toISOString().split('T')[0];
  const feriados = feriadosArgentina(anioActual);
  const d = new Date(fecha + 'T12:00:00');
  const DIAS = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  const label = `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}${fecha === hoy ? ' — Hoy' : ''}`;

  const ferList = feriados[fecha];
  const eventosDelDia = todosEventos.filter(e => e.fecha === fecha && (!filtroTipo || e.tipo === filtroTipo));
  const alqsDelDia    = alqFechas[fecha] || [];
  const pltsDelDia    = pltFechas[fecha] || [];

  const totalItems = eventosDelDia.length + alqsDelDia.length + pltsDelDia.length + (ferList ? 1 : 0);

  detalleEl.style.display = '';

  let html = `<div class="cal-detalle-header">
    <span>${label}</span>
    <button class="btn btn-primary btn-sm" onclick="window.abrirNuevoEnFecha('${fecha}')">+ Agregar evento</button>
  </div>`;

  if (totalItems === 0) {
    html += `<div class="cal-detalle-empty">Sin eventos para este día — clic en "+ Agregar evento" para crear uno.</div>`;
  } else {
    const items = [];

    if (ferList) {
      ferList.forEach(nombre => {
        items.push(`<div class="cal-detalle-item">
          <div class="cal-detalle-icon" style="background:var(--amber-bg)">🇦🇷</div>
          <div>
            <div class="cal-detalle-titulo">${nombre}</div>
            <div class="cal-detalle-sub">Feriado nacional</div>
          </div>
        </div>`);
      });
    }

    eventosDelDia.sort((a, b) => (a.hora || '99') < (b.hora || '99') ? -1 : 1).forEach(e => {
      const t = TIPOS[e.tipo] || TIPOS.evento;
      const hora = e.hora ? e.hora.slice(0, 5) : 'Todo el día';
      items.push(`<div class="cal-detalle-item">
        <div class="cal-detalle-icon tipo-${e.tipo || 'evento'}" style="background:var(--brand-dim)">${t.icon}</div>
        <div style="flex:1">
          <div class="cal-detalle-titulo">${e.titulo}</div>
          <div class="cal-detalle-sub">${hora}${e.descripcion ? ' · ' + e.descripcion : ''}</div>
        </div>
        <div class="cal-detalle-actions">
          <span class="badge" style="font-size:10px" class="${t.clase}">${t.label}</span>
          <button class="btn btn-ghost btn-sm" onclick="window.editarEvento('${e.id}')">✏️</button>
        </div>
      </div>`);
    });

    alqsDelDia.forEach(a => {
      items.push(`<div class="cal-detalle-item">
        <div class="cal-detalle-icon" style="background:var(--red-bg)">🔄</div>
        <div style="flex:1">
          <div class="cal-detalle-titulo">${a.cliente} — ${a.producto}</div>
          <div class="cal-detalle-sub">Vencimiento de alquiler</div>
        </div>
        <a href="alquileres.html" class="btn btn-ghost btn-sm">Ver →</a>
      </div>`);
    });

    pltsDelDia.forEach(p => {
      items.push(`<div class="cal-detalle-item">
        <div class="cal-detalle-icon" style="background:var(--green-bg)">🦶</div>
        <div style="flex:1">
          <div class="cal-detalle-titulo">${p.cliente} — Pie ${p.pie || '—'}</div>
          <div class="cal-detalle-sub">Entrega prevista de plantilla</div>
        </div>
        <a href="plantillas.html" class="btn btn-ghost btn-sm">Ver →</a>
      </div>`);
    });

    html += items.join('');
  }

  detalleEl.innerHTML = html;
}

// ─────────────────────────────────────────────────
// Modal CRUD
// ─────────────────────────────────────────────────
function abrirModal({ id = null, titulo = '', fecha = null, hora = '', tipo = 'evento', descripcion = '' } = {}) {
  editandoId = id;
  document.getElementById('modal-titulo').textContent = id ? 'Editar evento' : 'Nuevo evento';
  document.getElementById('ev-id').value = id || '';
  document.getElementById('ev-titulo').value = titulo;
  document.getElementById('ev-fecha').value = fecha || new Date().toISOString().split('T')[0];
  document.getElementById('ev-hora').value = hora;
  document.getElementById('ev-tipo').value = tipo;
  document.getElementById('ev-descripcion').value = descripcion;
  document.getElementById('btn-eliminar').style.display = id ? '' : 'none';
  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('ev-titulo').focus(), 50);
}

window.abrirNuevoEnFecha = (fecha) => abrirModal({ fecha });
window.editarEvento = (id) => {
  const e = todosEventos.find(ev => ev.id === id);
  if (!e) return;
  abrirModal({ id: e.id, titulo: e.titulo, fecha: e.fecha, hora: e.hora?.slice(0, 5) || '', tipo: e.tipo || 'evento', descripcion: e.descripcion || '' });
};

async function guardar() {
  const titulo = document.getElementById('ev-titulo').value.trim();
  const fecha  = document.getElementById('ev-fecha').value;
  if (!titulo || !fecha) { showToast('Completá título y fecha', 'error'); return; }

  const payload = {
    titulo,
    fecha,
    hora: document.getElementById('ev-hora').value || null,
    tipo: document.getElementById('ev-tipo').value,
    descripcion: document.getElementById('ev-descripcion').value.trim() || null,
  };

  let error;
  if (editandoId) {
    ({ error } = await supabase.from('calendario').update(payload).eq('id', editandoId));
  } else {
    ({ error } = await supabase.from('calendario').insert(payload));
  }

  if (error) { showToast('Error al guardar: ' + error.message, 'error'); return; }
  showToast(editandoId ? 'Evento actualizado' : 'Evento agregado', 'success');
  overlay.classList.add('hidden');

  // Navegar al mes del evento
  const d = new Date(fecha + 'T12:00:00');
  mesActual  = d.getMonth();
  anioActual = d.getFullYear();
  diaSeleccionado = fecha;
  await cargar();
}

async function eliminar() {
  if (!editandoId) return;
  if (!confirm('¿Eliminar este evento?')) return;
  const { error } = await supabase.from('calendario').delete().eq('id', editandoId);
  if (error) { showToast('Error al eliminar', 'error'); return; }
  showToast('Evento eliminado', 'success');
  overlay.classList.add('hidden');
  await cargar();
}

// ─────────────────────────────────────────────────
// Exportar mes para WhatsApp
// ─────────────────────────────────────────────────
function exportarMes() {
  const feriados = feriadosArgentina(anioActual);
  const inicio = new Date(anioActual, mesActual, 1).toISOString().split('T')[0];
  const fin    = new Date(anioActual, mesActual + 1, 0).toISOString().split('T')[0];

  const eventosDelMes = todosEventos.filter(e => e.fecha >= inicio && e.fecha <= fin);
  const alqsMes = Object.entries(alqFechas).filter(([f]) => f >= inicio && f <= fin);
  const pltsMes = Object.entries(pltFechas).filter(([f]) => f >= inicio && f <= fin);

  const porFecha = {};
  const add = (fecha, txt) => { if (!porFecha[fecha]) porFecha[fecha] = []; porFecha[fecha].push(txt); };

  Object.entries(feriados)
    .filter(([f]) => f >= inicio && f <= fin)
    .forEach(([f, nombres]) => add(f, `🇦🇷 ${nombres.join(' · ')}`));

  eventosDelMes.forEach(e => {
    const t = TIPOS[e.tipo] || TIPOS.evento;
    const hora = e.hora ? ` ${e.hora.slice(0,5)}` : '';
    add(e.fecha, `${t.icon}${hora} ${e.titulo}${e.descripcion ? ` (${e.descripcion})` : ''}`);
  });

  alqsMes.forEach(([f, alqs]) => alqs.forEach(a => add(f, `🔄 Vence alquiler: ${a.cliente} — ${a.producto}`)));
  pltsMes.forEach(([f, plts]) => plts.forEach(p => add(f, `🦶 Entrega plantilla: ${p.cliente} — Pie ${p.pie || '—'}`)));

  if (!Object.keys(porFecha).length) { showToast('No hay eventos este mes', 'info'); return; }

  const DIAS = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  let texto = `📅 *Eventos ${MESES[mesActual]} ${anioActual}*\n\n`;
  Object.keys(porFecha).sort().forEach(fecha => {
    const d = new Date(fecha + 'T12:00:00');
    texto += `*${DIAS[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}*\n`;
    porFecha[fecha].forEach(l => { texto += `  ${l}\n`; });
    texto += '\n';
  });

  navigator.clipboard.writeText(texto).then(() => {
    showToast('Copiado al portapapeles — listo para pegar en WhatsApp', 'success');
  }).catch(() => {
    const ta = document.createElement('textarea');
    ta.value = texto;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('Copiado — listo para pegar en WhatsApp', 'success');
  });
}

// ─────────────────────────────────────────────────
// Eventos de UI
// ─────────────────────────────────────────────────
document.getElementById('btn-nuevo').addEventListener('click', () => abrirModal());
document.getElementById('btn-guardar').addEventListener('click', guardar);
document.getElementById('btn-eliminar').addEventListener('click', eliminar);
document.getElementById('btn-cancelar').addEventListener('click', () => overlay.classList.add('hidden'));
document.getElementById('btn-cerrar-modal').addEventListener('click', () => overlay.classList.add('hidden'));
overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });
document.getElementById('btn-exportar').addEventListener('click', exportarMes);

document.getElementById('btn-prev').addEventListener('click', () => {
  if (mesActual === 0) { mesActual = 11; anioActual--; } else mesActual--;
  diaSeleccionado = null;
  detalleEl.style.display = 'none';
  cargar();
});
document.getElementById('btn-next').addEventListener('click', () => {
  if (mesActual === 11) { mesActual = 0; anioActual++; } else mesActual++;
  diaSeleccionado = null;
  detalleEl.style.display = 'none';
  cargar();
});
document.getElementById('btn-hoy-nav').addEventListener('click', () => {
  mesActual  = new Date().getMonth();
  anioActual = new Date().getFullYear();
  diaSeleccionado = new Date().toISOString().split('T')[0];
  cargar();
});
document.getElementById('filtro-tipo').addEventListener('change', e => {
  filtroTipo = e.target.value;
  renderGrid();
  if (diaSeleccionado) renderDetalle(diaSeleccionado);
});

// Seleccionar hoy al cargar
diaSeleccionado = new Date().toISOString().split('T')[0];
cargar();
