import { supabase, showToast } from './supabase.js';

const TIPOS = {
  evento:   { label: 'Evento',             clase: 'tipo-evento'  },
  entrega:  { label: 'Entrega mercadería', clase: 'tipo-entrega' },
  cheque:   { label: 'Vencto. cheque',     clase: 'tipo-cheque'  },
  pago:     { label: 'Pago',              clase: 'tipo-pago'    },
  reunion:  { label: 'Reunión',            clase: 'tipo-reunion' },
  otro:     { label: 'Otro',              clase: 'tipo-otro'    },
};

let mesActual = new Date().getMonth();
let anioActual = new Date().getFullYear();
let todosEventos = [];
let filtroTipo = '';
let editandoId = null;

const overlay  = document.getElementById('modal-overlay');
const lista    = document.getElementById('cal-lista');
const monthLbl = document.getElementById('cal-month-label');

async function cargar() {
  const { data } = await supabase.from('calendario').select('*').order('fecha').order('hora');
  todosEventos = data || [];
  renderLista();
}

function renderLista() {
  const inicio = new Date(anioActual, mesActual, 1);
  const fin    = new Date(anioActual, mesActual + 1, 0);
  const hoy    = new Date().toISOString().split('T')[0];

  const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  monthLbl.textContent = `${MESES[mesActual]} ${anioActual}`;

  const inicioStr = inicio.toISOString().split('T')[0];
  const finStr    = fin.toISOString().split('T')[0];

  let eventos = todosEventos.filter(e => e.fecha >= inicioStr && e.fecha <= finStr);
  if (filtroTipo) eventos = eventos.filter(e => e.tipo === filtroTipo);

  if (!eventos.length) {
    lista.innerHTML = `<div class="cal-empty">Sin eventos este mes<br><span style="font-size:11px">Usá "+ Nuevo evento" para agregar uno</span></div>`;
    return;
  }

  // Agrupar por día
  const porDia = {};
  eventos.forEach(e => {
    if (!porDia[e.fecha]) porDia[e.fecha] = [];
    porDia[e.fecha].push(e);
  });

  const DIAS_ES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
  lista.innerHTML = Object.entries(porDia).map(([fecha, evs]) => {
    const d = new Date(fecha + 'T12:00:00');
    const esHoy = fecha === hoy;
    const esPasado = fecha < hoy;
    const labelDia = `${DIAS_ES[d.getDay()]} ${d.getDate()} — ${MESES[d.getMonth()]}${esHoy ? ' · HOY' : ''}`;
    const headerStyle = esPasado && !esHoy ? 'opacity:0.45' : '';
    return `
      <div class="cal-day-group">
        <div class="cal-day-header ${esHoy ? 'hoy' : ''}" style="${headerStyle}">${labelDia}</div>
        ${evs.map(e => {
          const t = TIPOS[e.tipo] || TIPOS.evento;
          const hora = e.hora ? e.hora.slice(0,5) : 'Todo el día';
          return `
          <div class="cal-event" data-id="${e.id}" style="${esPasado && !esHoy ? 'opacity:0.5' : ''}">
            <div class="cal-event-hora">${hora}</div>
            <div style="flex:1">
              <div class="cal-event-titulo">${e.titulo}</div>
              ${e.descripcion ? `<div class="cal-event-desc">${e.descripcion}</div>` : ''}
            </div>
            <span class="cal-tipo-badge ${t.clase}">${t.label}</span>
          </div>`;
        }).join('')}
      </div>`;
  }).join('');

  lista.querySelectorAll('.cal-event[data-id]').forEach(el => {
    el.addEventListener('click', () => abrirEditar(el.dataset.id));
  });
}

function abrirNuevo() {
  editandoId = null;
  document.getElementById('modal-titulo').textContent = 'Nuevo evento';
  document.getElementById('ev-id').value = '';
  document.getElementById('ev-titulo').value = '';
  document.getElementById('ev-fecha').value = new Date().toISOString().split('T')[0];
  document.getElementById('ev-hora').value = '';
  document.getElementById('ev-tipo').value = 'evento';
  document.getElementById('ev-descripcion').value = '';
  document.getElementById('btn-eliminar').style.display = 'none';
  overlay.classList.remove('hidden');
  setTimeout(() => document.getElementById('ev-titulo').focus(), 50);
}

function abrirEditar(id) {
  const e = todosEventos.find(ev => ev.id === id);
  if (!e) return;
  editandoId = id;
  document.getElementById('modal-titulo').textContent = 'Editar evento';
  document.getElementById('ev-id').value = e.id;
  document.getElementById('ev-titulo').value = e.titulo;
  document.getElementById('ev-fecha').value = e.fecha;
  document.getElementById('ev-hora').value = e.hora ? e.hora.slice(0,5) : '';
  document.getElementById('ev-tipo').value = e.tipo || 'evento';
  document.getElementById('ev-descripcion').value = e.descripcion || '';
  document.getElementById('btn-eliminar').style.display = '';
  overlay.classList.remove('hidden');
}

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

  // Navegar al mes del evento guardado
  const d = new Date(fecha + 'T12:00:00');
  mesActual  = d.getMonth();
  anioActual = d.getFullYear();

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

document.getElementById('btn-nuevo').addEventListener('click', abrirNuevo);
document.getElementById('btn-guardar').addEventListener('click', guardar);
document.getElementById('btn-eliminar').addEventListener('click', eliminar);
document.getElementById('btn-cancelar').addEventListener('click', () => overlay.classList.add('hidden'));
document.getElementById('btn-cerrar-modal').addEventListener('click', () => overlay.classList.add('hidden'));
overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.add('hidden'); });

document.getElementById('btn-prev').addEventListener('click', () => {
  mesActual--;
  if (mesActual < 0) { mesActual = 11; anioActual--; }
  renderLista();
});
document.getElementById('btn-next').addEventListener('click', () => {
  mesActual++;
  if (mesActual > 11) { mesActual = 0; anioActual++; }
  renderLista();
});
document.getElementById('btn-hoy-nav').addEventListener('click', () => {
  mesActual  = new Date().getMonth();
  anioActual = new Date().getFullYear();
  renderLista();
});

document.getElementById('filtro-tipo').addEventListener('change', e => {
  filtroTipo = e.target.value;
  renderLista();
});

cargar();
