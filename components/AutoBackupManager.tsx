"use client";

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Clock3,
  FileAudio,
  FolderOpen,
  Loader2,
  RefreshCcw,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  XCircle,
} from "lucide-react";
import { registerDirectUploadedRecording, uploadRecording } from "@/app/(app)/upload/actions";
import { createSupabaseBrowserClient, isUsingSupabase } from "@/lib/supabase/client";
import { ACCEPTED_EXTENSIONS, formatBytes, sanitizeFilename, STORAGE_BUCKET, validateAudioFile } from "@/lib/upload";
import { cn } from "@/lib/cn";

const DB_NAME = "jamsa-auto-backup";
const STORE_NAME = "handles";
const HANDLE_KEY = "recordings-directory";
const STATE_KEY = "jamsa-auto-backup-state-v4";
const MAX_PARALLEL_UPLOADS = 1;
const MAX_SCAN_FILES = 100_000;
const MAX_SCAN_DIRS = 80;
const SCAN_TIMEOUT_MS = 60_000;
const ACCEPT = "audio/*,.mp3,.m4a,.wav,.webm,.aac,.ogg,.oga,.3gp,.amr";

type BackupStatus = "unsupported" | "idle" | "ready" | "scanning" | "uploading" | "done" | "error";
type JobStatus = "queued" | "uploading" | "converting" | "uploaded" | "skipped" | "failed";

interface PersistedJob {
  fingerprint: string;
  name: string;
  size: number;
  modified: number;
  status: JobStatus;
  message: string;
  updatedAt: number;
}

interface BackupState {
  jobs: Record<string, PersistedJob>;
}

interface AudioEntry {
  file: File;
  relativePath: string;
  fingerprint: string;
}

interface ScanContext {
  startedAt: number;
  dirs: number;
  files: number;
}

const EMPTY_STATE: BackupState = { jobs: {} };

export default function AutoBackupManager() {
  const [status, setStatus] = useState<BackupStatus>("idle");
  const [message, setMessage] = useState("녹음 폴더를 한 번 허용하면 다음 접속부터 새 파일만 이어서 백업합니다.");
  const [state, setState] = useState<BackupState>(EMPTY_STATE);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [hasSavedFolder, setHasSavedFolder] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const runningRef = useRef(false);

  const supported = useMemo(
    () => typeof window !== "undefined" && "showDirectoryPicker" in window && "indexedDB" in window,
    []
  );

  useEffect(() => {
    setState(loadState());
    if (!supported) return;

    void getSavedDirectoryHandle()
      .then((handle) => setHasSavedFolder(Boolean(handle)))
      .catch(() => setHasSavedFolder(false));
  }, [supported]);

  useEffect(() => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.setAttribute("directory", "");
  }, []);

  const stats = useMemo(() => {
    const jobs = Object.values(state.jobs);
    return {
      total: jobs.length,
      queued: jobs.filter((job) => job.status === "queued").length,
      uploading: jobs.filter((job) => job.status === "uploading").length,
      converting: jobs.filter((job) => job.status === "converting").length,
      uploaded: jobs.filter((job) => job.status === "uploaded").length,
      skipped: jobs.filter((job) => job.status === "skipped").length,
      failed: jobs.filter((job) => job.status === "failed").length,
    };
  }, [state]);

  const activeTotal = stats.queued + stats.uploading + stats.converting + stats.uploaded + stats.failed;
  const activeDone = stats.uploaded + stats.failed;
  const percent = activeTotal > 0 ? Math.round((activeDone / activeTotal) * 100) : 0;
  const detachedQueueCount = stats.queued + stats.uploading + stats.converting + stats.failed;
  const needsFileReselect = detachedQueueCount > 0 && !busy && !hasSavedFolder;

  const patchJobs = useCallback((patch: Record<string, PersistedJob>) => {
    setState((prev) => {
      const next = { jobs: { ...prev.jobs, ...patch } };
      saveState(next);
      return next;
    });
  }, []);

  const processEntries = useCallback(
    async (entries: AudioEntry[], sourceLabel: string) => {
      const latestState = loadState();
      const discovered: Record<string, PersistedJob> = {};

      for (const entry of entries) {
        const previous = latestState.jobs[entry.fingerprint];
        if (previous?.status === "uploaded" || previous?.status === "skipped") continue;

        discovered[entry.fingerprint] = {
          fingerprint: entry.fingerprint,
          name: entry.relativePath,
          size: entry.file.size,
          modified: entry.file.lastModified,
          status: "queued",
          message: previous ? "이전 미완료 파일 다시 대기" : "업로드 대기",
          updatedAt: Date.now(),
        };
      }

      if (Object.keys(discovered).length > 0) patchJobs(discovered);

      const allJobs = { ...latestState.jobs, ...discovered };
      const runnable = entries
        .filter((entry) => {
          const job = allJobs[entry.fingerprint];
          return job && (job.status === "queued" || job.status === "failed" || job.status === "uploading");
        });

      if (entries.length === 0) {
        setStatus("done");
        setMessage(`${sourceLabel}에서 지원되는 오디오 파일을 찾지 못했습니다. 실제 녹음 파일이 있는 폴더나 파일을 다시 선택해 주세요.`);
        return;
      }

      if (runnable.length === 0) {
        setStatus("done");
        setMessage(`${sourceLabel} 확인 완료: 새로 백업할 파일이 없습니다. 이미 완료된 파일은 다시 올리지 않습니다.`);
        return;
      }

      setStatus("uploading");
      setMessage(`${runnable.length}개 파일을 중단 없이 끝까지 백업합니다. 각 파일은 백업 완료 즉시 통화변환을 시작하고, 백업 큐는 다음 파일을 계속 처리합니다.`);
      await uploadEntries(runnable, patchJobs, setCurrentFile, MAX_PARALLEL_UPLOADS);

      const remaining = countRemaining();
      setStatus("done");
      setCurrentFile(null);
      setMessage(
        remaining > 0
          ? `처리가 잠시 멈췄습니다. 남은 파일 ${remaining}개는 이어서 백업 버튼을 누르면 완료된 파일을 제외하고 계속 처리됩니다.`
          : "자동 백업이 완료되었습니다. 완료 파일은 보존되고 다음부터 새 파일만 처리합니다."
      );
    },
    [patchJobs]
  );

  const scanSavedFolder = useCallback(
    async (silent = false) => {
      if (!supported) {
        setStatus("unsupported");
        setMessage("현재 브라우저는 폴더 자동 접근을 지원하지 않습니다. 아래 파일 선택 백업을 사용하거나 Android 동반 앱이 필요합니다.");
        return;
      }
      if (runningRef.current) return;

      runningRef.current = true;
      setBusy(true);
      setCurrentFile(null);

      try {
        const handle = await withTimeout(getSavedDirectoryHandle(), 5000, "저장된 폴더 정보를 불러오지 못했습니다.");
        if (!handle) {
          setHasSavedFolder(false);
          setStatus("idle");
          if (!silent) {
            setMessage(
              "이전 대기열은 남아 있지만 브라우저가 실제 파일 접근 권한을 잃었습니다. 같은 폴더를 다시 선택하면 완료 파일은 건너뛰고 남은 파일만 이어서 백업합니다."
            );
          }
          return;
        }
        setHasSavedFolder(true);

        const permission = await withTimeout(
          ensurePermission(handle),
          8000,
          "폴더 권한 확인이 지연되고 있습니다. 권한을 다시 설정하거나 파일로 바로 백업해 주세요."
        );
        if (!permission) {
          setHasSavedFolder(false);
          setStatus("idle");
          setMessage("저장된 폴더 권한이 만료되었습니다. 다시 권한을 허용해 주세요.");
          return;
        }

        setStatus("scanning");
        setMessage("녹음 폴더를 스캔하고 있습니다. 너무 큰 상위 폴더를 선택했다면 실제 녹음 폴더만 다시 지정해 주세요.");

        const entries = await withTimeout(
          collectAudioFiles(handle, "", { startedAt: Date.now(), dirs: 0, files: 0 }),
          SCAN_TIMEOUT_MS,
          "폴더 스캔이 60초를 넘었습니다. 실제 녹음 파일이 들어있는 하위 폴더만 선택해 주세요."
        );

        await processEntries(entries, "녹음 폴더");
      } catch (error) {
        setStatus("error");
        setCurrentFile(null);
        setMessage(error instanceof Error ? error.message : "자동 백업 중 오류가 발생했습니다.");
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [processEntries, supported]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void scanSavedFolder(true);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [scanSavedFolder]);

  const chooseFolder = async () => {
    if (!supported || busy) return;
    setBusy(true);

    try {
      const picker = (window as any).showDirectoryPicker as (options?: unknown) => Promise<any>;
      const handle = await withTimeout(
        picker({ id: "jamsa-recordings", mode: "read", startIn: "music" }),
        30_000,
        "폴더 선택 시간이 초과되었습니다. 브라우저가 멈춘 경우 파일로 바로 백업을 사용해 주세요."
      );
      const permission = await ensurePermission(handle);
      if (!permission) {
        setStatus("idle");
        setMessage("폴더 읽기 권한이 필요합니다.");
        return;
      }

      await saveDirectoryHandle(handle);
      setHasSavedFolder(true);
      setStatus("ready");
      setMessage("녹음 폴더 권한이 저장되었습니다. 지금부터 자동 백업을 시작합니다.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "폴더 선택을 취소했습니다.");
      return;
    } finally {
      setBusy(false);
    }

    await scanSavedFolder(false);
  };

  const chooseFiles = () => {
    if (busy) return;
    fileInputRef.current?.click();
  };

  const chooseFolderFiles = () => {
    if (busy) return;
    folderInputRef.current?.click();
  };

  const handleFileFallback = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || runningRef.current) return;

    runningRef.current = true;
    setBusy(true);
    setCurrentFile(null);
    setStatus("scanning");
    setMessage(`${files.length}개 파일을 확인하고 있습니다.`);

    try {
      const entries = files
        .map((file) => {
          const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
          return {
            file,
            relativePath,
            fingerprint: makeFingerprint(file, relativePath),
          };
        })
        .sort((a, b) => a.relativePath.localeCompare(b.relativePath, "ko-KR", { numeric: true }));
      const sourceLabel = entries.some((entry) => entry.relativePath.includes("/")) ? "선택한 폴더" : "선택한 파일";
      await processEntries(entries, sourceLabel);
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "파일 백업 중 오류가 발생했습니다.");
    } finally {
      runningRef.current = false;
      setBusy(false);
    }
  };

  const clearSetup = async () => {
    if (busy) return;
    setBusy(true);

    try {
      if (supported) await deleteSavedDirectoryHandle();
      localStorage.removeItem(STATE_KEY);
      setState(EMPTY_STATE);
      setHasSavedFolder(false);
      setCurrentFile(null);
      setStatus("idle");
      setMessage("자동 백업 설정과 작업 이력을 초기화했습니다.");
    } finally {
      setBusy(false);
    }
  };

  const recentJobs = Object.values(state.jobs)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 18);

  return (
    <section className="rounded-2xl bg-paper border border-line overflow-hidden">
      <div className="p-5 border-b border-line flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center">
            <Smartphone size={19} />
          </div>
          <div>
            <h2 className="font-display text-[18px] font-bold">접속 시 자동 백업</h2>
            <p className="text-[12px] text-ink-mute mt-1">
              중간에 앱이 꺼져도 작업 이력을 보관하고, 다음 접속 때 안 된 파일만 이어서 처리합니다.
            </p>
          </div>
        </div>
        <StatusBadge status={status} busy={busy} />
      </div>

      <div className="p-5 space-y-4">
        <input ref={fileInputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={handleFileFallback} />
        <input ref={folderInputRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={handleFileFallback} />

        <div className="rounded-xl bg-surface/60 border border-line-soft p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck size={17} className="text-olive mt-0.5 shrink-0" />
            <div className="text-[13px] leading-6 text-ink-soft flex-1">
              {message}
              {currentFile && <div className="mt-1 text-[11px] text-ink-mute truncate">현재 처리: {currentFile}</div>}
              {needsFileReselect && (
                <div className="mt-3 rounded-lg border border-gold/30 bg-gold/10 px-3 py-2 text-[12px] leading-5 text-ink-soft">
                  대기 중인 파일 {detachedQueueCount}개가 있지만 브라우저가 예전 파일 내용을 다시 읽을 수 없습니다.
                  아래 <b>같은 폴더 다시 선택</b>을 눌러 이전과 같은 녹음 폴더를 선택하면 완료된 파일은 유지하고 남은 파일만 계속 처리합니다.
                </div>
              )}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3 text-[11px] text-ink-mute mb-1">
              <span>진행률 {percent}%</span>
              <span className="text-right">
                완료 {stats.uploaded} · 대기 {stats.queued} · 업로드 {stats.uploading} · 변환중 {stats.converting} · 실패 {stats.failed} · 건너뜀 {stats.skipped}
              </span>
            </div>
            <div className="h-3 rounded-full bg-line-soft overflow-hidden flex">
              <div className="h-full bg-olive transition-all" style={{ width: `${activeTotal ? (stats.uploaded / activeTotal) * 100 : 0}%` }} />
              <div className="h-full bg-accent/70 transition-all" style={{ width: `${activeTotal ? (stats.failed / activeTotal) * 100 : 0}%` }} />
              <div className="h-full bg-sky/70 transition-all" style={{ width: `${activeTotal ? (stats.converting / activeTotal) * 100 : 0}%` }} />
              <div className="h-full bg-gold/70 transition-all" style={{ width: `${activeTotal ? (stats.uploading / activeTotal) * 100 : 0}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mt-4">
            <Stat label="총 파일" value={stats.total} />
            <Stat label="업로드" value={stats.uploaded} />
            <Stat label="변환중" value={stats.converting} />
            <Stat label="대기" value={stats.queued} />
            <Stat label="실패" value={stats.failed} />
            <Stat label="건너뜀" value={stats.skipped} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={chooseFolder}
            disabled={busy || !supported}
            className="px-4 py-2.5 rounded-xl bg-ink text-cream text-[13px] font-bold flex items-center gap-2 disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            녹음 폴더 권한 설정
          </button>
          <button
            onClick={() => void scanSavedFolder(false)}
            disabled={busy || !supported}
            className="px-4 py-2.5 rounded-xl bg-paper border border-line text-[13px] font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCcw size={14} />
            안 된 파일 이어서 백업
          </button>
          {needsFileReselect && (
            <button
              onClick={chooseFolderFiles}
              disabled={busy}
              className="px-4 py-2.5 rounded-xl bg-gold/20 border border-gold text-[13px] font-bold flex items-center gap-2 disabled:opacity-50"
            >
              <FolderOpen size={14} />
              같은 폴더 다시 선택
            </button>
          )}
          <button
            onClick={chooseFiles}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl bg-paper border border-line text-[13px] font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <FileAudio size={14} />
            파일로 바로 백업
          </button>
          <button
            onClick={chooseFolderFiles}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl bg-paper border border-line text-[13px] font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <FolderOpen size={14} />
            한 폴더 순차 백업
          </button>
          <button
            onClick={clearSetup}
            disabled={busy}
            className="px-4 py-2.5 rounded-xl bg-paper border border-line text-[13px] text-ink-mute disabled:opacity-50"
          >
            설정 초기화
          </button>
        </div>

        <div className="text-[11px] text-ink-mute leading-5">
          폴더 스캔은 60초가 지나면 자동 중단됩니다. 계속 멈추면 `Recordings`, `Call`, `Voice Recorder` 같은 실제 녹음 폴더만 선택하거나
          파일로 바로 백업을 눌러 여러 녹음 파일을 선택해 주세요. 선택한 파일은 끝까지 순차 처리하고, 동시에 {MAX_PARALLEL_UPLOADS}개씩 업로드합니다.
        </div>

        {recentJobs.length > 0 && (
          <div className="rounded-xl border border-line overflow-hidden">
            <div className="px-4 py-2.5 bg-cream/60 text-[12px] font-semibold">파일별 처리 과정</div>
            <div className="divide-y divide-line-soft max-h-80 overflow-auto scroll-thin">
              {recentJobs.map((job) => (
                <JobRow key={job.fingerprint} job={job} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-paper border border-line-soft px-3 py-2">
      <div className="text-[10px] text-ink-mute">{label}</div>
      <div className="text-[18px] font-bold num">{value}</div>
    </div>
  );
}

function JobRow({ job }: { job: PersistedJob }) {
  const icon =
    job.status === "uploaded" ? (
      <CheckCircle2 size={14} className="text-olive" />
    ) : job.status === "failed" ? (
      <XCircle size={14} className="text-accent" />
    ) : job.status === "uploading" || job.status === "converting" ? (
      <UploadCloud size={14} className="text-gold" />
    ) : (
      <Clock3 size={14} className="text-ink-mute" />
    );

  return (
    <div className="px-4 py-3 flex items-start gap-2">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium truncate">{job.name}</div>
        <div className="text-[11px] text-ink-mute flex flex-wrap gap-x-2 gap-y-0.5">
          <span>{statusLabel(job.status)}</span>
          <span>{formatBytes(job.size)}</span>
          <span>{job.message}</span>
        </div>
      </div>
    </div>
  );
}

function statusLabel(status: JobStatus) {
  const map: Record<JobStatus, string> = {
    queued: "대기",
    uploading: "업로드중",
    uploaded: "완료",
    converting: "변환중",
    skipped: "건너뜀",
    failed: "실패",
  };
  return map[status];
}

function StatusBadge({ status, busy }: { status: BackupStatus; busy: boolean }) {
  const label = busy
    ? "작동 중"
    : status === "done"
      ? "완료"
      : status === "ready"
        ? "자동"
        : status === "unsupported"
          ? "미지원"
          : status === "error"
            ? "오류"
            : "대기";

  return (
    <span
      className={cn(
        "px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0",
        status === "done" || status === "ready" || busy
          ? "bg-olive/15 text-olive"
          : status === "error" || status === "unsupported"
            ? "bg-accent/15 text-accent"
            : "bg-gold/15 text-gold"
      )}
    >
      {label}
    </span>
  );
}

async function uploadEntries(
  entries: AudioEntry[],
  patchJobs: (patch: Record<string, PersistedJob>) => void,
  setCurrentFile: (name: string | null) => void,
  concurrency: number
) {
  await runPool(entries, concurrency, async (entry) => {
    setCurrentFile(entry.relativePath);
    patchJobs({ [entry.fingerprint]: makeJob(entry, "uploading", "서버로 업로드 중") });

    const validation = validateAudioFile({ name: entry.file.name, size: entry.file.size, type: entry.file.type });
    if (!validation.valid) {
      patchJobs({ [entry.fingerprint]: makeJob(entry, "failed", validation.reason) });
      return;
    }

    const formData = new FormData();
    formData.append("source", "phone_backup");
    formData.append("title", entry.file.name.replace(/\.[^.]+$/, ""));
    formData.append("relativePath", entry.relativePath);

    try {
      const result = isUsingSupabase()
        ? await uploadLargeFileDirectly(entry, formData)
        : await uploadSmallFileThroughServer(entry, formData);
      if (!result.ok) {
        patchJobs({ [entry.fingerprint]: makeJob(entry, "failed", result.error) });
        return;
      }
      if (result.mock) {
        patchJobs({ [entry.fingerprint]: makeJob(entry, "uploaded", "백업 완료 · 테스트 모드") });
        return;
      }

      patchJobs({ [entry.fingerprint]: makeJob(entry, "converting", "백업 완료 · 통화변환 시작") });
      void processRecordingImmediately(result.id).then((stt) => {
        patchJobs({
          [entry.fingerprint]: makeJob(
            entry,
            stt.ok ? "uploaded" : "failed",
            stt.ok ? "백업 완료 · 통화변환 완료" : stt.error
          ),
        });
      });
    } catch (error) {
      patchJobs({
        [entry.fingerprint]: makeJob(entry, "failed", error instanceof Error ? error.message : "업로드 실패"),
      });
    }
  });
}

async function uploadSmallFileThroughServer(entry: AudioEntry, formData: FormData) {
  formData.append("file", entry.file);
  return uploadRecording(formData);
}

async function uploadLargeFileDirectly(entry: AudioEntry, metadata: FormData) {
  const supabase = createSupabaseBrowserClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { ok: false as const, error: "로그인이 필요합니다.", code: "unauthenticated" as const };
  }

  const safeName = sanitizeFilename(entry.file.name, 90);
  const storagePath = `${user.id}/${Date.now()}_${safeName}`;
  const contentType = entry.file.type || `audio/${entry.file.name.split(".").pop() ?? "mpeg"}`;
  const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(storagePath, entry.file, {
    contentType,
    upsert: false,
    cacheControl: "3600",
  });

  if (uploadError) {
    return { ok: false as const, error: `Storage 직접 업로드 실패: ${uploadError.message}`, code: "storage_error" as const };
  }

  metadata.append("path", storagePath);
  metadata.append("originalName", entry.file.name);
  metadata.append("contentType", contentType);
  metadata.append("size", String(entry.file.size));
  return registerDirectUploadedRecording(metadata);
}

async function processRecordingImmediately(recordingId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/jobs/process-recording", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recordingId }),
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || data.ok === false) {
      return { ok: false, error: data.error ?? "네이버 클로바 텍스트 추출 실패" };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "네이버 클로바 텍스트 추출 실패" };
  }
}

function makeJob(entry: AudioEntry, status: JobStatus, message: string): PersistedJob {
  return {
    fingerprint: entry.fingerprint,
    name: entry.relativePath,
    size: entry.file.size,
    modified: entry.file.lastModified,
    status,
    message,
    updatedAt: Date.now(),
  };
}

function countRemaining() {
  const jobs = Object.values(loadState().jobs);
  return jobs.filter(
    (job) => job.status === "queued" || job.status === "uploading" || job.status === "converting" || job.status === "failed"
  ).length;
}

async function collectAudioFiles(handle: any, prefix: string, ctx: ScanContext): Promise<AudioEntry[]> {
  if (Date.now() - ctx.startedAt > SCAN_TIMEOUT_MS) {
    throw new Error("폴더 스캔 시간이 초과되었습니다. 녹음 파일이 들어있는 하위 폴더만 선택해 주세요.");
  }
  if (ctx.dirs > MAX_SCAN_DIRS || ctx.files > MAX_SCAN_FILES) {
    return [];
  }

  const files: AudioEntry[] = [];
  ctx.dirs += 1;

  for await (const [name, child] of handle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (child.kind === "directory") {
      if (prefix && !shouldScanDirectory(name)) continue;
      files.push(...(await collectAudioFiles(child, path, ctx)));
      continue;
    }

    const ext = name.toLowerCase().split(".").pop() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(ext as any)) continue;
    const file = await child.getFile();
    ctx.files += 1;
    files.push({
      file,
      relativePath: path,
      fingerprint: makeFingerprint(file, path),
    });
    if (ctx.files >= MAX_SCAN_FILES) break;
  }

  return files.sort((a, b) => b.file.lastModified - a.file.lastModified);
}

function makeFingerprint(file: File, path: string) {
  return `${path}|${file.name}|${file.size}|${file.lastModified}`;
}

function shouldScanDirectory(name: string) {
  const lower = name.toLowerCase();
  return ["record", "recording", "voice", "call", "audio", "sound", "music", "녹음", "통화"].some((token) =>
    lower.includes(token)
  );
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      if (item) await worker(item);
    }
  });
  await Promise.all(runners);
}

async function ensurePermission(handle: any) {
  const options = { mode: "read" };
  if ((await handle.queryPermission(options)) === "granted") return true;
  return (await handle.requestPermission(options)) === "granted";
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function loadState(): BackupState {
  try {
    const parsed = JSON.parse(localStorage.getItem(STATE_KEY) ?? "") as BackupState;
    if (parsed && typeof parsed.jobs === "object") return parsed;
  } catch {
    return EMPTY_STATE;
  }
  return EMPTY_STATE;
}

function saveState(state: BackupState) {
  const jobs = Object.values(state.jobs)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10000);
  localStorage.setItem(STATE_KEY, JSON.stringify({ jobs: Object.fromEntries(jobs.map((job) => [job.fingerprint, job])) }));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveDirectoryHandle(handle: any) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getSavedDirectoryHandle(): Promise<any | null> {
  const db = await openDb();
  const result = await new Promise<any | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(HANDLE_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return result;
}

async function deleteSavedDirectoryHandle() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}
