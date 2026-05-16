-- ─────────────────────────────────────────────────────────
-- 20260430000002_indexes_and_triggers.sql
-- 인덱스와 트리거(updated_at, is_current 단일성 보장)
-- ─────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────
-- 인덱스
-- ─────────────────────────────────────────────────────────

-- recordings: 정렬·필터에 자주 쓰이는 컬럼
create index if not exists recordings_recorded_at_idx on public.recordings (recorded_at desc);
create index if not exists recordings_owner_id_idx    on public.recordings (owner_id);
create index if not exists recordings_status_idx      on public.recordings (status);
create index if not exists recordings_sentiment_idx   on public.recordings (sentiment) where sentiment is not null;
create index if not exists recordings_escalated_idx   on public.recordings (escalated) where escalated = true;
create index if not exists recordings_tags_gin        on public.recordings using gin (tags);
-- 검색 (전화번호·이름·excerpt) 부분일치
create index if not exists recordings_text_search_idx on public.recordings
  using gin (to_tsvector('simple', coalesce(customer_name,'') || ' ' || coalesce(customer_phone,'') || ' ' || coalesce(excerpt,'')));

-- transcript_segments: 통화별 시간순
create index if not exists transcript_segments_recording_idx
  on public.transcript_segments (recording_id, start_sec);

-- recording_summaries: recording 당 활성 요약 빠른 조회
create index if not exists recording_summaries_recording_idx
  on public.recording_summaries (recording_id, created_at desc);

-- recording 당 is_current=true 는 1개만 존재해야 함 (partial unique index)
create unique index if not exists recording_summaries_one_current_idx
  on public.recording_summaries (recording_id) where is_current = true;

-- stt_jobs: 큐 처리 + 통화별 이력
create index if not exists stt_jobs_status_priority_idx
  on public.stt_jobs (status, priority, created_at) where status in ('queued', 'running');
create index if not exists stt_jobs_recording_idx
  on public.stt_jobs (recording_id, created_at desc);

-- audit_logs: 사용자별·리소스별 조회
create index if not exists audit_logs_user_idx     on public.audit_logs (user_id, created_at desc);
create index if not exists audit_logs_resource_idx on public.audit_logs (resource_type, resource_id, created_at desc);


-- ─────────────────────────────────────────────────────────
-- updated_at 자동 갱신 트리거
-- ─────────────────────────────────────────────────────────

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists recordings_set_updated_at on public.recordings;
create trigger recordings_set_updated_at
  before update on public.recordings
  for each row execute function public.set_updated_at();


-- ─────────────────────────────────────────────────────────
-- recording_summaries: 새 요약 생성 시 이전 is_current 자동 해제
-- ─────────────────────────────────────────────────────────

create or replace function public.recording_summaries_demote_old()
returns trigger
language plpgsql
as $$
begin
  if new.is_current then
    update public.recording_summaries
    set    is_current = false
    where  recording_id = new.recording_id
      and  id <> new.id
      and  is_current = true;
  end if;
  return new;
end;
$$;

drop trigger if exists recording_summaries_demote_old_trg on public.recording_summaries;
create trigger recording_summaries_demote_old_trg
  after insert or update of is_current on public.recording_summaries
  for each row execute function public.recording_summaries_demote_old();


-- ─────────────────────────────────────────────────────────
-- 헬퍼 함수: 휴대폰 마스킹 (서버에서 호출용)
-- ─────────────────────────────────────────────────────────

create or replace function public.mask_phone(phone text)
returns text
language sql
immutable
as $$
  select case
    when phone is null then null
    when phone ~ '^\d{3}-?\d{3,4}-?\d{4}$' then
      regexp_replace(phone, '^(\d{3})-?(\d{3,4})-?\d{4}$', '\1-\2-****')
    else phone
  end;
$$;

comment on function public.mask_phone(text) is '휴대폰 번호 끝 4자리 마스킹';
