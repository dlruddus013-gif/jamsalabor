"use client";

import Link from "next/link";
import {
  Smile,
  Meh,
  Frown,
  Clock,
  ChevronRight,
  Headphones,
  User,
  Sparkles,
  FileText,
  Tag,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDuration, formatRelativeKR, maskPhone } from "@/lib/mock-data";
import StatusBadge from "@/components/StatusBadge";
import {
  RISK_CLASS,
  RISK_LABEL,
  type SearchHit,
  type SnippetMatch,
} from "@/lib/search";
import type { Sentiment } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// 검색 결과 리스트
//
// hits 가 있으면 각 hit 의 스니펫을 표시. 검색어가 없는 모드에서는
// item 만 표시하고 스니펫 영역은 숨김. (RecordingList 와 같은 페이지에서
// 분기해 사용)
// ─────────────────────────────────────────────────────────

interface Props {
  hits: SearchHit[];
  query: string;
  /** 검색·필터가 모두 비어있는 상태인가 */
  isIdle: boolean;
}

const SENT_ICON = { pos: Smile, neu: Meh, neg: Frown } as const;
const SENT_COLOR: Record<Sentiment, string> = {
  pos: "text-olive",
  neu: "text-gold",
  neg: "text-accent",
};

export default function RecordingSearchResults({ hits, query, isIdle }: Props) {
  if (hits.length === 0) {
    return (
      <div className="rounded-2xl bg-paper border border-line p-12 text-center">
        <div className="text-[13px] text-ink-soft">
          {isIdle
            ? "표시할 통화가 없습니다."
            : "조건에 맞는 통화를 찾지 못했습니다."}
        </div>
        {!isIdle && (
          <div className="text-[11px] text-ink-mute mt-1">
            검색어를 줄이거나 필터를 초기화해 보세요.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-paper border border-line divide-y divide-line-soft overflow-hidden">
      {hits.map((hit) => (
        <ResultRow key={hit.item.recording.id} hit={hit} query={query} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 결과 행
// ─────────────────────────────────────────────────────────

function ResultRow({ hit, query }: { hit: SearchHit; query: string }) {
  const r = hit.item.recording;
  const SentIcon = r.sentiment ? SENT_ICON[r.sentiment] : Meh;
  const sentColor = r.sentiment ? SENT_COLOR[r.sentiment] : "text-ink-mute";
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  return (
    <Link
      href={`/recordings/${r.id}`}
      className="block px-4 py-3.5 hover:bg-surface/50 transition-colors"
    >
      <div className="flex items-start gap-3">
        {/* 좌측 sentiment 아바타 */}
        <div
          className={cn(
            "w-9 h-9 rounded-full bg-surface flex items-center justify-center shrink-0 mt-0.5",
            sentColor
          )}
        >
          <SentIcon size={15} />
        </div>

        <div className="flex-1 min-w-0">
          {/* 1행: 이름 + 메타 + 시간 */}
          <div className="flex items-center justify-between gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[13px] font-semibold truncate">
                {r.customer_name ?? "익명"}
              </span>
              <span className="text-[10px] num shrink-0 text-ink-mute">
                · {maskPhone(r.customer_phone)}
              </span>
            </div>
            <span className="text-[10px] num shrink-0 text-ink-mute">
              {formatRelativeKR(r.recorded_at)}
            </span>
          </div>

          {/* 2행: 상태 / 카테고리 / 위험도 / 길이 / 태그 일부 */}
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            <StatusBadge status={r.status} />
            {r.category && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gold/15 text-gold font-medium">
                {r.category}
              </span>
            )}
            <span
              className={cn(
                "text-[9px] px-1.5 py-0.5 rounded-full font-medium flex items-center gap-0.5",
                RISK_CLASS[hit.item.risk]
              )}
            >
              <AlertTriangle size={9} /> {RISK_LABEL[hit.item.risk]}
            </span>
            {r.duration_sec > 0 && (
              <span className="text-[9px] num flex items-center gap-0.5 text-ink-mute">
                <Clock size={9} /> {formatDuration(r.duration_sec)}
              </span>
            )}
            {r.tags.slice(0, 3).map((t) => (
              <span
                key={t}
                className="text-[9px] px-1.5 py-0.5 rounded-full bg-line-soft text-ink-soft"
              >
                {t}
              </span>
            ))}
          </div>

          {/* 3행: 스니펫 또는 excerpt */}
          {hit.matches.length > 0 ? (
            <div className="space-y-1.5">
              {hit.matches.map((m, i) => (
                <Snippet key={i} match={m} tokens={tokens} />
              ))}
            </div>
          ) : (
            r.excerpt && (
              <div className="text-[11px] text-ink-mute truncate">
                {r.excerpt}
              </div>
            )
          )}
        </div>

        <ChevronRight size={14} className="text-ink-mute shrink-0 mt-1" />
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────
// 스니펫 (키워드 강조)
// ─────────────────────────────────────────────────────────

function Snippet({
  match,
  tokens,
}: {
  match: SnippetMatch;
  tokens: string[];
}) {
  const SourceIcon =
    match.source === "title"
      ? FileText
      : match.source === "summary"
      ? Sparkles
      : match.speaker === "agent"
      ? Headphones
      : User;

  const sourceLabel =
    match.source === "title"
      ? "제목"
      : match.source === "summary"
      ? "요약"
      : match.speaker === "agent"
      ? "상담원"
      : "고객";

  const sourceColor =
    match.source === "title"
      ? "text-ink-soft bg-line-soft"
      : match.source === "summary"
      ? "text-gold bg-gold/10"
      : match.speaker === "agent"
      ? "text-sky bg-sky/10"
      : "text-accent bg-accent/10";

  return (
    <div className="flex items-start gap-2 text-[11px] leading-relaxed">
      <span
        className={cn(
          "shrink-0 px-1.5 py-0.5 rounded-full flex items-center gap-1 mt-0.5",
          sourceColor
        )}
        style={{ fontSize: 9 }}
      >
        <SourceIcon size={9} />
        {sourceLabel}
        {match.startSec !== null && (
          <span className="num opacity-70 ml-0.5">
            {formatTimecode(match.startSec)}
          </span>
        )}
      </span>
      <span className="text-ink-soft">
        {renderHighlighted(match.context, tokens)}
      </span>
    </div>
  );
}

function formatTimecode(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ─────────────────────────────────────────────────────────
// 키워드 하이라이트
//
// 토큰 단위로 분할해 매치된 부분을 <mark> 처럼 강조.
// 정규식이 아니라 단순 substring 으로 안전하게.
// ─────────────────────────────────────────────────────────

function renderHighlighted(
  text: string,
  tokens: string[]
): React.ReactNode {
  if (tokens.length === 0) return text;

  // 모든 토큰 매치 위치 수집 후, 시작 인덱스 순으로 정렬
  type Hit = { start: number; end: number };
  const hits: Hit[] = [];
  const lower = text.toLowerCase();
  for (const tok of tokens) {
    if (!tok) continue;
    let from = 0;
    while (true) {
      const idx = lower.indexOf(tok, from);
      if (idx < 0) break;
      hits.push({ start: idx, end: idx + tok.length });
      from = idx + tok.length;
    }
  }
  if (hits.length === 0) return text;

  // 겹치는 구간 병합 — 토큰이 서로 포함관계일 때 안전
  hits.sort((a, b) => a.start - b.start);
  const merged: Hit[] = [hits[0]];
  for (let i = 1; i < hits.length; i++) {
    const last = merged[merged.length - 1];
    if (hits[i].start <= last.end) {
      last.end = Math.max(last.end, hits[i].end);
    } else {
      merged.push(hits[i]);
    }
  }

  const out: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < merged.length; i++) {
    const m = merged[i];
    if (cursor < m.start) {
      out.push(text.slice(cursor, m.start));
    }
    out.push(
      <mark
        key={i}
        className="bg-gold/25 text-ink rounded-[2px] px-[1px]"
      >
        {text.slice(m.start, m.end)}
      </mark>
    );
    cursor = m.end;
  }
  if (cursor < text.length) {
    out.push(text.slice(cursor));
  }
  return out;
}
