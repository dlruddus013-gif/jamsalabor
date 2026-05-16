// ─────────────────────────────────────────────────────────
// Export formatters
//
// 공유 가능한 순수 함수들 — server-only 가드 불필요.
// ─────────────────────────────────────────────────────────

import type { Recording, TranscriptSegment } from "@/lib/types";
import type { RecordingSummaryView } from "@/lib/recordings";

export type ExportFormat = "txt" | "csv" | "json" | "srt" | "vtt";

export const EXPORT_FORMATS: ExportFormat[] = ["txt", "csv", "json", "srt", "vtt"];

const SPEAKER_LABEL: Record<string, string> = {
  agent: "상담원",
  customer: "고객",
};

// ─────────────────────────────────────────────────────────
// 파일명
// ─────────────────────────────────────────────────────────

/**
 * 다운로드 파일명 생성.
 *   {제목 또는 통화ID}_{YYYY-MM-DD}.{ext}
 *
 * 한국어는 그대로 두되 파일시스템 금지 문자를 정리합니다.
 * Content-Disposition 헤더에서는 contentDisposition() 가 RFC 5987 인코딩 처리.
 */
export function buildFilename(recording: Recording, ext: string): string {
  const titleRaw =
    recording.customer_name ??
    recording.excerpt?.slice(0, 30) ??
    `recording_${recording.id}`;

  const date = new Date(recording.recorded_at);
  const ymd = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

  return `${sanitize(titleRaw)}_${ymd}.${ext}`;
}

function sanitize(s: string): string {
  return (
    s.replace(/[\\/:*?"<>|\r\n\t]/g, "").replace(/\s+/g, "_").slice(0, 80) ||
    "recording"
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Content-Disposition 헤더 값 — 한글 파일명을 RFC 5987 로 인코딩.
 * 구형 클라이언트용 ASCII fallback + UTF-8 filename* 동시 제공.
 */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// ─────────────────────────────────────────────────────────
// 시간 포맷
// ─────────────────────────────────────────────────────────

function fmtMMSS(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor(s / 60))}:${pad2(s % 60)}`;
}

/** SRT: HH:MM:SS,mmm */
function fmtSRT(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1_000);
  const milli = ms % 1000;
  return `${pad2(h)}:${pad2(m)}:${pad2(s)},${String(milli).padStart(3, "0")}`;
}

/** VTT: HH:MM:SS.mmm */
function fmtVTT(sec: number): string {
  return fmtSRT(sec).replace(",", ".");
}

// ─────────────────────────────────────────────────────────
// 포맷별 변환
// ─────────────────────────────────────────────────────────

export function toTxt(
  recording: Recording,
  segments: TranscriptSegment[],
  summary: RecordingSummaryView | null
): string {
  const lines: string[] = [];

  // 헤더 — 메타데이터
  lines.push("─".repeat(60));
  lines.push(`통화 기록: ${recording.customer_name ?? "익명"}`);
  lines.push(`일시      : ${new Date(recording.recorded_at).toLocaleString("ko-KR")}`);
  if (recording.customer_phone)
    lines.push(`연락처    : ${recording.customer_phone}`);
  lines.push(`길이      : ${fmtMMSS(recording.duration_sec)}`);
  if (recording.category) lines.push(`카테고리  : ${recording.category}`);
  if (recording.tags.length > 0) lines.push(`태그      : ${recording.tags.join(", ")}`);
  lines.push("─".repeat(60));

  // 요약
  if (summary && summary.bullets.length > 0) {
    lines.push("");
    lines.push("[ 핵심 요약 ]");
    summary.bullets.forEach((b, i) => lines.push(`  ${i + 1}. ${b}`));
  }
  if (summary && summary.actions.length > 0) {
    lines.push("");
    lines.push("[ 액션 아이템 ]");
    summary.actions.forEach((a) => {
      const mark = a.done ? "✓" : "·";
      lines.push(`  ${mark} ${a.text}`);
    });
  }

  // 전사
  lines.push("");
  lines.push("[ 전사 ]");
  lines.push("");
  if (segments.length === 0) {
    lines.push("  (전사 결과가 없습니다)");
  } else {
    for (const s of segments) {
      const label = SPEAKER_LABEL[s.speaker] ?? s.speaker;
      lines.push(`[${fmtMMSS(s.start_sec)}] ${label}`);
      lines.push(`  ${s.text}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function toCsv(segments: TranscriptSegment[]): string {
  const rows: string[] = ["speaker,start,end,text"];
  for (const s of segments) {
    rows.push(
      [
        csvField(s.speaker),
        csvField(String(s.start_sec)),
        csvField(String(s.end_sec)),
        csvField(s.text),
      ].join(",")
    );
  }
  // BOM 추가 — Excel 한글 인코딩 호환
  return "\uFEFF" + rows.join("\r\n");
}

function csvField(v: string): string {
  // RFC 4180: 필드에 콤마/따옴표/줄바꿈 포함 시 큰따옴표로 감싸고, 내부 따옴표는 두 번
  const needsQuote = /[",\r\n]/.test(v);
  const escaped = v.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

export function toJson(
  recording: Recording,
  segments: TranscriptSegment[],
  summary: RecordingSummaryView | null,
  options: { masked: boolean }
): string {
  const payload = {
    recording: {
      id: recording.id,
      recorded_at: recording.recorded_at,
      duration_sec: recording.duration_sec,
      customer_name: recording.customer_name,
      customer_phone: recording.customer_phone,
      status: recording.status,
      sentiment: recording.sentiment,
      category: recording.category,
      tags: recording.tags,
      excerpt: recording.excerpt,
      escalated: recording.escalated,
      resolved: recording.resolved,
    },
    summary: summary
      ? {
          bullets: summary.bullets,
          actions: summary.actions,
          key_topics: summary.keyTopics,
          model: summary.model,
          created_at: summary.createdAt,
        }
      : null,
    segments: segments.map((s) => ({
      id: s.id,
      start_sec: s.start_sec,
      end_sec: s.end_sec,
      speaker: s.speaker,
      text: s.text,
    })),
    export: {
      format: "json",
      version: 1,
      masked: options.masked,
      generated_at: new Date().toISOString(),
    },
  };
  return JSON.stringify(payload, null, 2);
}

export function toSrt(segments: TranscriptSegment[]): string {
  if (segments.length === 0) return "";
  const blocks: string[] = [];
  segments.forEach((s, i) => {
    const label = SPEAKER_LABEL[s.speaker] ?? s.speaker;
    // 자막은 끝나는 시간이 시작 이후여야 함 — 0 초 세그먼트 보호
    const end = Math.max(s.end_sec, s.start_sec + 0.5);
    blocks.push(
      [
        String(i + 1),
        `${fmtSRT(s.start_sec)} --> ${fmtSRT(end)}`,
        `${label}: ${s.text}`,
        "",
      ].join("\n")
    );
  });
  return blocks.join("\n");
}

export function toVtt(segments: TranscriptSegment[]): string {
  const out: string[] = ["WEBVTT", ""];
  segments.forEach((s, i) => {
    const label = SPEAKER_LABEL[s.speaker] ?? s.speaker;
    const cueId = `cue-${i + 1}`;
    const end = Math.max(s.end_sec, s.start_sec + 0.5);
    out.push(cueId);
    out.push(`${fmtVTT(s.start_sec)} --> ${fmtVTT(end)}`);
    // VTT 는 화자 라벨로 <v Speaker> 태그를 지원
    out.push(`<v ${label}>${s.text}</v>`);
    out.push("");
  });
  return out.join("\n");
}

// ─────────────────────────────────────────────────────────
// MIME 타입
// ─────────────────────────────────────────────────────────

export const FORMAT_MIME: Record<ExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  srt: "application/x-subrip; charset=utf-8",
  vtt: "text/vtt; charset=utf-8",
};
