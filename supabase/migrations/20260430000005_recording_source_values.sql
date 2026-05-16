-- ─────────────────────────────────────────────────────────
-- 20260430000005_recording_source_values.sql
-- recordings.source CHECK 제약 갱신:
--   기존: 'phone' | 'upload' | 'mobile_recorder'
--   신규: 'phone' | 'upload' | 'mobile_recording' | 'web_recording'
--
-- 브라우저 직접 녹음 기능을 추가하면서 모바일/데스크탑을
-- 구분해 저장할 수 있도록 합니다.
-- ─────────────────────────────────────────────────────────

-- 기존 CHECK 제약 제거
alter table public.recordings
  drop constraint if exists recordings_source_check;

-- 신규 CHECK 제약 추가
alter table public.recordings
  add constraint recordings_source_check
  check (source is null or source in (
    'phone',
    'upload',
    'mobile_recording',
    'web_recording'
  ));

comment on column public.recordings.source is
  '녹음 출처. phone=전화 자동녹음, upload=파일 업로드, mobile_recording=모바일 브라우저, web_recording=데스크탑 브라우저';
