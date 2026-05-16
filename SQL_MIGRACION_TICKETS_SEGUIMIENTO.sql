-- MIGRACION SEGURA: edición, transferencia, tiempo de resolución e historial de tickets
-- Ejecutar en Supabase SQL Editor. No elimina datos existentes.

alter table public.tickets
  add column if not exists assigned_agent_id uuid references public.agentes(id),
  add column if not exists assigned_agent_name text,
  add column if not exists assigned_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_minutes int,
  add column if not exists last_status_change_at timestamptz;

-- Inicializa asignación para tickets existentes sin tocar su información original.
update public.tickets
   set assigned_agent_id = coalesce(assigned_agent_id, agente_id),
       assigned_agent_name = coalesce(assigned_agent_name, agente_nombre),
       assigned_at = coalesce(assigned_at, created_at),
       last_status_change_at = coalesce(last_status_change_at, updated_at, created_at)
 where assigned_agent_id is null
    or assigned_agent_name is null
    or assigned_at is null
    or last_status_change_at is null;

-- Para tickets ya resueltos sin fecha de resolución, usa updated_at como referencia conservadora.
update public.tickets
   set resolved_at = coalesce(resolved_at, updated_at, created_at),
       resolution_minutes = coalesce(resolution_minutes, greatest(0, round(extract(epoch from (coalesce(updated_at, created_at) - created_at)) / 60)::int))
 where estado = 'Resuelto'
   and (resolved_at is null or resolution_minutes is null);

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

create index if not exists idx_tickets_assigned_agent_id on public.tickets(assigned_agent_id);
create index if not exists idx_tickets_resolved_at on public.tickets(resolved_at desc);
create index if not exists idx_ticket_seguimientos_ticket_id on public.ticket_seguimientos(ticket_id, created_at);

alter table public.ticket_seguimientos enable row level security;

drop policy if exists "seguimientos_select_authenticated" on public.ticket_seguimientos;
drop policy if exists "seguimientos_insert_authenticated" on public.ticket_seguimientos;
drop policy if exists "seguimientos_update_admin" on public.ticket_seguimientos;
drop policy if exists "seguimientos_delete_admin" on public.ticket_seguimientos;

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
