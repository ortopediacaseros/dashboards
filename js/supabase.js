import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://bxcnsykkzwzrbevzquee.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ4Y25zeWtrend6cmJldnpxdWVlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4NzMyODAsImV4cCI6MjA5MDQ0OTI4MH0.oZzblqWjjLWDqJ_CAWxXUqzsdtFMcrNFwdQ4aMCpHdE';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Buscar producto por EAN
export async function buscarPorEAN(ean) {
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .eq('ean', ean)
    .eq('activo', true)
    .single();
  return { data, error };
}

// Buscar producto por texto (nombre o SKU)
export async function buscarPorTexto(texto) {
  const { data, error } = await supabase
    .from('productos')
    .select('*')
    .eq('activo', true)
    .or(`nombre.ilike.%${texto}%,sku.ilike.%${texto}%`)
    .order('nombre');
  return { data, error };
}

// Registrar venta completa (cabecera + items + actualizar stock)
export async function registrarVenta(venta, items) {
  const { data: ventaData, error: ventaError } = await supabase
    .from('ventas')
    .insert(venta)
    .select()
    .single();
  if (ventaError) return { error: ventaError };

  const itemsConId = items.map(i => ({ ...i, venta_id: ventaData.id }));
  const { error: itemsError } = await supabase
    .from('items_venta')
    .insert(itemsConId);
  if (itemsError) return { error: itemsError };

  for (const item of items) {
    await supabase.rpc('descontar_stock', {
      p_producto_id: item.producto_id,
      p_cantidad: item.cantidad
    });
  }

  return { data: ventaData };
}

// Obtener o crear caja del día
export async function getCajaHoy() {
  const hoy = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('cajas')
    .select('*')
    .eq('fecha', hoy)
    .maybeSingle();
  return { data, error };
}

// Crear nueva caja
export async function abrirCaja(efectivo_inicial, comentarios) {
  const hoy = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('cajas')
    .insert({ fecha: hoy, efectivo_inicial, comentarios, estado: 'abierta' })
    .select()
    .single();
  return { data, error };
}

// Cerrar caja
export async function cerrarCaja(caja_id, efectivo_final, comentarios) {
  const { data: ventasDia } = await supabase
    .from('ventas')
    .select('total, caja_id')
    .eq('caja_id', caja_id);

  const total_ventas_dia = (ventasDia || []).reduce((s, v) => s + Number(v.total), 0);
  const { data: cajaData } = await supabase
    .from('cajas')
    .select('efectivo_inicial')
    .eq('id', caja_id)
    .single();

  const efectivo_esperado = (cajaData?.efectivo_inicial || 0) + total_ventas_dia;
  const diferencia = efectivo_final - efectivo_esperado;

  const { data, error } = await supabase
    .from('cajas')
    .update({
      efectivo_final,
      total_ventas_dia,
      diferencia,
      comentarios,
      estado: 'cerrada',
      closed_at: new Date().toISOString()
    })
    .eq('id', caja_id)
    .select()
    .single();
  return { data, error };
}

// Formatear dinero ARS
export function formatMoney(n) {
  if (n == null || isNaN(n)) return '$0';
  return '$' + Number(n).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Formatear fecha
export function formatDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Toast notifications
export function showToast(msg, type = 'success', duration = 3000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}
