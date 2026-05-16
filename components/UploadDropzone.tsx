"use client";

import { useState, useRef, useTransition, type DragEvent, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Upload,
  FileAudio,
  X,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Play,
  ExternalLink,
} from "lucide-react";
import {
  validateAudioFile,
  formatBytes,
  getExtension,
  ACCEPTED_EXTENSIONS,
  MAX_FILE_SIZE,
} from "@/lib/upload";
import { uploadRecording } from "@/app/(app)/upload/actions";
import { cn } from "@/lib/cn";

// ─────────────────────────────────────────────────────────
// 항목 상태 머신
// ─────────────────────────────────────────────────────────

type ItemStatus =
  | { kind: "invalid"; reason: string }
  | { kind: "ready" }
  | { kind: "uploading" }
  | { kind: "success"; recordingId: string; mock?: boolean }
  | { kind: "error"; reason: string; code?: string };

interface UploadItem {
  id: string;
  file: File;
  status: ItemStatus;
}

// ─────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────

export default function UploadDropzone({
  defaultSource = "upload",
  autoTitleFromFilename = false,
}: {
  defaultSource?: "upload" | "mobile_recording" | "web_recording" | "phone_backup";
  autoTitleFromFilename?: boolean;
}) {
  const router = useRouter();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [isUploading, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // ─── 파일 추가 ─────────────────────────────────────────
  const addFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const next: UploadItem[] = Array.from(files).map((file) => {
      const v = validateAudioFile({
        name: file.name,
        size: file.size,
        type: file.type,
      });
      return {
        id: `${Date.now()}_${file.name}_${Math.random().toString(36).slice(2, 6)}`,
        file,
        status: v.valid
          ? { kind: "ready" }
          : { kind: "invalid", reason: v.reason },
      };
    });
    setItems((prev) => [...prev, ...next]);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (isUploading) return;
    addFiles(e.dataTransfer.files);
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    addFiles(e.target.files);
    e.target.value = "";
  };

  const updateItem = (id: string, status: ItemStatus) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, status } : i))
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  // ─── 업로드 실행 ───────────────────────────────────────
  const handleUpload = () => {
    startTransition(async () => {
      let firstSuccessId: string | null = null;

      // 'ready' 항목만 순차 처리
      const readyItems = items.filter((i) => i.status.kind === "ready");

      for (const item of readyItems) {
        updateItem(item.id, { kind: "uploading" });

        const fd = new FormData();
        fd.append("file", item.file);
        fd.append("source", defaultSource);
        if (autoTitleFromFilename) {
          fd.append("title", item.file.name.replace(/\.[^.]+$/, ""));
        }

        try {
          const result = await uploadRecording(fd);
          if (result.ok) {
            updateItem(item.id, {
              kind: "success",
              recordingId: result.id,
              mock: result.mock,
            });
            if (!firstSuccessId) firstSuccessId = result.id;
          } else {
            updateItem(item.id, {
              kind: "error",
              reason: result.error,
              code: result.code,
            });
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "네트워크 오류";
          updateItem(item.id, { kind: "error", reason: msg });
        }
      }

      // 첫 성공 항목으로 이동 (잠시 성공 표시 후)
      if (firstSuccessId) {
        setTimeout(() => {
          router.push(`/recordings/${firstSuccessId}`);
        }, 700);
      }
    });
  };

  // ─── 카운트 ───────────────────────────────────────────
  const readyCount = items.filter((i) => i.status.kind === "ready").length;
  const invalidCount = items.filter((i) => i.status.kind === "invalid").length;
  const errorCount = items.filter((i) => i.status.kind === "error").length;
  const successCount = items.filter((i) => i.status.kind === "success").length;
  const canUpload = readyCount > 0 && !isUploading;

  return (
    <div>
      {/* ───── 드롭존 ───── */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault();
          if (!isUploading) setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => !isUploading && inputRef.current?.click()}
        className={cn(
          "rounded-2xl border-2 border-dashed p-10 text-center transition-all",
          isUploading
            ? "cursor-not-allowed border-line bg-paper opacity-60"
            : "cursor-pointer",
          !isUploading && dragOver
            ? "border-accent bg-accent/5"
            : !isUploading && "border-line bg-paper hover:bg-surface/50"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXTENSIONS.map((e) => `.${e}`).join(",") + ",audio/*"}
          multiple
          onChange={handleChange}
          disabled={isUploading}
          className="hidden"
        />
        <div className="w-14 h-14 rounded-full bg-surface flex items-center justify-center mx-auto mb-3">
          <Upload size={22} className="text-accent" />
        </div>
        <div className="font-display text-[18px] font-bold mb-1">
          오디오 파일을 끌어다 놓으세요
        </div>
        <div className="text-[12px] text-ink-mute">
          {ACCEPTED_EXTENSIONS.map((e) => e.toUpperCase()).join(" · ")} · 최대{" "}
          {formatBytes(MAX_FILE_SIZE)} · 다중 업로드 지원
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          disabled={isUploading}
          className="mt-4 px-4 py-2 rounded-lg bg-ink text-cream text-[12px] font-semibold disabled:opacity-50"
        >
          파일 선택
        </button>
      </div>

      {/* ───── 큐 ───── */}
      {items.length > 0 && (
        <div className="mt-4 rounded-2xl bg-paper border border-line overflow-hidden">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="text-[12px] font-semibold">
                업로드 대기열 · {items.length}개
              </div>
              {readyCount > 0 && (
                <Pill color="olive">준비 {readyCount}</Pill>
              )}
              {invalidCount > 0 && (
                <Pill color="accent">검증실패 {invalidCount}</Pill>
              )}
              {successCount > 0 && (
                <Pill color="olive">성공 {successCount}</Pill>
              )}
              {errorCount > 0 && (
                <Pill color="accent">실패 {errorCount}</Pill>
              )}
            </div>
            <button
              onClick={() => setItems([])}
              disabled={isUploading}
              className="text-[11px] text-ink-mute hover:text-ink disabled:opacity-50"
            >
              모두 지우기
            </button>
          </div>

          <div className="divide-y divide-line-soft">
            {items.map((i) => (
              <UploadItemRow
                key={i.id}
                item={i}
                onRemove={() => removeItem(i.id)}
                disabled={isUploading || i.status.kind === "uploading"}
              />
            ))}
          </div>

          <div className="px-4 py-3 border-t border-line flex items-center justify-between gap-3 flex-wrap">
            <div className="text-[11px] text-ink-mute">
              {isUploading
                ? "업로드 중입니다… 페이지를 닫지 마세요."
                : successCount > 0 && readyCount === 0
                ? "업로드 완료. 곧 통화 상세 페이지로 이동합니다."
                : "업로드 시작 시 STT 분석 큐에 자동 등록됩니다."}
            </div>
            <button
              onClick={handleUpload}
              disabled={!canUpload}
              className="px-5 py-2.5 rounded-lg bg-accent text-cream font-bold text-[13px] flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isUploading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  업로드 중
                </>
              ) : (
                <>
                  <Play size={13} />
                  업로드 시작 ({readyCount})
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 항목 행 (메타데이터 + 상태)
// ─────────────────────────────────────────────────────────

function UploadItemRow({
  item: i,
  onRemove,
  disabled,
}: {
  item: UploadItem;
  onRemove: () => void;
  disabled: boolean;
}) {
  const ext = getExtension(i.file.name);
  const mime = i.file.type || `audio/${ext}`;

  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <div className="w-9 h-9 rounded-lg bg-surface flex items-center justify-center shrink-0 mt-0.5">
        <FileAudio size={15} className="text-ink-soft" />
      </div>

      <div className="flex-1 min-w-0">
        {/* 파일명 */}
        <div className="text-[12px] font-medium truncate">{i.file.name}</div>

        {/* 메타데이터: 크기 · MIME · 확장자 */}
        <div className="text-[10px] num text-ink-mute mt-0.5 flex items-center gap-1.5 flex-wrap">
          <span className="font-medium">{formatBytes(i.file.size)}</span>
          <span className="text-line">·</span>
          <span className="px-1.5 py-px rounded bg-line-soft text-ink-soft">
            {mime}
          </span>
          <span className="text-line">·</span>
          <span>.{ext}</span>
        </div>

        {/* 상태 */}
        <ItemStatusLine status={i.status} />
      </div>

      <button
        onClick={onRemove}
        disabled={disabled}
        className="w-7 h-7 rounded-lg hover:bg-surface flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        title="제거"
      >
        <X size={13} className="text-ink-mute" />
      </button>
    </div>
  );
}

function ItemStatusLine({ status }: { status: ItemStatus }) {
  switch (status.kind) {
    case "invalid":
      return (
        <div className="mt-1.5 text-[11px] text-accent flex items-start gap-1">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          <span>{status.reason}</span>
        </div>
      );
    case "ready":
      return (
        <div className="mt-1.5 text-[11px] text-ink-mute flex items-center gap-1">
          <CheckCircle2 size={11} className="text-olive" />
          업로드 준비됨
        </div>
      );
    case "uploading":
      return (
        <div className="mt-1.5 text-[11px] text-sky flex items-center gap-1">
          <Loader2 size={11} className="animate-spin" />
          Storage 업로드 중 → recordings 저장 → STT 큐 등록…
        </div>
      );
    case "success":
      return (
        <div className="mt-1.5 text-[11px] text-olive flex items-center gap-1.5 flex-wrap">
          <CheckCircle2 size={11} />
          업로드 완료 · STT 분석 대기 중
          {status.mock && (
            <span className="px-1.5 py-px rounded bg-gold/15 text-gold">
              mock
            </span>
          )}
          <a
            href={`/recordings/${status.recordingId}`}
            className="underline hover:no-underline flex items-center gap-0.5"
          >
            바로 보기 <ExternalLink size={9} />
          </a>
        </div>
      );
    case "error":
      return (
        <div className="mt-1.5 text-[11px] text-accent flex items-start gap-1">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          <span>
            <span className="font-semibold">실패: </span>
            {status.reason}
            {status.code && (
              <span className="ml-1 text-ink-mute">[{status.code}]</span>
            )}
          </span>
        </div>
      );
  }
}

// ─────────────────────────────────────────────────────────
// 작은 뱃지
// ─────────────────────────────────────────────────────────

function Pill({
  children,
  color,
}: {
  children: React.ReactNode;
  color: "olive" | "accent" | "gold" | "sky";
}) {
  const map = {
    olive: "bg-olive/15 text-olive",
    accent: "bg-accent/15 text-accent",
    gold: "bg-gold/15 text-gold",
    sky: "bg-sky/15 text-sky",
  };
  return (
    <span
      className={cn(
        "text-[10px] num px-1.5 py-0.5 rounded-full font-semibold",
        map[color]
      )}
    >
      {children}
    </span>
  );
}
