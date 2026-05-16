-- ─────────────────────────────────────────────────────────
-- 20260430000001_initial_schema.sql
-- jamsa-vito 초기 스키마: 5개 테이블 생성
-- ─────────────────────────────────────────────────────────

-- 확장
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────
-- 1. recordings
-- ─────────────────────────────────────────────────────────
create table if not exists public.recordings (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  recorded_at     timestamptz not null,

  -- 소유자 (auth.users 와 연결)
  owner_id        uuid references auth.users(id) on delete set null,

  -- 고객 정보 (마스킹 권장)
  customer_name   text,
  customer_phone  text,

  -- 오디오
  duration_sec    integer not null default 0 check (duration_sec >= 0),
  audio_path      text,                                     -- Storage 내 경로
  audio_mime      text,
  audio_size_bytes bigint check (audio_size_bytes is null or audio_size_bytes >= 0),

  -- 처리 상태
  status          text not null default 'uploading'
                  check (status in ('uploading', 'processing', 'completed', 'failed')),

  -- 분석 결과
  sentiment       text check (sentiment in ('pos', 'neu', 'neg')),
  resolved        boolean not null default false,
  escalated       boolean not null default false,
  tags            text[] not null default '{}',
  excerpt         text,
  category        text,

  -- 메타
  source          text check (source in ('phone', 'upload', 'mobile_recorder')),
  metadata        jsonb not null default '{}'::jsonb
);

comment on table  public.recordings is '통화 녹음 마스터 테이블';
comment on column public.recordings.audio_path is 'Storage 버킷(jamsa-vito-audio) 내 객체 경로';
comment on column public.recordings.customer_phone is '저장 시 010-XXXX-**** 형태로 마스킹 권장';

-- ─────────────────────────────────────────────────────────
-- 2. transcript_segments
-- ─────────────────────────────────────────────────────────
create table if not exists public.transcript_segments (
  id              uuid primary key default gen_random_uuid(),
  recording_id    uuid not null references public.recordings(id) on delete cascade,

  start_sec       integer not null check (start_sec >= 0),
  end_sec         integer not null check (end_sec >= start_sec),

  speaker         text not null check (speaker in ('agent', 'customer')),
  text            text not null,
  confidence      numeric(4, 3) check (confidence is null or (confidence >= 0 and confidence <= 1)),

  created_at      timestamptz not null default now()
);

comment on table public.transcript_segments is 'STT 결과: 통화당 다수의 화자분리 세그먼트';

-- ─────────────────────────────────────────────────────────
-- 3. recording_summaries
-- 동일 통화에 대해 재생성 시 새 row 추가, is_current 로 활성 여부 관리
-- ─────────────────────────────────────────────────────────
create table if not exists public.recording_summaries (
  id              uuid primary key default gen_random_uuid(),
  recording_id    uuid not null references public.recordings(id) on delete cascade,

  -- 핵심 요약
  summary         text[] not null default '{}',
  action_items    jsonb  not null default '[]'::jsonb,
  key_topics      text[] not null default '{}',
  sentiment       text   check (sentiment in ('pos', 'neu', 'neg')),

  -- 모델 메타
  model           text,
  prompt_version  text,
  tokens_input    integer check (tokens_input is null or tokens_input >= 0),
  tokens_output   integer check (tokens_output is null or tokens_output >= 0),

  -- 상태
  is_current      boolean not null default true,

  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);

comment on table  public.recording_summaries is 'AI 요약 (재생성 이력 보존)';
comment on column public.recording_summaries.is_current is 'recording 당 1개만 true 가 되도록 트리거로 강제';

-- ─────────────────────────────────────────────────────────
-- 4. stt_jobs
-- ─────────────────────────────────────────────────────────
create table if not exists public.stt_jobs (
  id              uuid primary key default gen_random_uuid(),
  recording_id    uuid not null references public.recordings(id) on delete cascade,

  status          text not null default 'queued'
                  check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  engine          text not null default 'whisper-large-v3',
  language        text default 'ko',

  -- 처리 진행
  started_at      timestamptz,
  completed_at    timestamptz,
  duration_ms     integer check (duration_ms is null or duration_ms >= 0),

  -- 실패 처리
  error_code      text,
  error_message   text,
  retry_count     integer not null default 0 check (retry_count >= 0),

  -- 우선순위 (낮을수록 먼저)
  priority        integer not null default 100,

  created_at      timestamptz not null default now()
);

comment on table public.stt_jobs is 'STT 백그라운드 처리 큐/이력';

-- ─────────────────────────────────────────────────────────
-- 5. audit_logs
-- ─────────────────────────────────────────────────────────
create table if not exists public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete set null,

  action          text not null
                  check (action in ('view','download','create','update','delete','login','logout','export')),
  resource_type   text not null,                            -- 'recording' | 'transcript' | 'summary' | ...
  resource_id     uuid,

  ip_address      inet,
  user_agent      text,
  metadata        jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now()
);

comment on table public.audit_logs is '접근/변경 감사 로그 (개인정보 추적)';
