-- ─────────────────────────────────────────────────────────
-- 20260430000007_text_raw_and_admin_access.sql
--
-- 1) transcript_segments.text_raw — 마스킹 전 원본 텍스트
--    text       : 마스킹된 텍스트 (모든 사용자에게 노출)
--    text_raw   : 원본 텍스트     (관리자 / service_role 만 접근)
--
-- 2) recording_summaries 도 동일 정책 적용
--
-- 3) audit_logs.action 에 'masked_export' / 'original_export' 명시 추가
--    → 외부 공유용 다운로드와 관리자 원본 다운로드를 별도 이벤트로 추적
-- ─────────────────────────────────────────────────────────

-- ─── 1) 컬럼 추가 ─────────────────────────────────────────
alter table public.transcript_segments
  add column if not exists text_raw text;

alter table public.recording_summaries
  add column if not exists summary_raw      text[],
  add column if not exists action_items_raw jsonb;

comment on column public.transcript_segments.text_raw is
  '마스킹 전 원본 전사. 관리자(service_role) 전용 열';
comment on column public.recording_summaries.summary_raw is
  '마스킹 전 원본 요약 bullets. 관리자 전용';
comment on column public.recording_summaries.action_items_raw is
  '마스킹 전 원본 액션 아이템. 관리자 전용';


-- ─── 2) 관리자 식별 — auth.users.raw_user_meta_data.role = 'admin' ─
--
-- 별도 admin 컬럼/테이블이 아직 없으므로 user_metadata 의 role 필드를 기준으로 판정합니다.
-- 운영에서는 별도 user_roles 테이블 + 관리 UI 도입을 권장합니다.
-- service_role 은 RLS 자체를 우회하므로 워커는 별도 처리 없이 동작합니다.

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
as $$
  select coalesce(
    (auth.jwt() -> 'user_metadata' ->> 'role') = 'admin',
    false
  );
$$;

comment on function public.is_admin() is
  '현재 호출자가 관리자(JWT user_metadata.role=admin)인지 여부';


-- ─── 3) 컬럼 단위 RLS ─────────────────────────────────────
-- transcript_segments / recording_summaries 의 *_raw 컬럼은 일반 사용자에게서 숨김.
--
-- PostgreSQL 의 컬럼 단위 권한은 RLS 가 아닌 GRANT 로 제어합니다.
-- 일반 사용자 role(authenticated)에서 raw 컬럼의 SELECT 를 회수하면
-- PostgREST(supabase-js) 의 select(*) 호출 시 자동으로 제외됩니다.

revoke select (text_raw) on public.transcript_segments from authenticated;
revoke select (summary_raw, action_items_raw) on public.recording_summaries from authenticated;

-- 관리자 전용 뷰: JWT role=admin 이면 raw 컬럼 노출
create or replace view public.transcript_segments_admin
with (security_invoker = true)
as
  select id,
         recording_id,
         start_sec,
         end_sec,
         speaker,
         text,
         text_raw,
         confidence,
         created_at
  from public.transcript_segments
  where public.is_admin();

create or replace view public.recording_summaries_admin
with (security_invoker = true)
as
  select id,
         recording_id,
         summary,
         summary_raw,
         action_items,
         action_items_raw,
         key_topics,
         sentiment,
         model,
         prompt_version,
         tokens_input,
         tokens_output,
         is_current,
         created_at,
         created_by
  from public.recording_summaries
  where public.is_admin();

comment on view public.transcript_segments_admin is
  '관리자 전용 — text_raw 포함. JWT user_metadata.role=admin 일 때만 row 반환';
comment on view public.recording_summaries_admin is
  '관리자 전용 — summary_raw / action_items_raw 포함';


-- ─── 4) audit_logs.action CHECK 보강 ──────────────────────
-- masked_export / original_export 를 명시적 이벤트로 분리.
-- 기존 'export' 도 호환을 위해 유지.

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (action in (
    'view',
    'download',
    'create',
    'update',
    'delete',
    'login',
    'logout',
    'export',
    'masked_export',
    'original_export'
  ));

comment on column public.audit_logs.action is
  'masked_export = 외부 공유용 마스킹 다운로드, original_export = 관리자 원본 다운로드';
