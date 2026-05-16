-- ─────────────────────────────────────────────────────────
-- 20260430000006_recording_title_and_risk.sql
--
-- recordings 테이블에 두 컬럼을 정식 도입합니다.
--   - title:       사용자 지정 / STT 워커가 자동 생성하는 제목
--   - risk_level:  위험도 (none | low | medium | high | critical)
--
-- 검색·필터 성능을 위해 trigram 인덱스와 GIN 인덱스를 함께 추가합니다.
-- ─────────────────────────────────────────────────────────

-- 트라이그램 검색용 (한국어/영문 부분일치 빠르게)
create extension if not exists pg_trgm;

-- ─── 1) 컬럼 추가 ─────────────────────────────────────────
alter table public.recordings
  add column if not exists title       text,
  add column if not exists risk_level  text;

-- ─── 2) CHECK 제약 (드롭 후 재생성 — idempotent) ──────────
alter table public.recordings
  drop constraint if exists recordings_risk_level_check;

alter table public.recordings
  add constraint recordings_risk_level_check
  check (risk_level is null or risk_level in (
    'none', 'low', 'medium', 'high', 'critical'
  ));

comment on column public.recordings.title is
  '통화 제목. 사용자가 업로드 시 입력하거나 STT 워커가 자동 생성';
comment on column public.recordings.risk_level is
  '위험도. none/low/medium/high/critical. NULL=미평가';

-- ─── 3) 인덱스 ───────────────────────────────────────────
-- 위험도 필터
create index if not exists recordings_risk_level_idx
  on public.recordings (risk_level)
  where risk_level is not null;

-- 제목 부분일치 검색 (trigram)
create index if not exists recordings_title_trgm_idx
  on public.recordings using gin (title gin_trgm_ops);

-- 전사 텍스트 부분일치 검색 (trigram)
create index if not exists transcript_segments_text_trgm_idx
  on public.transcript_segments using gin (text gin_trgm_ops);

-- 요약 bullet 들은 text[] — array_to_string 으로 검색하므로 별도 인덱스 추가
-- 함수형 인덱스로 만들면 비효율이라 trigram 만으로도 충분.
-- 대신 검색 시 array_to_string 결과에 ILIKE/trgm 매칭.

-- 메타 필드 검색용 보강 (recordings_text_search_idx 는 002 에서 이미 생성됨)
-- title 이 추가되었으므로 해당 인덱스를 다시 만들어 title 까지 포함:
drop index if exists public.recordings_text_search_idx;
create index recordings_text_search_idx
  on public.recordings using gin (
    to_tsvector(
      'simple',
      coalesce(title, '') || ' ' ||
      coalesce(customer_name, '') || ' ' ||
      coalesce(customer_phone, '') || ' ' ||
      coalesce(excerpt, '')
    )
  );


-- ─────────────────────────────────────────────────────────
-- 4) RPC: 통합 검색 함수
--
-- 클라이언트가 다음을 한 번의 호출로 수행:
--   - title / customer_name / excerpt 매칭 (recordings)
--   - summary bullet 매칭 (recording_summaries)
--   - 전사 매칭 (transcript_segments)
-- 위험도/카테고리/날짜 범위 필터를 함께 적용합니다.
--
-- 결과: recording id 리스트 + 매칭 출처 + 스니펫.
-- 클라이언트는 이 id 들로 다시 detail 을 가져오거나 그대로 활용.
-- ─────────────────────────────────────────────────────────

drop function if exists public.search_recordings(text, text, text, timestamptz, timestamptz, int);

create or replace function public.search_recordings(
  query        text default null,
  p_category   text default null,
  p_risk       text default null,
  p_date_from  timestamptz default null,
  p_date_to    timestamptz default null,
  result_limit int default 50
)
returns table (
  id            uuid,
  recorded_at   timestamptz,
  title         text,
  customer_name text,
  customer_phone text,
  category      text,
  status        text,
  sentiment     text,
  risk_level    text,
  resolved      boolean,
  escalated     boolean,
  duration_sec  int,
  excerpt       text,
  tags          text[],
  matched_in    text,    -- 'title' | 'meta' | 'summary' | 'transcript'
  snippet       text     -- 매칭 문장 미리보기
)
language plpgsql
stable
security invoker
as $$
declare
  q text := nullif(trim(query), '');
  pat text;
begin
  pat := case when q is null then null else '%' || q || '%' end;

  return query
  with base as (
    -- 1) 권한이 있는 recording 만 (RLS 가 자동 적용 — security invoker)
    select r.*
    from public.recordings r
    where (p_category is null or r.category = p_category)
      and (p_risk     is null or r.risk_level = p_risk)
      and (p_date_from is null or r.recorded_at >= p_date_from)
      and (p_date_to   is null or r.recorded_at <= p_date_to)
  ),
  -- 2) 매칭 출처별로 candidate 를 모은다
  hits as (
    -- 메타 매칭 (title / 이름 / 발췌)
    select b.id,
           case
             when q is null                                  then 'meta'
             when b.title         ilike pat                  then 'title'
             when b.customer_name ilike pat                  then 'meta'
             when b.excerpt       ilike pat                  then 'meta'
             else 'meta'
           end as matched_in,
           coalesce(
             nullif(b.excerpt, ''),
             nullif(b.title, ''),
             ''
           ) as snippet
    from base b
    where q is null
       or b.title         ilike pat
       or b.customer_name ilike pat
       or b.excerpt       ilike pat

    union all

    -- 요약 매칭
    select b.id,
           'summary'::text as matched_in,
           array_to_string(s.summary, ' / ') as snippet
    from base b
    join public.recording_summaries s
      on s.recording_id = b.id
     and s.is_current
    where q is not null
      and array_to_string(s.summary, ' ') ilike pat

    union all

    -- 전사 매칭 — 매칭된 첫 segment 텍스트를 스니펫으로
    select b.id,
           'transcript'::text as matched_in,
           ts.text as snippet
    from base b
    join public.transcript_segments ts on ts.recording_id = b.id
    where q is not null
      and ts.text ilike pat
  ),
  ranked as (
    -- 한 recording 당 가장 우선순위 높은 매칭 1개만
    select h.*,
           row_number() over (
             partition by h.id
             order by case h.matched_in
                        when 'title'      then 1
                        when 'meta'       then 2
                        when 'summary'    then 3
                        when 'transcript' then 4
                        else 5
                      end
           ) as rn
    from hits h
  )
  select b.id,
         b.recorded_at,
         b.title,
         b.customer_name,
         b.customer_phone,
         b.category,
         b.status,
         b.sentiment,
         b.risk_level,
         b.resolved,
         b.escalated,
         b.duration_sec,
         b.excerpt,
         b.tags,
         r.matched_in,
         r.snippet
  from base b
  join ranked r on r.id = b.id and r.rn = 1
  order by b.recorded_at desc
  limit result_limit;
end;
$$;

comment on function public.search_recordings(text, text, text, timestamptz, timestamptz, int) is
  '통화 통합 검색: title/메타/summary/transcript 매칭 + 카테고리·위험도·날짜 필터';
