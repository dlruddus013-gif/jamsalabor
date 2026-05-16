"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, ListFilter, Smile, Meh, Frown, Clock, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDuration, formatRelativeKR, maskPhone } from "@/lib/mock-data";
import StatusBadge from "./StatusBadge";
import type { Recording, Sentiment } from "@/lib/types";

interface Props {
  recordings: Recording[];
  selectedId?: string;
  variant?: "table" | "compact"; // table=대시보드/목록, compact=사이드 리스트
}

const SENTIMENT_ICON = {
  pos: Smile,
  neu: Meh,
  neg: Frown,
};
const SENTIMENT_COLOR: Record<Sentiment, string> = {
  pos: "text-olive",
  neu: "text-gold",
  neg: "text-accent",
};

export default function RecordingList({
  recordings,
  selectedId,
  variant = "table",
}: Props) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "esc" | "res" | "active">("all");

  const filtered = useMemo(() => {
    return recordings.filter((r) => {
      const matchQ =
        !q ||
        r.customer_name?.includes(q) ||
        r.customer_phone?.includes(q) ||
        r.excerpt?.includes(q) ||
        r.tags.some((t) => t.includes(q));
      const matchF =
        filter === "all" ||
        (filter === "esc" && r.escalated) ||
        (filter === "res" && r.resolved) ||
        (filter === "active" && (r.status === "uploading" || r.status === "processing"));
      return matchQ && matchF;
    });
  }, [recordings, q, filter]);

  const counts = useMemo(
    () => ({
      all: recordings.length,
      esc: recordings.filter((r) => r.escalated).length,
      res: recordings.filter((r) => r.resolved).length,
      active: recordings.filter(
        (r) => r.status === "uploading" || r.status === "processing"
      ).length,
    }),
    [recordings]
  );

  return (
    <div className="rounded-2xl bg-paper border border-line overflow-hidden">
      {/* 검색·필터 */}
      <div className="p-3 border-b border-line flex items-center gap-2">
        <div className="flex-1 px-3 py-2 rounded-xl bg-surface flex items-center gap-2">
          <Search size={13} className="text-ink-mute" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름·번호·내용·태그 검색"
            className="flex-1 bg-transparent outline-none text-[12px]"
          />
        </div>
        <button className="w-9 h-9 rounded-xl bg-surface text-ink-soft flex items-center justify-center">
          <ListFilter size={14} />
        </button>
      </div>

      {/* 필터 칩 */}
      <div className="flex gap-1 p-2 border-b border-line-soft overflow-x-auto">
        {[
          { k: "all", label: `전체 ${counts.all}` },
          { k: "active", label: `진행 중 ${counts.active}` },
          { k: "esc", label: `핸드오프 ${counts.esc}` },
          { k: "res", label: `해결 ${counts.res}` },
        ].map((t) => (
          <button
            key={t.k}
            onClick={() => setFilter(t.k as typeof filter)}
            className={cn(
              "px-3 py-1.5 text-[11px] rounded-full whitespace-nowrap transition-colors",
              filter === t.k
                ? "bg-ink text-cream font-semibold"
                : "text-ink-soft hover:bg-surface"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 리스트 */}
      <div
        className={cn(
          "divide-y divide-line-soft scroll-thin",
          variant === "compact" ? "max-h-[70vh] overflow-y-auto" : ""
        )}
      >
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-[12px] text-ink-mute">
            조건에 맞는 통화가 없습니다.
          </div>
        ) : (
          filtered.map((r) => (
            <RecordingRow
              key={r.id}
              recording={r}
              active={r.id === selectedId}
              compact={variant === "compact"}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RecordingRow({
  recording: r,
  active,
  compact,
}: {
  recording: Recording;
  active: boolean;
  compact: boolean;
}) {
  const SentIcon = r.sentiment ? SENTIMENT_ICON[r.sentiment] : Meh;
  const sentColor = r.sentiment ? SENTIMENT_COLOR[r.sentiment] : "text-ink-mute";

  return (
    <Link
      href={`/recordings/${r.id}`}
      className={cn(
        "block px-4 py-3 transition-colors",
        active ? "bg-surface border-l-[3px] border-accent" : "hover:bg-surface/50 border-l-[3px] border-transparent"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-9 h-9 rounded-full flex items-center justify-center shrink-0",
            active ? "bg-paper" : "bg-surface",
            sentColor
          )}
        >
          <SentIcon size={15} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[13px] font-semibold truncate">
              {r.customer_name ?? "익명"}
            </div>
            <div className="text-[10px] num shrink-0 text-ink-mute">
              {formatRelativeKR(r.recorded_at)}
            </div>
          </div>
          <div className="text-[11px] num truncate mt-0.5 text-ink-soft">
            {maskPhone(r.customer_phone)}
          </div>
          {r.excerpt && !compact && (
            <div className="text-[11px] truncate mt-1 text-ink-mute">{r.excerpt}</div>
          )}
          <div className="flex items-center gap-1.5 mt-2 flex-wrap">
            <StatusBadge status={r.status} />
            {r.duration_sec > 0 && (
              <span className="text-[9px] num flex items-center gap-0.5 text-ink-mute">
                <Clock size={9} /> {formatDuration(r.duration_sec)}
              </span>
            )}
            {r.escalated && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/10 text-accent">
                핸드오프
              </span>
            )}
            {r.resolved && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-olive/10 text-olive">
                해결
              </span>
            )}
            {!compact &&
              r.tags.slice(0, 2).map((t) => (
                <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-line-soft text-ink-soft">
                  {t}
                </span>
              ))}
          </div>
        </div>
        <ChevronRight size={14} className="text-ink-mute shrink-0 mt-1" />
      </div>
    </Link>
  );
}
