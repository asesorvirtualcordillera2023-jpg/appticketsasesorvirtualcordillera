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

create index if not exists idx_informes_documentales_created_at on public.informes_documentales(created_at desc);

create index if not exists idx_tickets_created_at on public.tickets(created_at desc);
create index if not exists idx_tickets_estado on public.tickets(estado);
create index if not exists idx_tickets_rating_token on public.tickets(rating_token);
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
