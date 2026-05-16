"use client";

import { useEffect, useRef, useState } from "react";
import {
  Search,
  X,
  ChevronDown,
  Calendar,
  AlertTriangle,
  Tag as TagIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  EMPTY_FILTERS,
  RISK_LABEL,
  type RiskLevel,
  type SearchFilters,
} from "@/lib/search";

// ─────────────────────────────────────────────────────────
// /recordings 상단 검색바 + 필터 드로어
// ─────────────────────────────────────────────────────────

interface Props {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
  /** 필터 드롭다운에 채울 카테고리 후보 */
  categories: string[];
  /** 결과 개수 — 헤더에 함께 표시 */
  totalHits: number;
  totalAll: number;
}

const RISK_OPTIONS: { value: RiskLevel | "all"; label: string }[] = [
  { value: "all",    label: "전체" },
  { value: "high",   label: "긴급만" },
  { value: "medium", label: "주의 이상" },
  { value: "low",    label: "관찰 이상" },
];

export default function RecordingsSearchBar({
  filters,
  onChange,
  categories,
  totalHits,
  totalAll,
}: Props) {
  // 검색어 입력은 디바운스 처리 — 큰 데이터셋에서도 부드럽게
  const [draft, setDraft] = useState(filters.query);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // 외부에서 filters.query 가 reset 되면 draft 도 동기화
  useEffect(() => {
    setDraft(filters.query);
  }, [filters.query]);

  useEffect(() => {
    const id = setTimeout(() => {
      if (draft !== filters.query) {
        onChange({ ...filters, query: draft });
      }
    }, 200);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const set = <K extends keyof SearchFilters>(key: K, value: SearchFilters[K]) => {
    onChange({ ...filters, [key]: value });
  };

  const reset = () => {
    setDraft("");
    onChange(EMPTY_FILTERS);
    inputRef.current?.focus();
  };

  const hasActive =
    !!filters.query ||
    !!filters.category ||
    !!filters.risk ||
    !!filters.dateFrom ||
    !!filters.dateTo;

  return (
    <div className="rounded-2xl bg-paper border border-line p-4 space-y-3">
      {/* 검색창 */}
      <div className="flex items-center gap-2">
        <div className="flex-1 px-3 py-2.5 rounded-xl bg-cream border border-line flex items-center gap-2 focus-within:border-accent transition-colors">
          <Search size={14} className="text-ink-mute shrink-0" />
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="고객 이름·요약·전사 텍스트 검색…"
            className="flex-1 bg-transparent outline-none text-[13px]"
          />
          {draft && (
            <button
              onClick={() => setDraft("")}
              className="w-5 h-5 rounded-full hover:bg-line-soft flex items-center justify-center"
              title="검색어 지우기"
            >
              <X size={12} className="text-ink-mute" />
            </button>
          )}
        </div>
        {hasActive && (
          <button
            onClick={reset}
            className="px-3 py-2.5 rounded-xl bg-paper border border-line text-[12px] text-ink-soft hover:bg-surface flex items-center gap-1"
          >
            <X size={12} /> 초기화
          </button>
        )}
      </div>

      {/* 필터 행 */}
      <div className="flex flex-wrap gap-2 items-center">
        {/* 카테고리 */}
        <FilterSelect
          icon={TagIcon}
          label="상담 유형"
          value={filters.category ?? ""}
          onChange={(v) => set("category", v || null)}
          options={[
            { value: "", label: "전체" },
            ...categories.map((c) => ({ value: c, label: c })),
          ]}
          active={!!filters.category}
        />

        {/* 위험도 */}
        <FilterSelect
          icon={AlertTriangle}
          label="위험도"
          value={filters.risk ?? "all"}
          onChange={(v) => set("risk", v === "all" ? null : (v as RiskLevel))}
          options={RISK_OPTIONS.map((o) => ({
            value: o.value,
            label:
              o.value === "all"
                ? o.label
                : `${o.label} (${RISK_LABEL[o.value as RiskLevel]})`,
          }))}
          active={!!filters.risk}
        />

        {/* 날짜 범위 */}
        <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-line bg-cream text-[12px]">
          <Calendar size={12} className="text-ink-mute" />
          <input
            type="date"
            value={filters.dateFrom ?? ""}
            onChange={(e) => set("dateFrom", e.target.value || null)}
            className="bg-transparent outline-none text-[11px] num"
          />
          <span className="text-ink-mute">–</span>
          <input
            type="date"
            value={filters.dateTo ?? ""}
            onChange={(e) => set("dateTo", e.target.value || null)}
            className="bg-transparent outline-none text-[11px] num"
          />
          {(filters.dateFrom || filters.dateTo) && (
            <button
              onClick={() => onChange({ ...filters, dateFrom: null, dateTo: null })}
              className="ml-1 w-4 h-4 rounded-full hover:bg-line-soft flex items-center justify-center"
              title="날짜 지우기"
            >
              <X size={10} className="text-ink-mute" />
            </button>
          )}
        </div>

        {/* 결과 카운트 */}
        <div className="ml-auto text-[11px] text-ink-mute num">
          {hasActive ? (
            <>
              <span className="font-semibold text-ink">{totalHits}</span>
              <span> / {totalAll} 건</span>
            </>
          ) : (
            <>전체 <span className="font-semibold text-ink">{totalAll}</span> 건</>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 필터 드롭다운 (네이티브 select 래퍼 — 모바일 친화)
// ─────────────────────────────────────────────────────────

function FilterSelect({
  icon: Icon,
  label,
  value,
  onChange,
  options,
  active,
}: {
  icon: typeof Search;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  active: boolean;
}) {
  return (
    <label
      className={cn(
        "flex items-center gap-1 px-2 py-1.5 rounded-lg border text-[12px] cursor-pointer transition-colors",
        active
          ? "bg-accent/10 border-accent/40 text-accent"
          : "bg-cream border-line text-ink-soft hover:bg-surface"
      )}
    >
      <Icon size={12} className="opacity-70" />
      <span className="text-[10px] uppercase tracking-wider">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent outline-none text-[12px] font-medium pr-1 cursor-pointer"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={11} className="opacity-60 -ml-1" />
    </label>
  );
}
