"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, FolderOpen, Loader2, RefreshCcw, ShieldCheck, Smartphone, XCircle, Clock3, UploadCloud } from "lucide-react";
import { uploadRecording } from "@/app/(app)/upload/actions";
import { ACCEPTED_EXTENSIONS, formatBytes, validateAudioFile } from "@/lib/upload";
import { cn } from "@/lib/cn";

const DB_NAME = "jamsa-auto-backup";
const STORE_NAME = "handles";
const HANDLE_KEY = "recordings-directory";
const STATE_KEY = "jamsa-auto-backup-state-v2";
const MAX_AUTO_UPLOAD_PER_RUN = 12;
const MAX_PARALLEL_UPLOADS = 3;

type BackupStatus = "unsupported" | "idle" | "ready" | "scanning" | "uploading" | "done" | "error";
type JobStatus = "queued" | "uploading" | "uploaded" | "skipped" | "failed";

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

const EMPTY_STATE: BackupState = { jobs: {} };

export default function AutoBackupManager() {
  const [status, setStatus] = useState<BackupStatus>("idle");
  const [message, setMessage] = useState("녹음 폴더를 한 번 지정하면 다음 접속부터 실패한 파일과 새 파일만 이어서 백업합니다.");
  const [state, setState] = useState<BackupState>(EMPTY_STATE);
  const [currentFile, setCurrentFile] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const runningRef = useRef(false);

  const supported = useMemo(
    () => typeof window !== "undefined" && "showDirectoryPicker" in window && "indexedDB" in window,
    []
  );

  useEffect(() => {
    setState(loadState());
  }, []);

  const stats = useMemo(() => {
    const jobs = Object.values(state.jobs);
    return {
      total: jobs.length,
      queued: jobs.filter((j) => j.status === "queued").length,
      uploading: jobs.filter((j) => j.status === "uploading").length,
      uploaded: jobs.filter((j) => j.status === "uploaded").length,
      skipped: jobs.filter((j) => j.status === "skipped").length,
      failed: jobs.filter((j) => j.status === "failed").length,
    };
  }, [state]);

  const activeTotal = stats.queued + stats.uploading + stats.uploaded + stats.failed;
  const activeDone = stats.uploaded + stats.failed;
  const percent = activeTotal > 0 ? Math.round((activeDone / activeTotal) * 100) : 0;

  const patchJobs = useCallback((patch: Record<string, PersistedJob>) => {
    setState((prev) => {
      const next = { jobs: { ...prev.jobs, ...patch } };
      saveState(next);
      return next;
    });
  }, []);

  const scanSavedFolder = useCallback(
    (silent = false) => {
      if (!supported) {
        setStatus("unsupported");
        setMessage("이 브라우저는 폴더 자동 접근을 지원하지 않습니다. Chrome/Edge 최신 버전 또는 Android 동반 앱이 필요합니다.");
        return;
      }
      if (runningRef.current) return;

      startTransition(async () => {
        runningRef.current = true;
        setCurrentFile(null);
        try {
          const handle = await getSavedDirectoryHandle();
          if (!handle) {
            setStatus("idle");
            if (!silent) setMessage("먼저 녹음 폴더 권한을 설정하세요.");
            return;
          }

          const permission = await ensurePermission(handle);
          if (!permission) {
            setStatus("idle");
            setMessage("저장된 폴더 권한이 만료되었습니다. 다시 권한을 허용해 주세요.");
            return;
          }

          setStatus("scanning");
          setMessage("녹음 폴더를 스캔하고, 기존 완료 파일은 보존한 채 새 파일과 실패 파일만 선별합니다.");
          const entries = await collectAudioFiles(handle);
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
              status: previous?.status === "failed" ? "queued" : previous?.status ?? "queued",
              message: previous?.status === "failed" ? "이전 실패 파일 재시도 대기" : previous?.message ?? "업로드 대기",
              updatedAt: Date.now(),
            };
          }

          if (Object.keys(discovered).length > 0) patchJobs(discovered);

          const runnable = entries
            .filter((entry) => {
              const job = { ...latestState.jobs, ...discovered }[entry.fingerprint];
              return job && (job.status === "queued" || job.status === "failed" || job.status === "uploading");
            })
            .slice(0, MAX_AUTO_UPLOAD_PER_RUN);

          if (runnable.length === 0) {
            setStatus("done");
            setMessage("백업할 새 파일이나 실패 파일이 없습니다. 기존 백업 상태는 그대로 보관됩니다.");
            return;
          }

          setStatus("uploading");
          setMessage(`${runnable.length}개 파일을 이어서 백업합니다. 완료된 파일은 다시 올리지 않습니다.`);
          await uploadEntries(runnable, patchJobs, setCurrentFile);

          const remaining = countRemaining();
          setStatus("done");
          setCurrentFile(null);
          setMessage(
            remaining > 0
              ? `이번 묶음 처리가 끝났습니다. 남은 파일 ${remaining}개는 다음 접속 또는 지금 백업 실행 때 이어서 처리합니다.`
              : "자동 백업이 완료되었습니다. 완료 파일은 보관되고 다음부터 새 파일만 처리합니다."
          );
        } catch (error) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "자동 백업 중 오류가 발생했습니다.");
        } finally {
          runningRef.current = false;
        }
      });
    },
    [patchJobs, supported]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => scanSavedFolder(true), 400);
    return () => window.clearTimeout(timer);
  }, [scanSavedFolder]);

  const chooseFolder = () => {
    startTransition(async () => {
      try {
        if (!supported) {
          setStatus("unsupported");
          return;
        }
        const picker = (window as any).showDirectoryPicker as (options?: unknown) => Promise<any>;
        const handle = await picker({ id: "jamsa-recordings", mode: "read", startIn: "music" });
        const permission = await ensurePermission(handle);
        if (!permission) {
          setStatus("idle");
          setMessage("폴더 읽기 권한이 필요합니다.");
          return;
        }
        await saveDirectoryHandle(handle);
        setStatus("ready");
        setMessage("녹음 폴더 권한이 저장되었습니다. 다음부터 앱 접속 시 자동 백업이 이어집니다.");
        scanSavedFolder(false);
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "폴더 선택이 취소되었습니다.");
      }
    });
  };

  const clearSetup = () => {
    startTransition(async () => {
      await deleteSavedDirectoryHandle();
      localStorage.removeItem(STATE_KEY);
      setState(EMPTY_STATE);
      setCurrentFile(null);
      setStatus("idle");
      setMessage("자동 백업 설정과 작업 이력을 초기화했습니다.");
    });
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
        <StatusBadge status={status} busy={isPending || runningRef.current} />
      </div>

      <div className="p-5 space-y-4">
        <div className="rounded-xl bg-surface/60 border border-line-soft p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck size={17} className="text-olive mt-0.5 shrink-0" />
            <div className="text-[13px] leading-6 text-ink-soft flex-1">
              {message}
              {currentFile && <div className="mt-1 text-[11px] text-ink-mute truncate">현재 처리: {currentFile}</div>}
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-ink-mute mb-1">
              <span>진행률 {percent}%</span>
              <span>
                완료 {stats.uploaded} · 대기 {stats.queued} · 처리중 {stats.uploading} · 실패 {stats.failed} · 건너뜀 {stats.skipped}
              </span>
            </div>
            <div className="h-3 rounded-full bg-line-soft overflow-hidden flex">
              <div className="h-full bg-olive transition-all" style={{ width: `${activeTotal ? (stats.uploaded / activeTotal) * 100 : 0}%` }} />
              <div className="h-full bg-accent/70 transition-all" style={{ width: `${activeTotal ? (stats.failed / activeTotal) * 100 : 0}%` }} />
              <div className="h-full bg-gold/70 transition-all" style={{ width: `${activeTotal ? (stats.uploading / activeTotal) * 100 : 0}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-4">
            <Stat label="총 파일" value={stats.total} />
            <Stat label="업로드" value={stats.uploaded} />
            <Stat label="대기" value={stats.queued} />
            <Stat label="실패" value={stats.failed} />
            <Stat label="건너뜀" value={stats.skipped} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={chooseFolder}
            disabled={isPending || !supported}
            className="px-4 py-2.5 rounded-xl bg-ink text-cream text-[13px] font-bold flex items-center gap-2 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            녹음 폴더 권한 설정
          </button>
          <button
            onClick={() => scanSavedFolder(false)}
            disabled={isPending || !supported}
            className="px-4 py-2.5 rounded-xl bg-paper border border-line text-[13px] font-semibold flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCcw size={14} />
            안 된 파일 이어서 백업
          </button>
          <button
            onClick={clearSetup}
            disabled={isPending}
            className="px-4 py-2.5 rounded-xl bg-paper border border-line text-[13px] text-ink-mute disabled:opacity-50"
          >
            설정 초기화
          </button>
        </div>

        <div className="text-[11px] text-ink-mute leading-5">
          처리 중 종료되어도 완료 파일은 보존됩니다. 상태가 `queued`, `uploading`, `failed`인 파일만 다음 실행 때 다시 시도합니다.
          한 번에 최대 {MAX_AUTO_UPLOAD_PER_RUN}개, 동시 {MAX_PARALLEL_UPLOADS}개씩 업로드합니다.
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
    ) : job.status === "uploading" ? (
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
  setCurrentFile: (name: string | null) => void
) {
  await runPool(entries, MAX_PARALLEL_UPLOADS, async (entry) => {
    setCurrentFile(entry.relativePath);
    patchJobs({
      [entry.fingerprint]: makeJob(entry, "uploading", "서버로 업로드 중"),
    });

    const validation = validateAudioFile({ name: entry.file.name, size: entry.file.size, type: entry.file.type });
    if (!validation.valid) {
      patchJobs({ [entry.fingerprint]: makeJob(entry, "failed", validation.reason) });
      return;
    }

    const formData = new FormData();
    formData.append("file", entry.file);
    formData.append("source", "phone_backup");
    formData.append("title", entry.file.name.replace(/\.[^.]+$/, ""));

    try {
      const result = await uploadRecording(formData);
      if (result.ok) {
        patchJobs({ [entry.fingerprint]: makeJob(entry, "uploaded", "백업 완료 · STT 대기열 등록") });
      } else {
        patchJobs({ [entry.fingerprint]: makeJob(entry, "failed", result.error) });
      }
    } catch (error) {
      patchJobs({
        [entry.fingerprint]: makeJob(entry, "failed", error instanceof Error ? error.message : "업로드 실패"),
      });
    }
  });
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
  return jobs.filter((job) => job.status === "queued" || job.status === "uploading" || job.status === "failed").length;
}

async function collectAudioFiles(handle: any, prefix = ""): Promise<AudioEntry[]> {
  const files: AudioEntry[] = [];
  for await (const [name, child] of handle.entries()) {
    const path = prefix ? `${prefix}/${name}` : name;
    if (child.kind === "directory") {
      files.push(...(await collectAudioFiles(child, path)));
      continue;
    }
    const ext = name.toLowerCase().split(".").pop() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(ext as any)) continue;
    const file = await child.getFile();
    files.push({
      file,
      relativePath: path,
      fingerprint: `${path}|${file.name}|${file.size}|${file.lastModified}`,
    });
  }
  return files.sort((a, b) => b.file.lastModified - a.file.lastModified);
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
