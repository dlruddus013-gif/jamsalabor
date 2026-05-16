"use client";

import { useEffect, useRef } from "react";
import { Headphones, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/mock-data";
import type { TranscriptSegment } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// 화자별 시각 토큰
// 좌측 strip + 아바타 + 라벨 칩 색상을 한 곳에서 관리
// ─────────────────────────────────────────────────────────

const SPEAKER_TOKENS = {
  agent: {
    label: "상담원",
    Icon: Headphones,
    avatarBg: "bg-sky",
    avatarText: "text-cream",
    stripBg: "bg-sky",
    chipBg: "bg-sky/15 text-sky",
    activeBg: "bg-sky/8",
  },
  customer: {
    label: "고객",
    Icon: User,
    avatarBg: "bg-accent",
    avatarText: "text-cream",
    stripBg: "bg-accent",
    chipBg: "bg-accent/15 text-accent",
    activeBg: "bg-accent/8",
  },
} as const;

interface Props {
  segments: TranscriptSegment[];
  currentSec: number;
  onSeek?: (sec: number) => void;
  /** processing 등의 사유로 비어있을 때 표시할 메시지를 부모가 정할 수 있게 */
  emptyMessage?: { title: string; description?: string };
  /** 현재 재생 세그먼트로 자동 스크롤 (기본 true) */
  autoScroll?: boolean;
}

export default function TranscriptViewer({
  segments,
  currentSec,
  onSeek,
  emptyMessage,
  autoScroll = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // 현재 재생 중인 세그먼트 인덱스 계산
  const currentIdx = findCurrentIndex(segments, currentSec);

  // 자동 스크롤 — 현재 세그먼트가 컨테이너 밖에 있으면 가운데로
  useEffect(() => {
    if (!autoScroll || currentIdx < 0) return;
    const seg = segments[currentIdx];
    if (!seg) return;
    const node = itemRefs.current.get(seg.id);
    if (!node) return;
    node.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIdx, segments, autoScroll]);

  if (segments.length === 0) {
    return (
      <div className="p-12 text-center">
        <div className="text-[12px] text-ink-mute">
          {emptyMessage?.title ?? "전사 결과가 아직 없습니다."}
        </div>
        {emptyMessage?.description && (
          <div className="text-[11px] text-ink-mute mt-1">
            {emptyMessage.description}
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-2">
      <div className="text-[10px] tracking-[0.25em] uppercase text-gold mb-3">
        Transcript · STT
      </div>

      {segments.map((s, i) => {
        const isCurrent = i === currentIdx;
        const tok = SPEAKER_TOKENS[s.speaker as keyof typeof SPEAKER_TOKENS]
          ?? SPEAKER_TOKENS.customer;
        const Icon = tok.Icon;

        return (
          <button
            key={s.id}
            ref={(el) => {
              if (el) itemRefs.current.set(s.id, el);
              else itemRefs.current.delete(s.id);
            }}
            onClick={() => onSeek?.(s.start_sec)}
            type="button"
            className={cn(
              "w-full text-left flex gap-3 px-3 py-2.5 rounded-xl transition-all relative group",
              "hover:bg-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              isCurrent && tok.activeBg
            )}
          >
            {/* 좌측 색상 strip — 화자 식별의 1차 신호 */}
            <span
              className={cn(
                "absolute left-0 top-2 bottom-2 w-1 rounded-full transition-opacity",
                tok.stripBg,
                isCurrent ? "opacity-100" : "opacity-30 group-hover:opacity-60"
              )}
              aria-hidden
            />

            {/* 아바타 */}
            <div
              className={cn(
                "w-8 h-8 rounded-full flex items-center justify-center shrink-0 ml-2",
                tok.avatarBg,
                tok.avatarText,
                !isCurrent && "opacity-80"
              )}
            >
              <Icon size={12} />
            </div>

            {/* 본문 */}
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2 mb-0.5">
                <span
                  className={cn(
                    "text-[10px] font-semibold px-1.5 py-px rounded",
                    tok.chipBg
                  )}
                >
                  {tok.label}
                </span>
                <span
                  className={cn(
                    "text-[10px] num",
                    isCurrent ? "text-accent font-semibold" : "text-ink-mute"
                  )}
                >
                  {formatDuration(s.start_sec)}
                </span>
                {isCurrent && (
                  <span className="text-[9px] tracking-wider uppercase text-accent animate-pulse-soft">
                    재생 중
                  </span>
                )}
              </div>
              <div
                className={cn(
                  "text-[13px] leading-relaxed",
                  isCurrent ? "text-ink font-medium" : "text-ink-soft"
                )}
              >
                {s.text}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 현재 재생 위치에 해당하는 세그먼트 인덱스
// 마지막 세그먼트 끝을 넘어가면 마지막 인덱스 유지
// ─────────────────────────────────────────────────────────
function findCurrentIndex(
  segments: TranscriptSegment[],
  sec: number
): number {
  if (segments.length === 0) return -1;
  for (let i = 0; i < segments.length; i++) {
    const cur = segments[i];
    const next = segments[i + 1];
    if (!cur) continue;
    if (sec >= cur.start_sec && (!next || sec < next.start_sec)) {
      return i;
    }
  }
  // sec 가 첫 세그먼트보다 앞이면 -1, 끝을 넘어가면 마지막
  return sec < (segments[0]?.start_sec ?? 0) ? -1 : segments.length - 1;
}
