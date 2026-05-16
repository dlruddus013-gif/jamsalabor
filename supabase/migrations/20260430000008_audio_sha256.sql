-- ─────────────────────────────────────────────────────────
-- 20260430000008_audio_sha256.sql
--
-- recordings 테이블에 오디오 파일의 SHA-256 해시 컬럼을 추가합니다.
-- batch import 워커가 이 해시로 중복 업로드를 차단합니다.
--
-- 주의: 이미 업로드된 row 들은 NULL 로 남으므로, 사후 보정이 필요하면
-- 별도 backfill 스크립트로 admin 클라이언트가 Storage 에서 다시 읽어
-- 해시를 계산해 채우면 됩니다.
-- ─────────────────────────────────────────────────────────

alter table public.recordings
  add column if not exists audio_sha256 text;

comment on column public.recordings.audio_sha256 is
  '오디오 파일의 SHA-256 해시 (소문자 hex 64자). batch import 중복 방지용';

-- 동일 사용자가 같은 파일을 두 번 올리지 못하도록.
-- 다른 사용자는 별도 row 로 인정 (개인별 업로드 이력 보존).
-- audio_sha256 가 NULL 인 row 는 unique 제약 영향 받지 않음 (PostgreSQL 기본 동작).
create unique index if not exists recordings_owner_sha256_uidx
  on public.recordings (owner_id, audio_sha256)
  where audio_sha256 is not null;

-- 해시 단독 조회용 인덱스 (배치 도구가 owner 없이 조회할 때 사용)
create index if not exists recordings_sha256_idx
  on public.recordings (audio_sha256)
  where audio_sha256 is not null;
