-- Radio Periquín Cloud v0.4.0
-- Ejecutar una sola vez en Supabase > SQL Editor.

begin;

create table if not exists public.rp_state (
  id smallint primary key check (id = 1),
  content_version bigint not null default 1,
  updated_at timestamptz not null default now(),
  config jsonb not null
);

create table if not exists public.rp_history (
  content_version bigint primary key,
  updated_at timestamptz not null,
  config jsonb not null
);

create table if not exists public.rp_media (
  path text primary key,
  filename text not null,
  url text not null,
  bytes bigint not null default 0 check (bytes >= 0),
  content_type text not null,
  uploaded_at timestamptz not null default now()
);

create index if not exists rp_history_updated_idx on public.rp_history (updated_at desc);
create index if not exists rp_media_uploaded_idx on public.rp_media (uploaded_at desc);

alter table public.rp_state enable row level security;
alter table public.rp_history enable row level security;
alter table public.rp_media enable row level security;

-- El backend de Render usa una Secret key / service_role. La app pública nunca toca Supabase directamente.
revoke all on table public.rp_state from anon, authenticated;
revoke all on table public.rp_history from anon, authenticated;
revoke all on table public.rp_media from anon, authenticated;
grant all on table public.rp_state to service_role;
grant all on table public.rp_history to service_role;
grant all on table public.rp_media to service_role;

create or replace function public.rp_publish_config(p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.rp_state%rowtype;
  next_version bigint;
  next_updated timestamptz := now();
  next_config jsonb;
begin
  select * into current_row
  from public.rp_state
  where id = 1
  for update;

  if not found then
    raise exception 'Radio Periquín Cloud no tiene rp_state inicializado';
  end if;

  insert into public.rp_history (content_version, updated_at, config)
  values (current_row.content_version, current_row.updated_at, current_row.config)
  on conflict (content_version) do nothing;

  next_version := current_row.content_version + 1;
  next_config := jsonb_set(
    jsonb_set(p_config, '{contentVersion}', to_jsonb(next_version), true),
    '{updatedAt}', to_jsonb(next_updated), true
  );

  update public.rp_state
  set content_version = next_version,
      updated_at = next_updated,
      config = next_config
  where id = 1;

  return next_config;
end;
$$;

revoke all on function public.rp_publish_config(jsonb) from public, anon, authenticated;
grant execute on function public.rp_publish_config(jsonb) to service_role;

-- Bucket público: las imágenes publicadas son assets de la app infantil.
-- Solo el backend con Secret key puede subir/modificar archivos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'radio-periquin-media',
  'radio-periquin-media',
  true,
  6291456,
  array['image/png','image/jpeg','image/webp','image/gif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

commit;
