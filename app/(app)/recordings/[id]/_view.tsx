"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Phone,
  Clock,
  Calendar,
  Sparkles,
  Tag,
  Loader2,
  AlertTriangle,
  Headphones,
  User,
  RefreshCw,
  MessageCircle,
  ClipboardCheck,
  ListTodo,
} from "lucide-react";
import RecordingPlayer, {
  type RecordingPlayerHandle,
} from "@/components/RecordingPlayer";
import TranscriptViewer from "@/components/TranscriptViewer";
import DownloadButtons from "@/components/DownloadButtons";
import StatusBadge from "@/components/StatusBadge";
import RiskBadge from "@/components/RiskBadge";
import {
  formatDuration,
  formatRelativeKR,
  maskPhone,
} from "@/lib/mock-data";
import { cn } from "@/lib/cn";
import type { Sentiment } from "@/lib/types";
import type { RecordingDetail } from "@/lib/recordings";

// ─────────────────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────────────────

const SENT_LABEL: Record<Sentiment, string> = {
  pos: "긍정",
  neu: "중립",
  neg: "부정",
};
const SENT_CLASS: Record<Sentiment, string> = {
  pos: "bg-olive/15 text-olive",
  neu: "bg-gold/15 text-gold",
  neg: "bg-accent/15 text-accent",
};

// ─────────────────────────────────────────────────────────
// 메인
// ─────────────────────────────────────────────────────────

export default function RecordingDetailView({ data }: { data: RecordingDetail }) {
  const { recording, transcript, summary, audioUrl, jobError } = data;
  const [currentSec, setCurrentSec] = useState(0);
  const [processingRequested, setProcessingRequested] = useState(false);
  const [, startTransition] = useTransition();
  const router = useRouter();
  const playerRef = useRef<RecordingPlayerHandle | null>(null);

  const liveStatus = recording.status === "uploading" || recording.status === "processing";

  useEffect(() => {
    if (!liveStatus) return;

    const timer = window.setInterval(() => {
      startTransition(() => router.refresh());
    }, 3000);

    return () => window.clearInterval(timer);
  }, [liveStatus, router]);

  useEffect(() => {
    if (!liveStatus || processingRequested) return;

    setProcessingRequested(true);
    void fetch("/api/jobs/process-recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId: recording.id }),
    }).finally(() => {
      startTransition(() => router.refresh());
    });
  }, [liveStatus, processingRequested, recording.id, router]);

  // transcript 클릭 → audio 시킹 + 재생 시작
  const handleSeek = (sec: number) => {
    setCurrentSec(sec);
    playerRef.current?.seekTo(sec);
    playerRef.current?.play();
  };

  return (
    <div className="space-y-5 animate-slide-up">
      {/* 뒤로가기 */}
      <Link
        href="/recordings"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-soft hover:text-ink"
      >
        <ArrowLeft size={13} /> 통화 목록
      </Link>

      {/* 헤더 */}
      <header className="rounded-2xl bg-paper border border-line p-5">
        <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] tracking-[0.25em] uppercase text-gold">
                Call · {new Date(recording.recorded_at).toLocaleDateString("ko-KR")}
              </span>
              <StatusBadge status={recording.status} />
              {recording.category && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gold/15 text-gold font-medium">
                  {recording.category}
                </span>
              )}
              {recording.sentiment && (
                <span
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded-full",
                    SENT_CLASS[recording.sentiment]
                  )}
                >
                  {SENT_LABEL[recording.sentiment]}
                </span>
              )}
              {recording.escalated && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/15 text-accent">
                  핸드오프
                </span>
              )}
              {recording.resolved && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-olive/15 text-olive">
                  해결
                </span>
              )}
              <RiskBadge risk={recording.risk_level} />
            </div>
            <h1 className="font-display text-[24px] font-bold">
              {recording.title || recording.customer_name || "익명 통화"}
            </h1>
            {recording.title && recording.customer_name && (
              <div className="text-[12px] text-ink-soft mt-0.5">
                {recording.customer_name}
              </div>
            )}
            <div className="text-[12px] num mt-1 flex items-center gap-3 flex-wrap text-ink-soft">
              <span className="flex items-center gap-1">
                <Phone size={11} /> {maskPhone(recording.customer_phone)}
              </span>
              <span className="flex items-center gap-1">
                <Clock size={11} /> {formatDuration(recording.duration_sec)}
              </span>
              <span className="flex items-center gap-1">
                <Calendar size={11} /> {formatRelativeKR(recording.recorded_at)}
              </span>
            </div>
          </div>
          <DownloadButtons recording={recording} transcript={transcript} />
        </div>

        {/* 플레이어 */}
        <RecordingPlayer
          ref={playerRef}
          audioUrl={audioUrl}
          durationSec={recording.duration_sec}
          onTimeUpdate={setCurrentSec}
        />

        {/* 화자 범례 — 색상 약속 */}
        <div className="flex items-center gap-3 mt-3 text-[10px] text-ink-mute">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-sky" />
            <Headphones size={10} /> 상담원
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent" />
            <User size={10} /> 고객
          </span>
        </div>

        {/* 태그 */}
        {recording.tags.length > 0 && (
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            {recording.tags.map((tg) => (
              <span
                key={tg}
                className="text-[10px] px-2 py-1 rounded-full bg-line-soft text-ink-soft flex items-center gap-1"
              >
                <Tag size={9} /> {tg}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* 본문: 좌 전사 / 우 요약 */}
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        {/* ── 좌측: 전사 영역 (상태별 분기) ─────────────── */}
        <section className="rounded-2xl bg-paper border border-line p-5 max-h-[70vh] overflow-y-auto scroll-thin">
          {recording.status === "completed" || recording.status === "processing"
            ? (transcript.length > 0 || recording.status === "completed") && (
                <TranscriptViewer
                  segments={transcript}
                  currentSec={currentSec}
                  onSeek={handleSeek}
                  emptyMessage={
                    recording.status === "completed"
                      ? {
                          title: "전사 결과가 비어 있습니다.",
                          description:
                            "STT 엔진이 발화를 감지하지 못했거나 빈 오디오일 수 있습니다.",
                        }
                      : undefined
                  }
                />
              )
            : null}

          {recording.status === "processing" && transcript.length === 0 && (
            <ProcessingState />
          )}

          {recording.status === "uploading" && <UploadingState />}

          {recording.status === "failed" && (
            <FailedState error={jobError} recordingId={recording.id} />
          )}
        </section>

        {/* ── 우측: 사이드 ─────────────────────────────── */}
        <aside className="space-y-4">
          {/* 상태가 processing/failed 일 때는 위쪽에 요약 자리에 안내 표시 */}
          {recording.status === "processing" && (
            <div className="rounded-2xl bg-paper border border-line p-5">
              <div className="text-[10px] tracking-[0.25em] uppercase text-gold flex items-center gap-1.5 mb-3">
                <Sparkles size={10} /> 요약
              </div>
              <div className="space-y-2">
                <SkeletonLine />
                <SkeletonLine width="80%" />
                <SkeletonLine width="60%" />
              </div>
              <div className="text-[11px] text-ink-mute mt-3 flex items-center gap-1.5">
                <Loader2 size={11} className="animate-spin" />
                요약 생성 대기 중…
              </div>
            </div>
          )}

          {recording.status === "failed" && (
            <div className="rounded-2xl bg-paper border border-line p-5">
              <div className="text-[10px] tracking-[0.25em] uppercase text-gold flex items-center gap-1.5 mb-2">
                <Sparkles size={10} /> 요약
              </div>
              <div className="text-[12px] text-ink-mute">
                STT 실패로 요약을 생성할 수 없습니다.
              </div>
            </div>
          )}

          {/* completed 상태: 4개 섹션 */}
          {recording.status === "completed" && (() => {
            const grouped = splitSummary(summary, recording.excerpt);
            return (
              <>
                {/* 1) 상담 요약 — 전체 흐름 한 줄 */}
                <SummarySection
                  title="상담 요약"
                  icon={Sparkles}
                  empty="요약이 없습니다."
                  emptyShown={!grouped.headline}
                >
                  {grouped.headline && (
                    <p className="text-[13px] leading-relaxed text-ink">
                      {grouped.headline}
                    </p>
                  )}
                  {summary?.model && (
                    <div className="text-[9px] text-ink-mute mt-3 pt-2 border-t border-line-soft">
                      모델: {summary.model}
                    </div>
                  )}
                </SummarySection>

                {/* 2) 고객 요청 */}
                <SummarySection
                  title="고객 요청"
                  icon={MessageCircle}
                  empty="감지된 고객 요청이 없습니다."
                  emptyShown={grouped.requests.length === 0}
                >
                  <BulletList items={grouped.requests} accent="accent" />
                </SummarySection>

                {/* 3) 응대 결과 */}
                <SummarySection
                  title="응대 결과"
                  icon={ClipboardCheck}
                  empty="응대 결과가 기록되지 않았습니다."
                  emptyShown={grouped.outcomes.length === 0}
                >
                  <BulletList items={grouped.outcomes} accent="olive" />
                </SummarySection>

                {/* 4) 후속 조치 */}
                <SummarySection
                  title="후속 조치"
                  icon={ListTodo}
                  empty="필요한 후속 조치가 없습니다."
                  emptyShown={(summary?.actions.length ?? 0) === 0}
                >
                  {summary && summary.actions.length > 0 && (
                    <div className="space-y-1.5">
                      {summary.actions.map((a) => (
                        <label
                          key={a.id}
                          className="flex items-start gap-2 p-2 rounded-lg hover:bg-surface/50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            defaultChecked={a.done}
                            className="mt-0.5"
                            style={{ accentColor: "#6B7A3B" }}
                          />
                          <span
                            className="text-[12px]"
                            style={{
                              color: a.done ? "#8B7A66" : "#1F1812",
                              textDecoration: a.done ? "line-through" : "none",
                            }}
                          >
                            {a.text}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </SummarySection>

                {/* Key Topics */}
                {summary && summary.keyTopics.length > 0 && (
                  <div className="rounded-2xl bg-paper border border-line p-5">
                    <div className="text-[10px] tracking-[0.25em] uppercase text-gold mb-3">
                      Key Topics
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {summary.keyTopics.map((t) => (
                        <span
                          key={t}
                          className="text-[11px] px-2 py-1 rounded-full bg-surface text-ink-soft"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          })()}

          {/* 고객 정보 */}
          <div className="rounded-2xl bg-paper border border-line p-5">
            <div className="text-[10px] tracking-[0.25em] uppercase text-gold mb-3">
              Customer
            </div>
            <div className="space-y-1.5 text-[12px]">
              <Row label="이름" value={recording.customer_name ?? "—"} />
              <Row label="번호" value={maskPhone(recording.customer_phone)} mono />
              <Row label="카테고리" value={recording.category ?? "—"} />
              <Row
                label="상태"
                value={
                  recording.status === "failed"
                    ? "실패"
                    : recording.status === "processing"
                    ? "분석 중"
                    : recording.resolved
                    ? "해결"
                    : recording.escalated
                    ? "담당자 배정"
                    : "진행 중"
                }
              />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 요약 분류
//
// recording_summaries.summary[] 는 자유 형식 bullet 리스트입니다.
// 명시 컬럼이 없으므로 키워드 휴리스틱으로 4개 섹션에 배치합니다.
// 추후 워커에서 카테고리 컬럼이 추가되면 그 값을 그대로 사용하도록 교체하세요.
// ─────────────────────────────────────────────────────────

interface GroupedSummary {
  headline: string | null;
  requests: string[];
  outcomes: string[];
}

const REQUEST_HINTS = [
  "원해", "원하", "문의", "희망", "가능", "되나요", "되나",
  "가요", "할까요", "예약", "필요", "요청", "확인", "알려",
];
const OUTCOME_HINTS = [
  "안내", "설명", "전달", "확정", "발송", "회신", "처리", "약속",
  "합의", "공지", "완료", "예정", "보내드", "보냈", "드림", "드렸",
];

function splitSummary(
  summary: { bullets: string[] } | null,
  fallbackExcerpt: string | null
): GroupedSummary {
  const bullets = summary?.bullets ?? [];

  if (bullets.length === 0) {
    return {
      headline: null,
      requests: fallbackExcerpt ? [fallbackExcerpt] : [],
      outcomes: [],
    };
  }

  // 첫 줄은 항상 headline (전체 요약).
  const [headline, ...rest] = bullets;
  const requests: string[] = [];
  const outcomes: string[] = [];

  for (const line of rest) {
    const isOutcome = OUTCOME_HINTS.some((k) => line.includes(k));
    const isRequest = REQUEST_HINTS.some((k) => line.includes(k));
    if (isOutcome && !isRequest) outcomes.push(line);
    else if (isRequest && !isOutcome) requests.push(line);
    else outcomes.push(line); // 애매하면 응대 결과로
  }

  // requests 가 비었는데 excerpt 가 있으면 그걸 보강
  if (requests.length === 0 && fallbackExcerpt) {
    requests.push(fallbackExcerpt);
  }

  return { headline, requests, outcomes };
}

// ─────────────────────────────────────────────────────────
// 작은 컴포넌트
// ─────────────────────────────────────────────────────────

function SummarySection({
  title,
  icon: Icon,
  empty,
  emptyShown,
  children,
}: {
  title: string;
  icon: typeof Sparkles;
  empty: string;
  emptyShown: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-paper border border-line p-5">
      <div className="text-[10px] tracking-[0.25em] uppercase text-gold flex items-center gap-1.5 mb-3">
        <Icon size={10} /> {title}
      </div>
      {emptyShown ? (
        <div className="text-[12px] text-ink-mute">{empty}</div>
      ) : (
        children
      )}
    </div>
  );
}

function BulletList({
  items,
  accent,
}: {
  items: string[];
  accent: "accent" | "olive";
}) {
  const dotClass = accent === "accent" ? "bg-accent" : "bg-olive";
  return (
    <ul className="space-y-2">
      {items.map((s, i) => (
        <li key={i} className="flex gap-2 text-[12px] leading-relaxed">
          <span
            className={cn(
              "shrink-0 mt-1.5 w-1.5 h-1.5 rounded-full",
              dotClass
            )}
          />
          <span>{s}</span>
        </li>
      ))}
    </ul>
  );
}

// ─────────────────────────────────────────────────────────
// 상태별 패널
// ─────────────────────────────────────────────────────────

function ProcessingState() {
  return (
    <div className="py-12 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full bg-gold/15 flex items-center justify-center mb-4">
        <Loader2 size={20} className="text-gold animate-spin" />
      </div>
      <div className="font-display text-[16px] font-bold mb-1">
        텍스트 변환 중
      </div>
      <p className="text-[12px] text-ink-soft max-w-sm leading-relaxed">
        STT 워커가 오디오를 분석하고 있습니다.
        <br />
        보통 통화 길이의 1/4 정도 시간이 소요됩니다.
      </p>
      <div className="mt-5 w-full max-w-sm space-y-2">
        <SkeletonLine />
        <SkeletonLine width="85%" />
        <SkeletonLine width="70%" />
        <SkeletonLine width="90%" />
      </div>
    </div>
  );
}

function UploadingState() {
  return (
    <div className="py-12 flex flex-col items-center text-center">
      <div className="w-12 h-12 rounded-full bg-sky/15 flex items-center justify-center mb-4">
        <Loader2 size={20} className="text-sky animate-spin" />
      </div>
      <div className="font-display text-[16px] font-bold mb-1">
        업로드 진행 중
      </div>
      <p className="text-[12px] text-ink-soft max-w-sm leading-relaxed">
        오디오 파일을 Storage 로 업로드하고 있습니다.
      </p>
    </div>
  );
}

function FailedState({
  error,
  recordingId,
}: {
  error: { code: string | null; message: string | null; retryCount: number } | null;
  recordingId: string;
}) {
  return (
    <div className="py-10">
      <div className="rounded-xl bg-accent/8 border border-accent/30 p-5 max-w-2xl mx-auto">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-full bg-accent/15 text-accent flex items-center justify-center shrink-0">
            <AlertTriangle size={17} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[16px] font-bold text-accent">
              텍스트 변환에 실패했습니다
            </div>
            <p className="text-[12px] text-ink-soft mt-1">
              아래 사유를 확인하고 STT 워커 로그를 함께 살펴보세요.
            </p>

            {error ? (
              <div className="mt-4 space-y-3">
                {error.code && (
                  <div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-ink-mute mb-1">
                      Error Code
                    </div>
                    <code className="text-[12px] px-2 py-1 rounded bg-paper border border-line text-accent num inline-block">
                      {error.code}
                    </code>
                  </div>
                )}
                {error.message && (
                  <div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-ink-mute mb-1">
                      Message
                    </div>
                    <pre className="text-[11px] p-3 rounded bg-paper border border-line text-ink-soft whitespace-pre-wrap break-words max-h-48 overflow-y-auto scroll-thin">
                      {error.message}
                    </pre>
                  </div>
                )}
                <div className="text-[10px] text-ink-mute">
                  재시도 횟수: {error.retryCount}회
                </div>
              </div>
            ) : (
              <div className="mt-3 text-[12px] text-ink-soft">
                상세 사유를 가져올 수 없습니다. stt_jobs 테이블을 직접 확인해 주세요.
              </div>
            )}

            <div className="mt-5 flex items-center gap-2">
              <button
                className="px-3 py-1.5 rounded-lg bg-paper border border-line text-[11px] text-ink-soft hover:bg-surface flex items-center gap-1.5"
                disabled
                title="향후 활성화 — stt_jobs 에 새 queued 잡 생성"
              >
                <RefreshCw size={11} /> 재시도 (예정)
              </button>
              <code className="text-[10px] text-ink-mute">recording_id: {recordingId}</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonLine({ width = "100%" }: { width?: string }) {
  return (
    <div
      className="h-3 rounded bg-line-soft animate-pulse-soft"
      style={{ width }}
    />
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-mute">{label}</span>
      <span className={mono ? "num font-medium" : "font-medium"}>{value}</span>
    </div>
  );
}
