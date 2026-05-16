"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CheckCircle2, FolderOpen, Loader2, RefreshCcw, ShieldCheck, Smartphone, XCircle } from "lucide-react";
import { uploadRecording } from "@/app/(app)/upload/actions";
import { ACCEPTED_EXTENSIONS, validateAudioFile } from "@/lib/upload";
import { cn } from "@/lib/cn";

const DB_NAME = "jamsa-auto-backup";
const STORE_NAME = "handles";
const HANDLE_KEY = "recordings-directory";
const UPLOADED_KEY = "jamsa-uploaded-audio-fingerprints";
const MAX_AUTO_UPLOAD_PER_SCAN = 12;
const MAX_PARALLEL_UPLOADS = 3;

type BackupStatus = "unsupported" | "idle" | "ready" | "scanning" | "done" | "error";

interface BackupLog {
  name: string;
  status: "uploaded" | "skipped" | "failed";
  message: string;
}

interface AudioEntry {
  file: File;
  relativePath: string;
  fingerprint: string;
}

export default function AutoBackupManager() {
  const [status, setStatus] = useState<BackupStatus>("idle");
  const [message, setMessage] = useState("녹음 폴더를 한 번 지정하면 다음 접속부터 새 파일을 자동 백업합니다.");
  const [logs, setLogs] = useState<BackupLog[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [isPending, startTransition] = useTransition();
  const runningRef = useRef(false);

  const supported = useMemo(
    () => typeof window !== "undefined" && "showDirectoryPicker" in window && "indexedDB" in window,
    []
  );

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
          setMessage("새 녹음파일을 빠르게 찾는 중입니다.");
          setProgress({ done: 0, total: 0 });

          const result = await scanAndUpload(handle, (done, total) => {
            setProgress({ done, total });
            if (total > 0) setMessage(`자동 백업 중입니다. ${done}/${total}개 처리 완료`);
          });

          setLogs(result.logs);
          setStatus("done");
          setMessage(`자동 백업 완료: 새 파일 ${result.uploaded}개 업로드, ${result.skipped}개 건너뜀.`);
        } catch (error) {
          setStatus("error");
          setMessage(error instanceof Error ? error.message : "자동 백업 중 오류가 발생했습니다.");
        } finally {
          runningRef.current = false;
        }
      });
    },
    [supported]
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
        setMessage("녹음 폴더 권한이 저장되었습니다. 접속 시 자동 백업이 켜졌습니다.");
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
      localStorage.removeItem(UPLOADED_KEY);
      setLogs([]);
      setProgress({ done: 0, total: 0 });
      setStatus("idle");
      setMessage("자동 백업 설정을 초기화했습니다.");
    });
  };

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
              앱에 들어오면 저장된 녹음 폴더에서 새 파일만 찾아 빠르게 업로드합니다.
            </p>
          </div>
        </div>
        <StatusBadge status={status} busy={isPending || runningRef.current} />
      </div>

      <div className="p-5 space-y-4">
        <div className="rounded-xl bg-surface/60 border border-line-soft p-4 flex items-start gap-3">
          <ShieldCheck size={17} className="text-olive mt-0.5 shrink-0" />
          <div className="text-[13px] leading-6 text-ink-soft">
            {message}
            {progress.total > 0 && (
              <div className="mt-3 h-2 rounded-full bg-line-soft overflow-hidden">
                <div
                  className="h-full bg-olive transition-all"
                  style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                />
              </div>
            )}
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
            지금 백업 실행
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
          속도 개선: 전체 파일 해시 계산 없이 경로, 파일명, 크기, 수정시간으로 중복을 판단합니다.
          한 번에 최대 {MAX_AUTO_UPLOAD_PER_SCAN}개, 동시 {MAX_PARALLEL_UPLOADS}개씩 업로드합니다.
        </div>

        {logs.length > 0 && (
          <div className="rounded-xl border border-line overflow-hidden">
            <div className="px-4 py-2.5 bg-cream/60 text-[12px] font-semibold">최근 자동 백업 결과</div>
            <div className="divide-y divide-line-soft max-h-72 overflow-auto scroll-thin">
              {logs.map((log, index) => (
                <div key={`${log.name}_${index}`} className="px-4 py-3 flex items-start gap-2">
                  {log.status === "uploaded" ? (
                    <CheckCircle2 size={14} className="text-olive mt-0.5 shrink-0" />
                  ) : log.status === "failed" ? (
                    <XCircle size={14} className="text-accent mt-0.5 shrink-0" />
                  ) : (
                    <RefreshCcw size={14} className="text-ink-mute mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium truncate">{log.name}</div>
                    <div className="text-[11px] text-ink-mute">{log.message}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
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

async function scanAndUpload(handle: any, onProgress: (done: number, total: number) => void) {
  const uploadedFingerprints = getUploadedFingerprints();
  const entries = await collectAudioFiles(handle);
  const logs: BackupLog[] = [];
  const freshEntries = entries
    .filter((entry) => !uploadedFingerprints.has(entry.fingerprint))
    .slice(0, MAX_AUTO_UPLOAD_PER_SCAN);

  let uploaded = 0;
  let skipped = entries.length - freshEntries.length;
  let done = 0;
  onProgress(done, freshEntries.length);

  await runPool(freshEntries, MAX_PARALLEL_UPLOADS, async (entry) => {
    const validation = validateAudioFile({
      name: entry.file.name,
      size: entry.file.size,
      type: entry.file.type,
    });

    if (!validation.valid) {
      logs.push({ name: entry.relativePath, status: "failed", message: validation.reason });
      done += 1;
      onProgress(done, freshEntries.length);
      return;
    }

    const formData = new FormData();
    formData.append("file", entry.file);
    formData.append("source", "phone_backup");
    formData.append("title", entry.file.name.replace(/\.[^.]+$/, ""));

    const result = await uploadRecording(formData);
    if (result.ok) {
      uploaded += 1;
      uploadedFingerprints.add(entry.fingerprint);
      logs.push({ name: entry.relativePath, status: "uploaded", message: "백업 및 STT 대기열 등록 완료" });
    } else {
      logs.push({ name: entry.relativePath, status: "failed", message: result.error });
    }
    done += 1;
    onProgress(done, freshEntries.length);
  });

  saveUploadedFingerprints(uploadedFingerprints);
  if (freshEntries.length === 0 && entries.length > 0) {
    logs.push({ name: "전체 확인", status: "skipped", message: "새로 백업할 파일이 없습니다." });
  }
  if (entries.length > uploaded + skipped) {
    logs.push({
      name: "이어받기",
      status: "skipped",
      message: `한 번에 ${MAX_AUTO_UPLOAD_PER_SCAN}개씩 처리합니다. 다시 접속하거나 지금 백업 실행을 누르면 이어서 처리합니다.`,
    });
  }
  return { uploaded, skipped, logs };
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

function getUploadedFingerprints() {
  try {
    return new Set<string>(JSON.parse(localStorage.getItem(UPLOADED_KEY) ?? "[]"));
  } catch {
    return new Set<string>();
  }
}

function saveUploadedFingerprints(fingerprints: Set<string>) {
  localStorage.setItem(UPLOADED_KEY, JSON.stringify(Array.from(fingerprints).slice(-10000)));
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
