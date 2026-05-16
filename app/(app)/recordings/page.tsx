import SearchPanel from "@/components/SearchPanel";
import SearchResults from "@/components/SearchResults";
import {
  searchRecordings,
  fetchFilterOptions,
} from "@/lib/recordings-search";
import type { RiskLevel } from "@/lib/types";

// 검색 결과는 자주 바뀌므로 캐시 비활성화
export const dynamic = "force-dynamic";
export const revalidate = 0;

const VALID_RISKS: ("any" | RiskLevel)[] = [
  "any",
  "none",
  "low",
  "medium",
  "high",
  "critical",
];

interface PageProps {
  searchParams: Promise<{
    q?: string;
    category?: string;
    risk?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function RecordingsPage({ searchParams }: PageProps) {
  const sp = await searchParams;

  const query = sp.q?.trim() || "";
  const category = sp.category || "";
  const riskRaw = (sp.risk || "any") as "any" | RiskLevel;
  const risk: "any" | RiskLevel = VALID_RISKS.includes(riskRaw) ? riskRaw : "any";

  const dateFrom = sp.from || "";
  const dateTo = sp.to || "";

  // 종료일은 해당 날짜의 끝까지 포함하도록 23:59:59.999 추가
  const dateToInclusive = dateTo ? `${dateTo}T23:59:59.999Z` : "";
  const dateFromIso = dateFrom ? `${dateFrom}T00:00:00.000Z` : "";

  const [{ hits, total, source }, options] = await Promise.all([
    searchRecordings({
      query,
      category,
      risk,
      dateFrom: dateFromIso,
      dateTo: dateToInclusive,
      limit: 100,
    }),
    fetchFilterOptions(),
  ]);

  const hasFilters =
    !!query ||
    !!category ||
    risk !== "any" ||
    !!dateFrom ||
    !!dateTo;

  return (
    <div className="space-y-5 animate-slide-up">
      <div>
        <div className="text-[11px] tracking-[0.3em] uppercase text-gold mb-1">
          Recordings
        </div>
        <h1 className="font-display text-[28px] font-bold">통화 녹음</h1>
        <p className="text-[13px] text-ink-soft mt-1">
          제목·요약·전사를 한 번에 검색할 수 있습니다.
          {source === "mock" && (
            <span className="ml-2 text-[11px] px-1.5 py-0.5 rounded bg-gold/15 text-gold">
              mock 모드
            </span>
          )}
        </p>
      </div>

      <SearchPanel
        categories={options.categories}
        total={total}
        initialQuery={query}
        initialCategory={category}
        initialRisk={risk}
        initialDateFrom={dateFrom}
        initialDateTo={dateTo}
      />

      <SearchResults hits={hits} query={query} hasFilters={hasFilters} />
    </div>
  );
}
