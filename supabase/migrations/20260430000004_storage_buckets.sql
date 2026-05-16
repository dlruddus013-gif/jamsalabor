-- ─────────────────────────────────────────────────────────
-- 20260430000004_storage_buckets.sql
-- 오디오 파일 저장용 Storage 버킷 + 접근 정책
-- 버킷명: 'recordings' (private)
-- ─────────────────────────────────────────────────────────

-- 버킷 생성 (private)
-- 객체 경로 컨벤션: {owner_id}/{timestamp}_{sanitized_name}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,                                    -- public=false (서명 URL 로만 다운로드)
  104857600,                                -- 100 MB
  array[
    'audio/mpeg',
    'audio/mp3',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/m4a',
    'audio/x-m4a',
    'audio/mp4',
    'audio/ogg',
    'audio/webm'
  ]
)
on conflict (id) do update
  set file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;


-- ─────────────────────────────────────────────────────────
-- Storage 정책: storage.objects 에 적용
-- 경로 첫 segment 가 사용자 uid 와 일치하는 객체만 접근 가능
-- (path: {auth.uid()}/{timestamp}_{name}.mp3)
-- ─────────────────────────────────────────────────────────

-- SELECT
create policy "recordings: owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- INSERT
create policy "recordings: owner upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- UPDATE (재업로드)
create policy "recordings: owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- DELETE
create policy "recordings: owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'recordings'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- service_role 은 RLS 우회 — 워커가 임의 경로 처리 가능
