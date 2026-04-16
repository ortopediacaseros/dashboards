/**
 * notificaciones.js — Browser Notifications API
 * Revisa alquileres venciendo hoy y plantillas listas, muestra notificaciones
 * al abrir el dashboard si el usuario dio permiso.
 */
import { supabase } from './supabase.js';

const STORAGE_KEY = 'notif_ultima_check';

export async function iniciarNotificaciones() {
  // Solo actúa si Notification API está disponible
  if (!('Notification' in window)) return;

  // Pedir permiso si aún es "default"
  if (Notification.permission === 'default') {
    await Notification.requestPermission();
  }

  if (Notification.permission !== 'granted') return;

  // No molestar más de una vez por hora
  const ultima = parseInt(localStorage.getItem(STORAGE_KEY) || '0');
  if (Date.now() - ultima < 60 * 60 * 1000) return;
  localStorage.setItem(STORAGE_KEY, String(Date.now()));

  const hoy = new Date().toISOString().split('T')[0];

  const [{ data: alquileres }, { data: plantillas }] = await Promise.all([
    supabase
      .from('alquileres')
      .select('cliente_nombre, productos(nombre), fecha_fin_prevista')
      .lte('fecha_fin_prevista', hoy)
      .not('estado', 'eq', 'devuelto'),
    supabase
      .from('pedidos_plantillas')
      .select('cliente_nombre, pie')
      .eq('estado', 'listo'),
  ]);

  const vencenHoy    = (alquileres || []).filter(a => a.fecha_fin_prevista === hoy);
  const yaVencidos   = (alquileres || []).filter(a => a.fecha_fin_prevista < hoy);
  const listasHoy    = plantillas || [];

  if (vencenHoy.length > 0) {
    new Notification('🔔 Alquileres que vencen hoy', {
      body: vencenHoy.map(a => `${a.cliente_nombre || 'Cliente'} — ${a.productos?.nombre || '—'}`).join('\n'),
      icon: '/img/logo.webp',
    });
  }

  if (yaVencidos.length > 0) {
    new Notification(`🔴 ${yaVencidos.length} alquiler${yaVencidos.length !== 1 ? 'es' : ''} vencido${yaVencidos.length !== 1 ? 's' : ''}`, {
      body: yaVencidos.slice(0, 3).map(a => `${a.cliente_nombre || 'Cliente'} — ${a.productos?.nombre || '—'}`).join('\n'),
      icon: '/img/logo.webp',
    });
  }

  if (listasHoy.length > 0) {
    new Notification(`✅ ${listasHoy.length} plantilla${listasHoy.length !== 1 ? 's' : ''} lista${listasHoy.length !== 1 ? 's' : ''} para entregar`, {
      body: listasHoy.slice(0, 3).map(p => `${p.cliente_nombre || 'Cliente'} — pie ${p.pie || '—'}`).join('\n'),
      icon: '/img/logo.webp',
    });
  }
}
