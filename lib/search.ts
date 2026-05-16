// ─────────────────────────────────────────────────────────
// 통화 검색·필터 유틸 (클라이언트·서버 공유)
//
// recordings + transcripts + summaries 를 평탄화한 SearchableRecording
// 형태로 받아 검색·필터·정렬·하이라이트 컨텍스트 추출까지 처리합니다.
// ─────────────────────────────────────────────────────────

import type { Recording, TranscriptSegment } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// 위험도
//
// 스키마에는 명시 컬럼이 없으므로, 다음 신호의 가중합으로 산출:
//   +2  escalated=true (상담원 핸드오프)
//   +2  sentiment='neg'
//   +1  환불/취소 카테고리
//   +1  '환불'/'취소'/'불만' 태그
//   +0  resolved=true 면 max 1점 차감 (이미 해결됨)
//
// 4 이상 high, 2~3 medium, 1 low, 0 none.
//
// 추후 워커가 risk_level 컬럼을 만들면 이 함수를 그 컬럼 그대로 반환하도록 교체.
// ─────────────────────────────────────────────────────────

export type RiskLevel = "high" | "medium" | "low" | "none";

const RISK_TAGS = ["환불", "취소", "불만", "민원", "클레임"];
const RISK_CATEGORIES = ["환불", "취소"];

export function calcRisk(rec: Recording): RiskLevel {
  let score = 0;
  if (rec.escalated) score += 2;
  if (rec.sentiment === "neg") score += 2;
  if (rec.category && RISK_CATEGORIES.some((c) => rec.category!.includes(c))) {
    score += 1;
  }
  if (rec.tags.some((t) => RISK_TAGS.includes(t))) score += 1;
  if (rec.resolved) score = Math.max(0, score - 1);

  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  if (score >= 1) return "low";
  return "none";
}

// 정렬용 가중치
const RISK_ORDER: Record<RiskLevel, number> = {
  high: 3,
  medium: 2,
  low: 1,
  none: 0,
};

// ─────────────────────────────────────────────────────────
// 검색 가능한 통화 — 평탄화
//
// 페이지 로딩 시 한 번 만들어 둔 다음 검색·필터를 메모리에서 처리.
// (mock 모드: 모든 데이터가 메모리에 있음 / Supabase 모드: 페이지가 RPC
//  나 Edge function 으로 옮겨가도 같은 인터페이스 유지)
// ─────────────────────────────────────────────────────────

export interface SearchableRecording {
  recording: Recording;
  /** 전사 전체 텍스트 (검색용으로 미리 합쳐둠) */
  transcriptFlat: string;
  /** 검색 매칭 시 컨텍스트 추출 원본 — 시간 정보가 필요하므로 보존 */
  segments: TranscriptSegment[];
  /** 요약 텍스트 (bullets + actions + topic) */
  summaryFlat: string;
  /** 통화 제목 — customer_name + excerpt 폴백 */
  title: string;
  risk: RiskLevel;
}

export function makeSearchable(
  recording: Recording,
  segments: TranscriptSegment[]
): SearchableRecording {
  const transcriptFlat = segments.map((s) => s.text).join("\n");
  const summaryParts: string[] = [
    ...recording.summary,
    ...recording.actions.map((a) => a.text),
    ...recording.tags,
  ];
  const summaryFlat = summaryParts.join("\n");
  const title =
    recording.customer_name ?? recording.excerpt ?? `통화 ${recording.id}`;

  return {
    recording,
    transcriptFlat,
    segments,
    summaryFlat,
    title,
    risk: calcRisk(recording),
  };
}

// ─────────────────────────────────────────────────────────
// 검색·필터 옵션
// ─────────────────────────────────────────────────────────

export interface SearchFilters {
  /** 검색어 — 공백 기준 다중 토큰. 모든 토큰을 포함해야 매치 (AND) */
  query: string;
  /** 카테고리(상담 유형) 필터 — null=전체 */
  category: string | null;
  /** 위험도 필터 — null=전체. 'high' 선택 시 high 만, 'medium' 은 medium+high */
  risk: RiskLevel | null;
  /** 날짜 범위 (YYYY-MM-DD, inclusive). null 이면 미설정 */
  dateFrom: string | null;
  dateTo: string | null;
}

export const EMPTY_FILTERS: SearchFilters = {
  query: "",
  category: null,
  risk: null,
  dateFrom: null,
  dateTo: null,
};

// ─────────────────────────────────────────────────────────
// 매칭 결과
// ─────────────────────────────────────────────────────────

export type MatchSource = "title" | "summary" | "transcript";

export interface SnippetMatch {
  source: MatchSource;
  /** 키워드 주변 ±N자 컨텍스트 */
  context: string;
  /** transcript 인 경우 발화 시작 시간 (없으면 null) */
  startSec: number | null;
  /** transcript 인 경우 화자 */
  speaker: "agent" | "customer" | null;
}

export interface SearchHit {
  item: SearchableRecording;
  score: number;
  matches: SnippetMatch[];
}

// ─────────────────────────────────────────────────────────
// 검색 본체
// ─────────────────────────────────────────────────────────

const CONTEXT_PADDING = 30;
const MAX_SNIPPETS_PER_HIT = 3;

export function searchRecordings(
  items: SearchableRecording[],
  filters: SearchFilters
): SearchHit[] {
  const tokens = tokenize(filters.query);
  const fromTs = filters.dateFrom ? Date.parse(filters.dateFrom) : null;
  // dateTo 는 그 날짜의 끝까지 포함시키기 위해 +1일 (exclusive)
  const toTs = filters.dateTo
    ? Date.parse(filters.dateTo) + 24 * 60 * 60 * 1000
    : null;

  const minRiskScore = filters.risk ? RISK_ORDER[filters.risk] : 0;

  const hits: SearchHit[] = [];

  for (const item of items) {
    // ─── 메타 필터 (검색어와 무관) ────────────────────
    if (filters.category && item.recording.category !== filters.category) continue;

    if (filters.risk && RISK_ORDER[item.risk] < minRiskScore) continue;

    const recordedTs = Date.parse(item.recording.recorded_at);
    if (fromTs !== null && recordedTs < fromTs) continue;
    if (toTs !== null && recordedTs >= toTs) continue;

    // ─── 검색어 매칭 ──────────────────────────────────
    if (tokens.length === 0) {
      // 검색어 없으면 메타 필터만 통과한 것 모두 결과로
      hits.push({ item, score: 0, matches: [] });
      continue;
    }

    const lowerTitle = item.title.toLowerCase();
    const lowerSummary = item.summaryFlat.toLowerCase();
    const lowerTranscript = item.transcriptFlat.toLowerCase();

    // 모든 토큰이 어딘가에 매치돼야 함 (AND)
    const allMatch = tokens.every(
      (t) =>
        lowerTitle.includes(t) ||
        lowerSummary.includes(t) ||
        lowerTranscript.includes(t)
    );
    if (!allMatch) continue;

    // 스니펫 추출 + 가중치 점수
    const matches: SnippetMatch[] = [];
    let score = 0;

    // title — 가장 강한 매치
    for (const tok of tokens) {
      const idx = lowerTitle.indexOf(tok);
      if (idx >= 0) {
        score += 5;
        matches.push({
          source: "title",
          context: extractContext(item.title, idx, tok.length),
          startSec: null,
          speaker: null,
        });
        break; // title 은 한 번만 표시
      }
    }

    // summary
    for (const tok of tokens) {
      const idx = lowerSummary.indexOf(tok);
      if (idx >= 0) {
        score += 3;
        matches.push({
          source: "summary",
          context: extractContext(item.summaryFlat, idx, tok.length),
          startSec: null,
          speaker: null,
        });
        if (matches.length >= MAX_SNIPPETS_PER_HIT) break;
      }
    }

    // transcript — 세그먼트 단위로 검색해 시간 정보 보존
    for (const seg of item.segments) {
      if (matches.length >= MAX_SNIPPETS_PER_HIT) break;
      const lowerText = seg.text.toLowerCase();
      const tok = tokens.find((t) => lowerText.includes(t));
      if (!tok) continue;
      const idx = lowerText.indexOf(tok);
      score += 1;
      matches.push({
        source: "transcript",
        context: extractContext(seg.text, idx, tok.length),
        startSec: seg.start_sec,
        speaker: seg.speaker as "agent" | "customer",
      });
    }

    hits.push({ item, score, matches });
  }

  // 정렬: 점수 desc → 최근 통화 desc
  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (
      Date.parse(b.item.recording.recorded_at) -
      Date.parse(a.item.recording.recorded_at)
    );
  });

  return hits;
}

// ─────────────────────────────────────────────────────────
// 보조
// ─────────────────────────────────────────────────────────

function tokenize(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/**
 * idx 위치를 중심으로 ±CONTEXT_PADDING 범위를 잘라 컨텍스트 반환.
 * 양 끝이 잘렸으면 ellipsis(…) 부착.
 */
function extractContext(text: string, idx: number, matchLen: number): string {
  const start = Math.max(0, idx - CONTEXT_PADDING);
  const end = Math.min(text.length, idx + matchLen + CONTEXT_PADDING);
  let snippet = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) snippet = "…" + snippet;
  if (end < text.length) snippet = snippet + "…";
  return snippet;
}

// ─────────────────────────────────────────────────────────
// 카테고리 목록 — 필터 드롭다운용
// ─────────────────────────────────────────────────────────

export function listCategories(items: SearchableRecording[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    if (it.recording.category) set.add(it.recording.category);
  }
  return Array.from(set).sort();
}

// ─────────────────────────────────────────────────────────
// 라벨
// ─────────────────────────────────────────────────────────

export const RISK_LABEL: Record<RiskLevel, string> = {
  high: "긴급",
  medium: "주의",
  low: "관찰",
  none: "정상",
};

export const RISK_CLASS: Record<RiskLevel, string> = {
  high: "bg-accent/15 text-accent",
  medium: "bg-gold/15 text-gold",
  low: "bg-sky/15 text-sky",
  none: "bg-line-soft text-ink-mute",
};
