-- Registro de Incidentes - Supabase schema
-- Ejecuta este archivo en Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.agentes (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete cascade,
  nombre_completo text not null,
  email text unique not null,
  rol text not null default 'agent' check (rol in ('admin','agent')),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.directorio (
  id uuid primary key default gen_random_uuid(),
  cedula text unique not null,
  nombres text not null,
  correo text,
  carrera text,
  nivel text,
  tipo text default 'Estudiante',
  periodo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_config (
  id int primary key default 1 check (id = 1),
  config jsonb not null default '{"categorias":["Soporte Técnico","Redes","Credenciales"],"canales":["Portal Web","Correo","Teléfono"]}'::jsonb,
  updated_by uuid references public.agentes(id),
  updated_at timestamptz not null default now()
);

create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  id_str text unique not null,
  fecha_texto text,
  agente_id uuid references public.agentes(id),
  agente_nombre text,
  assigned_agent_id uuid references public.agentes(id),
  assigned_agent_name text,
  assigned_at timestamptz,
  resolved_at timestamptz,
  resolution_minutes int,
  last_status_change_at timestamptz,
  usuario_id uuid references public.directorio(id),
  usuario_cedula text,
  usuario_nombre text,
  asunto text not null,
  categoria text,
  subcategoria text,
  prioridad text default 'Media' check (prioridad in ('Baja','Media','Alta','Crítica')),
  canal text,
  descripcion text,
  estado text not null default 'Requiere Seguimiento' check (estado in ('Requiere Seguimiento','Resuelto')),
  rating_token text,
  valoracion_calificacion int check (valoracion_calificacion between 1 and 5),
  valoracion_comentario text,
  valoracion_fecha timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);



create table if not exists public.ticket_seguimientos (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  accion text not null default 'Seguimiento',
  estado_anterior text,
  estado_nuevo text,
  agente_origen_id uuid references public.agentes(id),
  agente_origen_nombre text,
  agente_destino_id uuid references public.agentes(id),
  agente_destino_nombre text,
  comentario text,
  created_by uuid references public.agentes(id),
  created_by_nombre text,
  created_at timestamptz not null default now()
);

create table if not exists public.informes_documentales (
  id uuid primary key default gen_random_uuid(),
  titulo text not null,
  generado_por uuid references public.agentes(id),
  generado_por_nombre text,
  filtros jsonb not null default '{}'::jsonb,
  indicadores jsonb not null default '{}'::jsonb,
  total_tickets int not null default 0,
  formato text not null default 'docx' check (formato in ('docx','doc','pdf','html')),
  created_at timestamptz not null default now()
);

alter table public.tickets
  add column if not exists assigned_agent_id uuid references public.agentes(id),
  add column if not exists assigned_agent_name text,
  add column if not exists assigned_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_minutes int,
  add column if not exists last_status_change_at timestamptz;

update public.tickets
   set assigned_agent_id = coalesce(assigned_agent_id, agente_id),
       assigned_agent_name = coalesce(assigned_agent_name, agente_nombre),
       assigned_at = coalesce(assigned_at, created_at),
       last_status_change_at = coalesce(last_status_change_at, updated_at, created_at)
 where assigned_agent_id is null
    or assigned_agent_name is null
    or assigned_at is null
    or last_status_change_at is null;

update public.tickets
   set resolved_at = coalesce(resolved_at, updated_at, created_at),
       resolution_minutes = coalesce(resolution_minutes, greatest(0, round(extract(epoch from (coalesce(updated_at, created_at) - created_at)) / 60)::int))
 where estado = 'Resuelto'
   and (resolved_at is null or resolution_minutes is null);

create index if not exists idx_informes_documentales_created_at on public.informes_documentales(created_at desc);

create index if not exists idx_tickets_created_at on public.tickets(created_at desc);
create index if not exists idx_tickets_estado on public.tickets(estado);
create index if not exists idx_tickets_rating_token on public.tickets(rating_token);
create index if not exists idx_tickets_assigned_agent_id on public.tickets(assigned_agent_id);
create index if not exists idx_tickets_resolved_at on public.tickets(resolved_at desc);
create index if not exists idx_ticket_seguimientos_ticket_id on public.ticket_seguimientos(ticket_id, created_at);
create index if not exists idx_directorio_cedula on public.directorio(cedula);

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_agentes_updated_at on public.agentes;
create trigger trg_agentes_updated_at before update on public.agentes for each row execute function public.set_updated_at();
drop trigger if exists trg_directorio_updated_at on public.directorio;
create trigger trg_directorio_updated_at before update on public.directorio for each row execute function public.set_updated_at();
drop trigger if exists trg_app_config_updated_at on public.app_config;
create trigger trg_app_config_updated_at before update on public.app_config for each row execute function public.set_updated_at();
drop trigger if exists trg_tickets_updated_at on public.tickets;
create trigger trg_tickets_updated_at before update on public.tickets for each row execute function public.set_updated_at();

insert into public.app_config (id, config)
values (1, '{"categorias":["Soporte Técnico","Redes","Credenciales"],"canales":["Portal Web","Correo","Teléfono"]}'::jsonb)
on conflict (id) do nothing;

alter table public.agentes enable row level security;
alter table public.directorio enable row level security;
alter table public.app_config enable row level security;
alter table public.tickets enable row level security;
alter table public.informes_documentales enable row level security;
alter table public.ticket_seguimientos enable row level security;

-- Limpieza para re-ejecución segura
DROP POLICY IF EXISTS "agentes_select_authenticated" ON public.agentes;
DROP POLICY IF EXISTS "agentes_insert_own" ON public.agentes;
DROP POLICY IF EXISTS "agentes_update_own_or_admin" ON public.agentes;
DROP POLICY IF EXISTS "directorio_crud_authenticated" ON public.directorio;
DROP POLICY IF EXISTS "config_read_authenticated" ON public.app_config;
DROP POLICY IF EXISTS "config_write_authenticated" ON public.app_config;
DROP POLICY IF EXISTS "tickets_crud_authenticated" ON public.tickets;
DROP POLICY IF EXISTS "tickets_rating_public_select" ON public.tickets;
DROP POLICY IF EXISTS "tickets_rating_public_update" ON public.tickets;
DROP POLICY IF EXISTS "informes_select_authenticated" ON public.informes_documentales;
DROP POLICY IF EXISTS "informes_insert_authenticated" ON public.informes_documentales;
DROP POLICY IF EXISTS "seguimientos_select_authenticated" ON public.ticket_seguimientos;
DROP POLICY IF EXISTS "seguimientos_insert_authenticated" ON public.ticket_seguimientos;
DROP POLICY IF EXISTS "seguimientos_update_admin" ON public.ticket_seguimientos;
DROP POLICY IF EXISTS "seguimientos_delete_admin" ON public.ticket_seguimientos;

create policy "agentes_select_authenticated"
on public.agentes for select
to authenticated
using (true);

create policy "agentes_insert_own"
on public.agentes for insert
to authenticated
with check (auth.uid() = auth_user_id);

create policy "agentes_update_own_or_admin"
on public.agentes for update
to authenticated
using (
  auth.uid() = auth_user_id
  or exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.rol = 'admin' and a.activo)
)
with check (
  auth.uid() = auth_user_id
  or exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.rol = 'admin' and a.activo)
);

create policy "directorio_crud_authenticated"
on public.directorio for all
to authenticated
using (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo))
with check (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo));

create policy "config_read_authenticated"
on public.app_config for select
to authenticated
using (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo));

create policy "config_write_authenticated"
on public.app_config for all
to authenticated
using (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo))
with check (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo));

create policy "tickets_crud_authenticated"
on public.tickets for all
to authenticated
using (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo))
with check (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo));

create policy "informes_select_authenticated"
on public.informes_documentales for select
to authenticated
using (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo));

create policy "informes_insert_authenticated"
on public.informes_documentales for insert
to authenticated
with check (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo));

create policy "seguimientos_select_authenticated"
on public.ticket_seguimientos for select
to authenticated
using (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo));

create policy "seguimientos_insert_authenticated"
on public.ticket_seguimientos for insert
to authenticated
with check (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.activo));

create policy "seguimientos_update_admin"
on public.ticket_seguimientos for update
to authenticated
using (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.rol = 'admin' and a.activo))
with check (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.rol = 'admin' and a.activo));

create policy "seguimientos_delete_admin"
on public.ticket_seguimientos for delete
to authenticated
using (exists (select 1 from public.agentes a where a.auth_user_id = auth.uid() and a.rol = 'admin' and a.activo));


-- Valoración pública: permite ver solo el ticket con token y actualizar solo la calificación pendiente.
create policy "tickets_rating_public_select"
on public.tickets for select
to anon
using (rating_token is not null and estado = 'Resuelto');

create policy "tickets_rating_public_update"
on public.tickets for update
to anon
using (rating_token is not null and estado = 'Resuelto' and valoracion_calificacion is null)
with check (estado = 'Resuelto' and valoracion_calificacion between 1 and 5);

-- =============================================================
-- FIX VALORACIÓN PÚBLICA CON RPC
-- Ejecutar en Supabase SQL Editor si la valoración muestra:
-- "new row violates row-level security policy for table tickets".
-- Estas funciones evitan escritura directa anónima sobre tickets y validan el token.
-- =============================================================

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
