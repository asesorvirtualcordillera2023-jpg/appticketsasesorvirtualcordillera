-- FIX VALORACIÓN PÚBLICA CON SUPABASE RPC
-- Ejecuta este archivo en Supabase > SQL Editor.
-- Soluciona el error: new row violates row-level security policy for table "tickets".

create or replace function public.get_ticket_rating(
  p_ticket_id uuid,
  p_token text
)
returns table (
  id uuid,
  id_str text,
  asunto text,
  estado text,
  usuario_nombre text,
  valoracion_calificacion int
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.id_str, t.asunto, t.estado, t.usuario_nombre, t.valoracion_calificacion
  from public.tickets t
  where t.id = p_ticket_id
    and t.rating_token = p_token
    and t.estado = 'Resuelto'
  limit 1;
$$;

create or replace function public.submit_ticket_rating(
  p_ticket_id uuid,
  p_token text,
  p_calificacion int,
  p_comentario text default ''
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_calificacion is null or p_calificacion < 1 or p_calificacion > 5 then
    return jsonb_build_object('success', false, 'message', 'La calificación debe estar entre 1 y 5 estrellas.');
  end if;

  update public.tickets
     set valoracion_calificacion = p_calificacion,
         valoracion_comentario = coalesce(p_comentario, ''),
         valoracion_fecha = now(),
         rating_token = null
   where id = p_ticket_id
     and rating_token = p_token
     and estado = 'Resuelto'
     and valoracion_calificacion is null
   returning id into v_id;

  if v_id is null then
    return jsonb_build_object('success', false, 'message', 'El ticket no existe, ya fue valorado o el enlace venció.');
  end if;

  return jsonb_build_object('success', true, 'message', 'Valoración registrada correctamente.');
end;
$$;

grant execute on function public.get_ticket_rating(uuid, text) to anon, authenticated;
grant execute on function public.submit_ticket_rating(uuid, text, int, text) to anon, authenticated;
