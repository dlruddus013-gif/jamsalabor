"use client";

import { useEffect, useRef, useState } from "react";
import {
  Download,
  FileAudio,
  FileText,
  ChevronDown,
  EyeOff,
  Eye,
  Check,
  Copy,
} from "lucide-react";
import { cn } from "@/lib/cn";
import type { Recording, TranscriptSegment } from "@/lib/types";

// ─────────────────────────────────────────────────────────
// API 기반 다운로드 버튼
//
// 모든 다운로드는 서버 API 라우트를 거칩니다 (audit_logs 자동 기록).
//   /api/recordings/{id}/download-audio
//   /api/recordings/{id}/export?format=...&mask=...
// ─────────────────────────────────────────────────────────

interface Props {
  recording: Recording;
  transcript: TranscriptSegment[];
}

type ExportFormat = "txt" | "csv" | "json" | "srt" | "vtt";

const FORMAT_LABEL: Record<ExportFormat, string> = {
  txt: "텍스트 (.txt)",
  csv: "표 (.csv)",
  json: "JSON (.json)",
  srt: "자막 (.srt)",
  vtt: "WebVTT (.vtt)",
};

export default function DownloadButtons({ recording, transcript }: Props) {
  const [mask, setMask] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const exportUrl = (format: ExportFormat) => {
    const params = new URLSearchParams({ format });
    if (mask) params.set("mask", "true");
    return `/api/recordings/${recording.id}/export?${params.toString()}`;
  };

  const downloadAudioUrl = `/api/recordings/${recording.id}/download-audio`;
  const hasTranscript = transcript.length > 0;
  const hasAudio = recording.status === "completed" || recording.audio_url;

  // 전사 클립보드 복사 — 서버 API 호출 후 복사
  const copyTranscript = async () => {
    try {
      const res = await fetch(exportUrl("txt"), { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      alert(`복사 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {/* 마스킹 토글 — 모든 export 에 적용 */}
      <button
        onClick={() => setMask((v) => !v)}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] font-medium transition-colors",
          mask
            ? "bg-gold/15 text-gold border border-gold/40"
            : "bg-paper text-ink-mute border border-line hover:bg-surface"
        )}
        title={mask ? "개인정보 마스킹 ON" : "개인정보 마스킹 OFF"}
      >
        {mask ? <EyeOff size={12} /> : <Eye size={12} />}
        마스킹 {mask ? "ON" : "OFF"}
      </button>

      {/* 오디오 다운로드 */}
      <a
        href={downloadAudioUrl}
        // 새 탭이 아니라 같은 컨텍스트에서 받음 — 서버 라우트가 attachment 헤더 부여
        download
        aria-disabled={!hasAudio}
        onClick={(e) => {
          if (!hasAudio) e.preventDefault();
        }}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] border",
          hasAudio
            ? "bg-paper border-line text-ink-soft hover:bg-surface"
            : "bg-paper border-line text-ink-mute opacity-50 pointer-events-none cursor-not-allowed"
        )}
      >
        <FileAudio size={13} />
        오디오
        <Download size={11} className="opacity-60" />
      </a>

      {/* TXT 빠른 다운로드 */}
      <a
        href={exportUrl("txt")}
        download
        aria-disabled={!hasTranscript}
        onClick={(e) => {
          if (!hasTranscript) e.preventDefault();
        }}
        className={cn(
          "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] border",
          hasTranscript
            ? "bg-paper border-line text-ink-soft hover:bg-surface"
            : "bg-paper border-line text-ink-mute opacity-50 pointer-events-none cursor-not-allowed"
        )}
      >
        <FileText size={13} />
        전사 (.txt)
        <Download size={11} className="opacity-60" />
      </a>

      {/* 다른 포맷 — 드롭다운 */}
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          disabled={!hasTranscript}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] border",
            hasTranscript
              ? "bg-paper border-line text-ink-soft hover:bg-surface"
              : "bg-paper border-line text-ink-mute opacity-50 cursor-not-allowed"
          )}
        >
          다른 포맷
          <ChevronDown
            size={12}
            className={cn(
              "transition-transform",
              menuOpen ? "rotate-180" : ""
            )}
          />
        </button>

        {menuOpen && hasTranscript && (
          <div className="absolute right-0 top-full mt-1 w-48 rounded-xl bg-paper border border-line shadow-lg overflow-hidden z-20">
            {(["csv", "json", "srt", "vtt"] as ExportFormat[]).map((f) => (
              <a
                key={f}
                href={exportUrl(f)}
                download
                onClick={() => setMenuOpen(false)}
                className="flex items-center gap-2 px-3 py-2 text-[12px] text-ink-soft hover:bg-surface"
              >
                <Download size={11} className="opacity-60" />
                {FORMAT_LABEL[f]}
              </a>
            ))}
            {mask && (
              <div className="px-3 py-2 text-[10px] text-gold border-t border-line bg-gold/5">
                마스킹된 결과로 다운로드됩니다.
              </div>
            )}
          </div>
        )}
      </div>

      {/* 클립보드 복사 */}
      <button
        onClick={copyTranscript}
        disabled={!hasTranscript}
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-paper border border-line text-[12px] text-ink-soft hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {copied ? (
          <>
            <Check size={13} className="text-olive" /> 복사됨
          </>
        ) : (
          <>
            <Copy size={13} /> 전사 복사
          </>
        )}
      </button>
    </div>
  );
}
