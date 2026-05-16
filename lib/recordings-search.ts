import "server-only";

import {
  createSupabaseServerClient,
  isUsingSupabaseServer,
} from "@/lib/supabase/server";
import { MOCK_RECORDINGS, getTranscriptByRecordingId } from "@/lib/mock-data";
import type { RiskLevel } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// 검색 view-model
// ─────────────────────────────────────────────────────────

export type MatchedIn = "title" | "meta" | "summary" | "transcript";

export interface SearchHit {
  id: string;
  recorded_at: string;
  title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  category: string | null;
  status: string;
  sentiment: string | null;
  risk_level: RiskLevel | null;
  resolved: boolean;
  escalated: boolean;
  duration_sec: number;
  excerpt: string | null;
  tags: string[];
  matched_in: MatchedIn;
  /** 매칭 문장 — 클라이언트에서 키워드 하이라이트 */
  snippet: string | null;
}

export interface SearchParams {
  query?: string;
  category?: string;
  risk?: RiskLevel | "any";
  dateFrom?: string;     // ISO
  dateTo?: string;       // ISO (해당 날짜의 끝까지 포함하려면 23:59:59 로 보낼 것)
  limit?: number;
}

export interface SearchResult {
  hits: SearchHit[];
  total: number;
  source: "supabase" | "mock";
}

// ─────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────

export async function searchRecordings(
  params: SearchParams
): Promise<SearchResult> {
  if (!isUsingSupabaseServer()) {
    return { ...searchMock(params), source: "mock" };
  }
  return searchSupabase(params);
}

// ─────────────────────────────────────────────────────────
// Supabase — RPC 호출 (006 마이그레이션의 search_recordings)
// ─────────────────────────────────────────────────────────

async function searchSupabase(p: SearchParams): Promise<SearchResult> {
  const supabase = await createSupabaseServerClient();

  // RPC 는 TypeScript 자동생성 타입에 들어있지 않으므로 any 캐스트
  const { data, error } = await (supabase as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: SearchHit[] | null; error: unknown }>;
  }).rpc("search_recordings", {
    query: p.query?.trim() || null,
    p_category: p.category || null,
    p_risk: p.risk && p.risk !== "any" ? p.risk : null,
    p_date_from: p.dateFrom || null,
    p_date_to: p.dateTo || null,
    result_limit: p.limit ?? 50,
  });

  if (error) {
    console.error("[search] RPC error:", error);
    return { hits: [], total: 0, source: "supabase" };
  }
  const hits = data ?? [];
  return { hits, total: hits.length, source: "supabase" };
}

// ─────────────────────────────────────────────────────────
// Mock — 클라이언트 측에서 동일 로직
//
// 같은 시그니처 / 같은 SearchHit 형태로 결과를 만들어
// 페이지가 두 모드를 구분 없이 다룰 수 있게 합니다.
// ─────────────────────────────────────────────────────────

function searchMock(p: SearchParams): { hits: SearchHit[]; total: number } {
  const q = (p.query ?? "").trim();
  const ql = q.toLowerCase();

  const fromTs = p.dateFrom ? Date.parse(p.dateFrom) : null;
  const toTs = p.dateTo ? Date.parse(p.dateTo) : null;

  const hits: SearchHit[] = [];

  for (const r of MOCK_RECORDINGS) {
    // 필터: 카테고리
    if (p.category && r.category !== p.category) continue;
    // 필터: 위험도
    if (p.risk && p.risk !== "any" && r.risk_level !== p.risk) continue;
    // 필터: 날짜 범위
    const ts = Date.parse(r.recorded_at);
    if (fromTs !== null && ts < fromTs) continue;
    if (toTs !== null && ts > toTs) continue;

    // 매칭 검사 (q 가 비어있으면 전체 통과)
    let matched: MatchedIn | null = null;
    let snippet: string | null = null;

    if (!q) {
      matched = "meta";
      snippet = r.title || r.excerpt || r.customer_name || "";
    } else {
      // 1) title
      if (r.title && includesCI(r.title, ql)) {
        matched = "title";
        snippet = r.title;
      }
      // 2) meta — customer_name / excerpt / tags
      if (!matched) {
        const metaHay = [
          r.customer_name ?? "",
          r.excerpt ?? "",
          (r.tags ?? []).join(" "),
        ].join(" ");
        if (includesCI(metaHay, ql)) {
          matched = "meta";
          snippet = r.excerpt || r.title || r.customer_name || "";
        }
      }
      // 3) summary bullets
      if (!matched && r.summary?.length) {
        const hit = r.summary.find((s) => includesCI(s, ql));
        if (hit) {
          matched = "summary";
          snippet = hit;
        }
      }
      // 4) transcript_segments
      if (!matched) {
        const segs = getTranscriptByRecordingId(r.id);
        const hit = segs.find((s) => includesCI(s.text, ql));
        if (hit) {
          matched = "transcript";
          snippet = hit.text;
        }
      }
    }

    if (matched) {
      hits.push({
        id: r.id,
        recorded_at: r.recorded_at,
        title: r.title,
        customer_name: r.customer_name,
        customer_phone: r.customer_phone,
        category: r.category,
        status: r.status,
        sentiment: r.sentiment,
        risk_level: r.risk_level,
        resolved: r.resolved,
        escalated: r.escalated,
        duration_sec: r.duration_sec,
        excerpt: r.excerpt,
        tags: r.tags,
        matched_in: matched,
        snippet,
      });
    }
  }

  // 최신 순
  hits.sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at));

  // limit
  const limit = p.limit ?? 50;
  const sliced = hits.slice(0, limit);
  return { hits: sliced, total: hits.length };
}

function includesCI(haystack: string, needleLower: string): boolean {
  return haystack.toLowerCase().includes(needleLower);
}

// ─────────────────────────────────────────────────────────
// 사용 가능한 카테고리 / 위험도 옵션
// 필터 UI 가 호출해 드롭다운을 채웁니다.
// ─────────────────────────────────────────────────────────

export async function fetchFilterOptions(): Promise<{
  categories: string[];
}> {
  if (!isUsingSupabaseServer()) {
    const cats = new Set<string>();
    for (const r of MOCK_RECORDINGS) {
      if (r.category) cats.add(r.category);
    }
    return { categories: Array.from(cats).sort() };
  }

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("recordings")
    .select("category")
    .not("category", "is", null);

  if (error) return { categories: [] };

  const cats = new Set<string>();
  for (const row of data ?? []) {
    if (row.category) cats.add(row.category);
  }
  return { categories: Array.from(cats).sort() };
}
