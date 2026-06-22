-- Migración segura: módulo independiente de Atención Secretaría / Estudiantil
-- No borra ni modifica datos existentes de tickets IT, agentes, directorio o valoraciones.

create table if not exists public.secretaria_usuarios (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid null,
  nombre text not null,
  email text,
  rol text not null default 'secretaria' check (rol in ('secretaria','supervisora','admin')),
  activo boolean not null default true,
  permisos jsonb not null default '{"crear":true,"atender":true,"transferir_it":false,"reportes":false,"auditoria":false}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.secretaria_tickets (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  usuario_tipo text not null default 'Estudiante' check (usuario_tipo in ('Estudiante','Externo')),
  estudiante_id uuid null,
  cedula text,
  nombre text not null,
  correo text,
  whatsapp text,
  canal text,
  asunto text not null,
  categoria text,
  descripcion text,
  estado text not null default 'Abierto' check (estado in ('Abierto','En Proceso','Resuelto','Cancelado','Transferido a IT')),
  secretaria_id uuid null references public.secretaria_usuarios(id) on delete set null,
  secretaria_nombre text,
  supervisora_id uuid null references public.secretaria_usuarios(id) on delete set null,
  transferido_it boolean not null default false,
  it_ticket_id uuid null,
  rating_token text,
  valoracion_calificacion int null check (valoracion_calificacion is null or valoracion_calificacion between 1 and 5),
  valoracion_comentario text,
  valoracion_fecha timestamptz,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.secretaria_historial (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.secretaria_tickets(id) on delete cascade,
  accion text not null,
  estado_anterior text,
  estado_nuevo text,
  secretaria_origen text,
  secretaria_destino text,
  comentario text,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.secretaria_auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid null,
  usuario_nombre text,
  accion text not null,
  modulo text not null,
  registro_id uuid null,
  datos_antes jsonb,
  datos_despues jsonb,
  ip text,
  created_at timestamptz not null default now()
);

create index if not exists idx_secretaria_tickets_estado on public.secretaria_tickets(estado);
create index if not exists idx_secretaria_tickets_secretaria on public.secretaria_tickets(secretaria_id);
create index if not exists idx_secretaria_tickets_estudiante on public.secretaria_tickets(estudiante_id);
create index if not exists idx_secretaria_auditoria_modulo on public.secretaria_auditoria(modulo);

alter table public.secretaria_usuarios enable row level security;
alter table public.secretaria_tickets enable row level security;
alter table public.secretaria_historial enable row level security;
alter table public.secretaria_auditoria enable row level security;

drop policy if exists secretaria_usuarios_auth_all on public.secretaria_usuarios;
create policy secretaria_usuarios_auth_all on public.secretaria_usuarios for all to authenticated using (true) with check (true);

drop policy if exists secretaria_tickets_auth_all on public.secretaria_tickets;
create policy secretaria_tickets_auth_all on public.secretaria_tickets for all to authenticated using (true) with check (true);

drop policy if exists secretaria_historial_auth_all on public.secretaria_historial;
create policy secretaria_historial_auth_all on public.secretaria_historial for all to authenticated using (true) with check (true);

drop policy if exists secretaria_auditoria_auth_all on public.secretaria_auditoria;
create policy secretaria_auditoria_auth_all on public.secretaria_auditoria for all to authenticated using (true) with check (true);

-- Permite valoración pública por token desde el enlace sin iniciar sesión.
drop policy if exists secretaria_tickets_public_rating_select on public.secretaria_tickets;
create policy secretaria_tickets_public_rating_select on public.secretaria_tickets for select to anon using (rating_token is not null);

drop policy if exists secretaria_tickets_public_rating_update on public.secretaria_tickets;
create policy secretaria_tickets_public_rating_update on public.secretaria_tickets for update to anon using (rating_token is not null) with check (true);
