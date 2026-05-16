-- 20260430000011_phone_backup_call_category.sql
-- Ensure phone backup recordings appear under the call recording category
-- immediately after backup, and backfill already uploaded phone backups.

update public.recordings
set
  category = '통화녹음',
  tags = (
    select array_agg(distinct tag)
    from unnest(coalesce(tags, '{}'::text[]) || array['통화녹음', '백업']) as tag
  )
where source = 'phone_backup'
  and coalesce(category, '') <> '통화녹음';

update public.recordings
set
  category = '통화녹음',
  tags = (
    select array_agg(distinct tag)
    from unnest(coalesce(tags, '{}'::text[]) || array['통화녹음', '백업']) as tag
  )
where category is null
  and (
    audio_path ilike '%call%'
    or audio_path ilike '%tphone%'
    or audio_path ilike '%phonecall%'
    or audio_path ilike '%통화%'
    or coalesce(metadata->>'original_path', '') ilike '%call%'
    or coalesce(metadata->>'original_path', '') ilike '%tphone%'
    or coalesce(metadata->>'original_path', '') ilike '%통화%'
  );

create index if not exists recordings_call_backup_idx
  on public.recordings (owner_id, recorded_at desc)
  where category = '통화녹음';
