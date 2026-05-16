-- 20260430000010_terabyte_storage.sql
-- Large audio archive support.
--
-- Audio bytes stay in Supabase Storage/object storage. Postgres keeps metadata,
-- quota accounting, upload batches, and archive lifecycle state so the system
-- can safely manage 1 TB+ of recordings without storing blobs in database rows.

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- Raise the per-object ceiling for the private recordings bucket. The actual
-- project quota still depends on the Supabase plan, but the schema is prepared
-- for a 1 TB+ archive and larger recordings.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,
  1073741824,
  array[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/m4a',
    'audio/x-m4a',
    'audio/mp4',
    'audio/aac',
    'audio/ogg',
    'audio/webm',
    'audio/amr',
    'audio/3gpp',
    'video/3gpp'
  ]
)
on conflict (id) do update
  set file_size_limit = greatest(coalesce(storage.buckets.file_size_limit, 0), excluded.file_size_limit),
      allowed_mime_types = excluded.allowed_mime_types,
      public = false;

alter table public.recordings
  add column if not exists storage_bucket text not null default 'recordings',
  add column if not exists storage_tier text not null default 'hot',
  add column if not exists archive_status text not null default 'active',
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_from_storage_at timestamptz,
  add column if not exists retention_until timestamptz,
  add column if not exists upload_session_id uuid,
  add column if not exists object_version integer not null default 1;

alter table public.recordings
  drop constraint if exists recordings_storage_tier_check;
alter table public.recordings
  add constraint recordings_storage_tier_check
  check (storage_tier in ('hot', 'warm', 'cold', 'archive'));

alter table public.recordings
  drop constraint if exists recordings_archive_status_check;
alter table public.recordings
  add constraint recordings_archive_status_check
  check (archive_status in ('active', 'archiving', 'archived', 'restore_requested', 'deleted'));

comment on column public.recordings.storage_bucket is 'Supabase Storage bucket containing the audio object.';
comment on column public.recordings.storage_tier is 'Logical retention tier for 1 TB+ archives: hot, warm, cold, archive.';
comment on column public.recordings.archive_status is 'Object lifecycle status independent of STT/summary processing status.';

create table if not exists public.storage_quotas (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  quota_bytes bigint not null default 1099511627776 check (quota_bytes > 0),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  file_count integer not null default 0 check (file_count >= 0),
  warning_threshold numeric(4, 3) not null default 0.900 check (warning_threshold > 0 and warning_threshold <= 1),
  hard_limit boolean not null default true,
  last_recalculated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.storage_quotas is 'Per-user storage quota and current usage. Default quota is 1 TiB.';

create table if not exists public.upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'phone_backup',
  device_id text,
  status text not null default 'open',
  total_files integer not null default 0 check (total_files >= 0),
  uploaded_files integer not null default 0 check (uploaded_files >= 0),
  failed_files integer not null default 0 check (failed_files >= 0),
  total_bytes bigint not null default 0 check (total_bytes >= 0),
  uploaded_bytes bigint not null default 0 check (uploaded_bytes >= 0),
  cursor_key text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.upload_sessions
  drop constraint if exists upload_sessions_status_check;
alter table public.upload_sessions
  add constraint upload_sessions_status_check
  check (status in ('open', 'running', 'paused', 'completed', 'failed', 'cancelled'));

comment on table public.upload_sessions is 'Batch/resumable upload state for folder or mobile backup sessions.';

create index if not exists recordings_owner_storage_idx
  on public.recordings (owner_id, archive_status, storage_tier, recorded_at desc);
create index if not exists recordings_upload_session_idx
  on public.recordings (upload_session_id) where upload_session_id is not null;
create index if not exists upload_sessions_owner_status_idx
  on public.upload_sessions (owner_id, status, created_at desc);
create index if not exists storage_quotas_usage_idx
  on public.storage_quotas (used_bytes desc);

alter table public.upload_sessions enable row level security;
alter table public.storage_quotas enable row level security;

drop policy if exists "upload_sessions: owner select" on public.upload_sessions;
create policy "upload_sessions: owner select"
  on public.upload_sessions for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "upload_sessions: owner insert" on public.upload_sessions;
create policy "upload_sessions: owner insert"
  on public.upload_sessions for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "upload_sessions: owner update" on public.upload_sessions;
create policy "upload_sessions: owner update"
  on public.upload_sessions for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "storage_quotas: owner select" on public.storage_quotas;
create policy "storage_quotas: owner select"
  on public.storage_quotas for select
  to authenticated
  using (owner_id = auth.uid());

create or replace function public.recalculate_storage_quota(p_owner_id uuid)
returns public.storage_quotas
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.storage_quotas;
begin
  if p_owner_id is null then
    raise exception 'owner_id is required';
  end if;

  insert into public.storage_quotas (owner_id)
  values (p_owner_id)
  on conflict (owner_id) do nothing;

  update public.storage_quotas q
  set
    used_bytes = coalesce((
      select sum(coalesce(r.audio_size_bytes, 0))
      from public.recordings r
      where r.owner_id = p_owner_id
        and r.audio_path is not null
        and r.deleted_from_storage_at is null
        and r.archive_status <> 'deleted'
    ), 0),
    file_count = coalesce((
      select count(*)::integer
      from public.recordings r
      where r.owner_id = p_owner_id
        and r.audio_path is not null
        and r.deleted_from_storage_at is null
        and r.archive_status <> 'deleted'
    ), 0),
    last_recalculated_at = now(),
    updated_at = now()
  where q.owner_id = p_owner_id
  returning * into v_row;

  return v_row;
end;
$$;

grant execute on function public.recalculate_storage_quota(uuid) to authenticated;

create or replace function public.can_store_recording(p_owner_id uuid, p_bytes bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quota public.storage_quotas;
begin
  if p_owner_id is null or p_bytes is null or p_bytes < 0 then
    return false;
  end if;

  v_quota := public.recalculate_storage_quota(p_owner_id);
  if not v_quota.hard_limit then
    return true;
  end if;

  return v_quota.used_bytes + p_bytes <= v_quota.quota_bytes;
end;
$$;

grant execute on function public.can_store_recording(uuid, bigint) to authenticated;

create or replace function public.refresh_storage_quota_from_recording()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT' or tg_op = 'UPDATE') and new.owner_id is not null then
    perform public.recalculate_storage_quota(new.owner_id);
  end if;

  if tg_op = 'UPDATE' and old.owner_id is not null and old.owner_id is distinct from new.owner_id then
    perform public.recalculate_storage_quota(old.owner_id);
  end if;

  if tg_op = 'DELETE' and old.owner_id is not null then
    perform public.recalculate_storage_quota(old.owner_id);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists recordings_refresh_storage_quota_write on public.recordings;
create trigger recordings_refresh_storage_quota_write
  after insert or update of owner_id, audio_path, audio_size_bytes, archive_status, deleted_from_storage_at
  on public.recordings
  for each row execute function public.refresh_storage_quota_from_recording();

drop trigger if exists recordings_refresh_storage_quota_delete on public.recordings;
create trigger recordings_refresh_storage_quota_delete
  after delete on public.recordings
  for each row execute function public.refresh_storage_quota_from_recording();

create or replace view public.storage_usage_summary
with (security_invoker = true)
as
select
  q.owner_id,
  q.quota_bytes,
  q.used_bytes,
  greatest(q.quota_bytes - q.used_bytes, 0) as remaining_bytes,
  q.file_count,
  round((q.used_bytes::numeric / nullif(q.quota_bytes, 0)) * 100, 2) as used_percent,
  q.used_bytes >= (q.quota_bytes * q.warning_threshold)::bigint as over_warning_threshold,
  q.used_bytes >= q.quota_bytes as over_quota,
  q.last_recalculated_at
from public.storage_quotas q;

comment on view public.storage_usage_summary is 'Owner-visible storage usage summary for the 1 TB+ audio archive.';
