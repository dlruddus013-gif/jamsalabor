-- ─────────────────────────────────────────────────────────
-- 20260430000003_rls_policies.sql
-- Row Level Security: 인증된 사용자만 자신의 통화에 접근
--
-- 주의: service_role 은 RLS 우회됨 (서버 워커/관리자 작업용)
-- ─────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────
-- 모든 테이블에 RLS 활성화
-- ─────────────────────────────────────────────────────────
alter table public.recordings           enable row level security;
alter table public.transcript_segments  enable row level security;
alter table public.recording_summaries  enable row level security;
alter table public.stt_jobs             enable row level security;
alter table public.audit_logs           enable row level security;


-- ─────────────────────────────────────────────────────────
-- recordings
-- 정책: 인증된 사용자는 자신이 소유자(owner_id)인 통화만 select/update.
--      insert 시 owner_id 는 본인이어야 함.
-- 향후 admin role 분리 시 별도 정책 추가.
-- ─────────────────────────────────────────────────────────

drop policy if exists "recordings: owner select" on public.recordings;
create policy "recordings: owner select"
  on public.recordings for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "recordings: owner insert" on public.recordings;
create policy "recordings: owner insert"
  on public.recordings for insert
  to authenticated
  with check (owner_id = auth.uid());

drop policy if exists "recordings: owner update" on public.recordings;
create policy "recordings: owner update"
  on public.recordings for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "recordings: owner delete" on public.recordings;
create policy "recordings: owner delete"
  on public.recordings for delete
  to authenticated
  using (owner_id = auth.uid());


-- ─────────────────────────────────────────────────────────
-- transcript_segments
-- 정책: 부모 recording 의 owner 만 select.
--      insert/update/delete 는 service_role 만 (워커가 STT 결과 기록).
-- ─────────────────────────────────────────────────────────

drop policy if exists "transcript_segments: parent owner select" on public.transcript_segments;
create policy "transcript_segments: parent owner select"
  on public.transcript_segments for select
  to authenticated
  using (
    exists (
      select 1
      from public.recordings r
      where r.id = transcript_segments.recording_id
        and r.owner_id = auth.uid()
    )
  );

-- 일반 사용자는 transcript 직접 변경 불가 — service_role 만 (RLS 우회)


-- ─────────────────────────────────────────────────────────
-- recording_summaries
-- 정책: 부모 recording 의 owner 만 select.
--      재생성 트리거 권한도 owner 본인이 가질 수 있음 (insert 허용).
-- ─────────────────────────────────────────────────────────

drop policy if exists "recording_summaries: parent owner select" on public.recording_summaries;
create policy "recording_summaries: parent owner select"
  on public.recording_summaries for select
  to authenticated
  using (
    exists (
      select 1 from public.recordings r
      where r.id = recording_summaries.recording_id
        and r.owner_id = auth.uid()
    )
  );

drop policy if exists "recording_summaries: parent owner insert" on public.recording_summaries;
create policy "recording_summaries: parent owner insert"
  on public.recording_summaries for insert
  to authenticated
  with check (
    exists (
      select 1 from public.recordings r
      where r.id = recording_summaries.recording_id
        and r.owner_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────
-- stt_jobs
-- 정책: owner 는 자신의 통화 잡만 조회 가능.
--      삽입/갱신은 service_role 전용 (워커).
-- ─────────────────────────────────────────────────────────

drop policy if exists "stt_jobs: parent owner select" on public.stt_jobs;
create policy "stt_jobs: parent owner select"
  on public.stt_jobs for select
  to authenticated
  using (
    exists (
      select 1 from public.recordings r
      where r.id = stt_jobs.recording_id
        and r.owner_id = auth.uid()
    )
  );


-- ─────────────────────────────────────────────────────────
-- audit_logs
-- 정책: 일반 사용자는 자신이 발생시킨 로그만 select.
--      쓰기는 service_role 전용 (서버에서 강제 기록).
-- ─────────────────────────────────────────────────────────

drop policy if exists "audit_logs: own select" on public.audit_logs;
create policy "audit_logs: own select"
  on public.audit_logs for select
  to authenticated
  using (user_id = auth.uid());
