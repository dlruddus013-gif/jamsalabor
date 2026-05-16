"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Search, X, Filter, Calendar } from "lucide-react";
import { cn } from "@/lib/cn";
import { RISK_LABELS } from "@/components/RiskBadge";
import type { RiskLevel } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// SearchPanel
//
// 모든 상태를 URL 쿼리스트링에 반영하므로:
//   - 새로고침해도 검색 조건이 유지되고
//   - 공유 가능한 검색 URL 이 자연스럽게 생기며
//   - 서버 컴포넌트(/recordings/page.tsx) 가 같은 파라미터로 재페칭
// ─────────────────────────────────────────────────────────

interface Props {
  categories: string[];
  total: number;            // 결과 건수
  initialQuery?: string;
  initialCategory?: string;
  initialRisk?: RiskLevel | "any";
  initialDateFrom?: string;
  initialDateTo?: string;
}

const RISK_OPTIONS: ("any" | RiskLevel)[] = [
  "any",
  "high",
  "medium",
  "low",
  "critical",
  "none",
];

export default function SearchPanel({
  categories,
  total,
  initialQuery = "",
  initialCategory = "",
  initialRisk = "any",
  initialDateFrom = "",
  initialDateTo = "",
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // 로컬 상태 — 입력 중일 때 즉시 반영하기 위함
  const [q, setQ] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);
  const [risk, setRisk] = useState<"any" | RiskLevel>(initialRisk);
  const [dateFrom, setDateFrom] = useState(initialDateFrom);
  const [dateTo, setDateTo] = useState(initialDateTo);
  const [showFilters, setShowFilters] = useState(
    !!(initialCategory || initialRisk !== "any" || initialDateFrom || initialDateTo)
  );

  // URL 쿼리 빌드
  const buildHref = (override: Partial<{
    q: string;
    category: string;
    risk: "any" | RiskLevel;
    df: string;
    dt: string;
  }>) => {
    const next = new URLSearchParams();
    const finalQ = override.q !== undefined ? override.q : q;
    const finalCat = override.category !== undefined ? override.category : category;
    const finalRisk = override.risk !== undefined ? override.risk : risk;
    const finalFrom = override.df !== undefined ? override.df : dateFrom;
    const finalTo = override.dt !== undefined ? override.dt : dateTo;

    if (finalQ.trim()) next.set("q", finalQ.trim());
    if (finalCat) next.set("category", finalCat);
    if (finalRisk && finalRisk !== "any") next.set("risk", finalRisk);
    if (finalFrom) next.set("from", finalFrom);
    if (finalTo) next.set("to", finalTo);

    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const apply = (override: Parameters<typeof buildHref>[0] = {}) => {
    const href = buildHref(override);
    startTransition(() => router.push(href));
  };

  // 검색어는 디바운스 — 300ms
  useEffect(() => {
    const same = q.trim() === (searchParams.get("q") ?? "");
    if (same) return;
    const t = setTimeout(() => apply({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  // 다른 필드는 변경 즉시 반영
  const onCategoryChange = (v: string) => {
    setCategory(v);
    apply({ category: v });
  };
  const onRiskChange = (v: "any" | RiskLevel) => {
    setRisk(v);
    apply({ risk: v });
  };
  const onDateFromChange = (v: string) => {
    setDateFrom(v);
    apply({ df: v });
  };
  const onDateToChange = (v: string) => {
    setDateTo(v);
    apply({ dt: v });
  };

  const reset = () => {
    setQ("");
    setCategory("");
    setRisk("any");
    setDateFrom("");
    setDateTo("");
    startTransition(() => router.push(pathname));
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (category) n++;
    if (risk && risk !== "any") n++;
    if (dateFrom) n++;
    if (dateTo) n++;
    return n;
  }, [category, risk, dateFrom, dateTo]);

  const hasAnyFilter = !!q.trim() || activeFilterCount > 0;

  return (
    <div className="rounded-2xl bg-paper border border-line p-4 space-y-3">
      {/* 검색창 */}
      <div className="flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl bg-cream border border-line focus-within:border-accent transition-colors">
          <Search size={14} className="text-ink-mute" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="제목, 고객명, 요약, 전사 검색…"
            className="flex-1 bg-transparent outline-none text-[13px]"
            aria-label="통화 검색"
          />
          {q && (
            <button
              onClick={() => setQ("")}
              className="text-ink-mute hover:text-ink"
              aria-label="검색어 지우기"
            >
              <X size={13} />
            </button>
          )}
        </div>

        <button
          onClick={() => setShowFilters((v) => !v)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium border transition-colors",
            showFilters || activeFilterCount > 0
              ? "bg-ink text-cream border-ink"
              : "bg-paper text-ink-soft border-line hover:bg-surface"
          )}
        >
          <Filter size={12} />
          필터
          {activeFilterCount > 0 && (
            <span className="ml-0.5 num font-bold">{activeFilterCount}</span>
          )}
        </button>
      </div>

      {/* 필터 영역 */}
      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-1">
          {/* 카테고리 */}
          <FilterField label="상담 유형">
            <select
              value={category}
              onChange={(e) => onCategoryChange(e.target.value)}
              className="w-full bg-transparent outline-none text-[13px]"
            >
              <option value="">전체</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FilterField>

          {/* 위험도 */}
          <FilterField label="위험도">
            <select
              value={risk}
              onChange={(e) => onRiskChange(e.target.value as "any" | RiskLevel)}
              className="w-full bg-transparent outline-none text-[13px]"
            >
              {RISK_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r === "any" ? "전체" : RISK_LABELS[r]}
                </option>
              ))}
            </select>
          </FilterField>

          {/* 시작일 */}
          <FilterField label="시작일" icon={<Calendar size={11} />}>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => onDateFromChange(e.target.value)}
              max={dateTo || undefined}
              className="w-full bg-transparent outline-none text-[13px] num"
            />
          </FilterField>

          {/* 종료일 */}
          <FilterField label="종료일" icon={<Calendar size={11} />}>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => onDateToChange(e.target.value)}
              min={dateFrom || undefined}
              className="w-full bg-transparent outline-none text-[13px] num"
            />
          </FilterField>
        </div>
      )}

      {/* 결과 요약 + 초기화 */}
      <div className="flex items-center justify-between pt-1 border-t border-line-soft">
        <div className="text-[11px] text-ink-mute flex items-center gap-2">
          {isPending && (
            <span className="inline-block w-1 h-1 rounded-full bg-accent animate-pulse-soft" />
          )}
          {hasAnyFilter ? (
            <span>
              <span className="font-semibold text-ink">{total}</span>건의 결과
            </span>
          ) : (
            <span>전체 {total}건</span>
          )}
        </div>
        {hasAnyFilter && (
          <button
            onClick={reset}
            className="text-[11px] text-ink-mute hover:text-ink flex items-center gap-1"
          >
            <X size={11} /> 모두 지우기
          </button>
        )}
      </div>
    </div>
  );
}

function FilterField({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-[10px] text-ink-mute mb-1 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="px-3 py-2 rounded-xl border border-line bg-cream focus-within:border-accent transition-colors">
        {children}
      </div>
    </label>
  );
}
