-- Radio Periquín Cloud v0.6.0
-- Ejecutar después de 001_radio_periquin.sql en Supabase > SQL Editor.

begin;

create table if not exists public.rp_scheduled_publications (
  id uuid primary key,
  name text not null default '',
  status text not null default 'scheduled' check (status in ('scheduled','processing','published','cancelled','failed')),
  publish_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  published_version bigint,
  error text not null default '',
  base_content_version bigint not null default 0,
  config jsonb not null
);

create index if not exists rp_scheduled_publications_due_idx
  on public.rp_scheduled_publications (status, publish_at asc);
create index if not exists rp_scheduled_publications_created_idx
  on public.rp_scheduled_publications (created_at desc);

alter table public.rp_scheduled_publications enable row level security;
revoke all on table public.rp_scheduled_publications from anon, authenticated;
grant all on table public.rp_scheduled_publications to service_role;

commit;
