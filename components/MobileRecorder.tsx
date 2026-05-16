"use client";

import { useState, useRef, useEffect, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Mic,
  Square,
  RotateCcw,
  Upload,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldAlert,
  XCircle,
  PhoneIncoming,
  History,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/mock-data";
import { uploadRecording } from "@/app/(app)/upload/actions";

// ─────────────────────────────────────────────────────────
// 상태 머신
// ─────────────────────────────────────────────────────────

type RecState =
  | "checking"     // 브라우저/권한 확인 중
  | "unsupported"  // MediaRecorder 미지원
  | "denied"       // 마이크 권한 거부
  | "device_error" // 장치 없음/사용 중
  | "idle"         // 녹음 가능 상태
  | "recording"    // 녹음 중
  | "stopping"     // 정지 처리 중 (onstop 대기)
  | "stopped"      // 녹음 완료, 미리듣기/업로드
  | "uploading"    // 업로드 중
  | "uploaded";    // 업로드 완료, 라우팅 직전

interface ErrorInfo {
  title: string;
  description: string;
}

interface NativeCallEvent {
  phone?: string;
  direction?: "incoming" | "outgoing" | "missed" | string;
  startedAt?: string;
  status?: string;
}

interface PhoneHistoryItem {
  id: string;
  recorded_at: string;
  title: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  status: string | null;
  duration_sec: number | null;
  excerpt: string | null;
}

declare global {
  interface Window {
    jamsaPhoneCallStarted?: (payload: NativeCallEvent) => void;
  }
}

// ─────────────────────────────────────────────────────────
// MediaRecorder 가 지원하는 최선의 MIME 선택
// ─────────────────────────────────────────────────────────

function pickMimeType(): { mime: string; ext: string } {
  if (typeof MediaRecorder === "undefined") return { mime: "", ext: "webm" };
  const candidates: { mime: string; ext: string }[] = [
    { mime: "audio/webm;codecs=opus", ext: "webm" },
    { mime: "audio/webm",             ext: "webm" },
    { mime: "audio/mp4;codecs=mp4a.40.2", ext: "m4a" }, // Safari iOS
    { mime: "audio/mp4",              ext: "m4a" },
  ];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mime)) return c;
  }
  return { mime: "", ext: "webm" }; // 빈 문자열 → 브라우저 기본
}

// 모바일 디바이스 추정
function isMobile(): boolean {
  if (typeof navigator === "undefined") return false;
  return (
    navigator.maxTouchPoints > 0 ||
    /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

// ─────────────────────────────────────────────────────────
// 메인 컴포넌트
// ─────────────────────────────────────────────────────────

export default function MobileRecorder() {
  const router = useRouter();

  const [state, setState] = useState<RecState>("checking");
  const [error, setError] = useState<ErrorInfo | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(60).fill(0));
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioMime, setAudioMime] = useState<{ mime: string; ext: string } | null>(null);
  const [title, setTitle] = useState("");
  const [uploadResult, setUploadResult] = useState<{
    ok: boolean;
    message: string;
    id?: string;
    mock?: boolean;
  } | null>(null);
  const [nativeCall, setNativeCall] = useState<NativeCallEvent | null>(null);
  const [phoneHistory, setPhoneHistory] = useState<PhoneHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  const [isPending, startTransition] = useTransition();

  const loadPhoneHistory = useCallback(async (phone: string) => {
    const normalized = normalizePhone(phone);
    if (!normalized) return;

    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/recordings/by-phone?phone=${encodeURIComponent(normalized)}`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { items?: PhoneHistoryItem[] };
      setPhoneHistory(Array.isArray(json.items) ? json.items : []);
    } catch {
      setPhoneHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // ─── 초기 지원 여부 검사 ───────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;

    const hasMediaDevices =
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function";
    const hasMediaRecorder = typeof window.MediaRecorder !== "undefined";

    if (!hasMediaDevices || !hasMediaRecorder) {
      setState("unsupported");
      return;
    }
    setState("idle");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const applyIncomingCall = (payload: NativeCallEvent) => {
      const phone = normalizePhone(payload.phone ?? "");
      const next = {
        ...payload,
        phone: phone ?? payload.phone,
        startedAt: payload.startedAt ?? new Date().toISOString(),
        status: payload.status ?? "ringing",
      };
      setNativeCall(next);
      if (phone) void loadPhoneHistory(phone);
    };

    window.jamsaPhoneCallStarted = applyIncomingCall;

    const params = new URLSearchParams(window.location.search);
    const initialPhone = params.get("phone");
    if (initialPhone) {
      applyIncomingCall({
        phone: initialPhone,
        direction: (params.get("direction") as NativeCallEvent["direction"]) ?? "incoming",
        status: "ringing",
      });
    }

    const onNativeCall = (event: Event) => {
      applyIncomingCall((event as CustomEvent<NativeCallEvent>).detail ?? {});
    };
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; payload?: NativeCallEvent } | string;
      if (typeof data === "object" && data?.type === "jamsa:phone-call") {
        applyIncomingCall(data.payload ?? {});
      }
    };

    window.addEventListener("jamsa:phone-call", onNativeCall);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("jamsa:phone-call", onNativeCall);
      window.removeEventListener("message", onMessage);
      if (window.jamsaPhoneCallStarted === applyIncomingCall) {
        delete window.jamsaPhoneCallStarted;
      }
    };
  }, [loadPhoneHistory]);

  // ─── 정리 ──────────────────────────────────────────────
  const cleanupMedia = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      cleanupMedia();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── 레벨 미터 ─────────────────────────────────────────
  const tickLevels = useCallback(() => {
    if (!analyserRef.current) return;
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] ?? 0;
    const avg = sum / data.length / 255;
    setLevels((prev) => {
      const next = prev.slice(1);
      next.push(avg);
      return next;
    });
    rafRef.current = requestAnimationFrame(tickLevels);
  }, []);

  // ─── 녹음 시작 ─────────────────────────────────────────
  const start = async () => {
    setError(null);
    setUploadResult(null);

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      const err = e as DOMException;
      if (err?.name === "NotAllowedError" || err?.name === "SecurityError") {
        setState("denied");
        setError({
          title: "마이크 권한이 거부되었습니다",
          description:
            "주소창의 자물쇠 아이콘을 눌러 사이트의 마이크 권한을 '허용'으로 변경한 뒤 다시 시도해 주세요. iOS Safari 의 경우 설정 > Safari > 마이크에서 변경할 수 있습니다.",
        });
      } else if (err?.name === "NotFoundError" || err?.name === "OverconstrainedError") {
        setState("device_error");
        setError({
          title: "사용 가능한 마이크가 없습니다",
          description:
            "이 기기에서 입력 장치를 찾지 못했습니다. 외장 마이크를 연결했다면 다시 인식되었는지 확인해 주세요.",
        });
      } else if (err?.name === "NotReadableError") {
        setState("device_error");
        setError({
          title: "마이크를 사용할 수 없습니다",
          description:
            "다른 앱이 마이크를 점유 중일 수 있습니다. 통화·녹화 앱을 종료한 뒤 다시 시도해 주세요.",
        });
      } else {
        setState("device_error");
        setError({
          title: "녹음을 시작할 수 없습니다",
          description: err?.message ?? "알 수 없는 오류가 발생했습니다.",
        });
      }
      return;
    }

    streamRef.current = stream;

    // MediaRecorder 인스턴스
    const picked = pickMimeType();
    setAudioMime(picked);

    let mr: MediaRecorder;
    try {
      mr = picked.mime
        ? new MediaRecorder(stream, { mimeType: picked.mime })
        : new MediaRecorder(stream);
    } catch (e) {
      cleanupMedia();
      setState("device_error");
      setError({
        title: "녹음 형식을 사용할 수 없습니다",
        description: e instanceof Error ? e.message : "MediaRecorder 초기화 실패",
      });
      return;
    }

    mediaRecorderRef.current = mr;
    chunksRef.current = [];

    mr.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    mr.onerror = (ev) => {
      console.error("[MediaRecorder] error", ev);
      setError({
        title: "녹음 중 오류가 발생했습니다",
        description: "녹음을 다시 시작해 주세요.",
      });
      cleanupMedia();
      setState("idle");
    };
    mr.onstop = () => {
      const type = mr.mimeType || picked.mime || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      const url = URL.createObjectURL(blob);
      setAudioBlob(blob);
      setAudioUrl(url);
      setState("stopped");
      // 트랙·오디오컨텍스트 정리 (스트림 반환)
      cleanupMedia();
    };

    // AudioContext 로 마이크 레벨 시각화
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      src.connect(analyser);
      analyserRef.current = analyser;
      rafRef.current = requestAnimationFrame(tickLevels);
    } catch {
      // 시각화는 실패해도 녹음 자체는 진행
    }

    mr.start(250); // 250ms 단위 chunk

    // 타이머
    setSeconds(0);
    setLevels(Array(60).fill(0));
    tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);

    setState("recording");
  };

  // ─── 녹음 정지 ─────────────────────────────────────────
  const stop = () => {
    setState("stopping");
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      mediaRecorderRef.current?.stop(); // → onstop 에서 blob 만들고 setState('stopped')
    } catch (e) {
      console.error("[MediaRecorder] stop failed", e);
      cleanupMedia();
      setState("idle");
    }
  };

  // ─── 다시 녹음 ─────────────────────────────────────────
  const reset = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBlob(null);
    setAudioMime(null);
    setSeconds(0);
    setLevels(Array(60).fill(0));
    setTitle("");
    setError(null);
    setUploadResult(null);
    setState("idle");
  };

  // ─── 업로드 ────────────────────────────────────────────
  const upload = () => {
    if (!audioBlob || !audioMime) return;

    startTransition(async () => {
      setState("uploading");
      setUploadResult(null);

      // Blob → File (서버 액션의 validateAudioFile 이 확장자 기준으로 검사)
      const trimmedTitle = title.trim();
      const baseName = trimmedTitle
        ? trimmedTitle.replace(/[^\w가-힣 .-]/g, "").slice(0, 60)
        : `recording_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}`;
      const filename = `${baseName}.${audioMime.ext}`;
      const file = new File([audioBlob], filename, {
        type: audioBlob.type || audioMime.mime || "audio/webm",
      });

      const fd = new FormData();
      fd.append("file", file);
      fd.append("source", isMobile() ? "mobile_recording" : "web_recording");
      if (trimmedTitle) fd.append("title", trimmedTitle);

      try {
        const result = await uploadRecording(fd);
        if (result.ok) {
          setUploadResult({
            ok: true,
            message: "업로드 완료 · 텍스트 변환 대기 중",
            id: result.id,
            mock: result.mock,
          });
          setState("uploaded");
          // 잠시 성공 표시 후 상세 페이지로 이동
          setTimeout(() => {
            router.push(`/recordings/${result.id}`);
          }, 800);
        } else {
          setUploadResult({
            ok: false,
            message: `${result.error} [${result.code}]`,
          });
          setState("stopped"); // 다시 시도 가능 상태로 복귀
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "네트워크 오류";
        setUploadResult({ ok: false, message: msg });
        setState("stopped");
      }
    });
  };

  // ─── 렌더링 분기 ───────────────────────────────────────
  if (state === "checking") {
    return (
      <Shell>
        <div className="flex items-center justify-center py-12 text-ink-mute text-[13px]">
          <Loader2 size={16} className="animate-spin mr-2" />
          마이크 환경 확인 중…
        </div>
      </Shell>
    );
  }

  if (state === "unsupported") {
    return (
      <Shell>
        <ErrorPanel
          icon={XCircle}
          tone="accent"
          title="이 브라우저에서는 녹음을 지원하지 않습니다"
          description="Chrome, Edge, Safari 14+, Firefox 등 최신 브라우저를 사용해 주세요. iOS 의 경우 Safari 만 마이크 접근이 가능합니다."
        />
      </Shell>
    );
  }

  return (
    <Shell>
      <NativeCallPanel
        call={nativeCall}
        history={phoneHistory}
        loading={historyLoading}
        onRefresh={() => nativeCall?.phone && void loadPhoneHistory(nativeCall.phone)}
      />

      {/* 상태 배지 + 시간 */}
      <div className="flex items-center justify-between mb-5">
        <StatusBadge state={state} />
        <div className="font-display num text-[36px] sm:text-[40px] font-bold tracking-tight">
          {formatDuration(seconds)}
        </div>
      </div>

      {/* 레벨 미터 / 파형 */}
      <div className="rounded-2xl bg-surface p-4 mb-6 h-28 flex items-end justify-center gap-[3px]">
        {levels.map((lv, i) => {
          const h = Math.max(4, lv * 100);
          return (
            <div
              key={i}
              className={cn(
                "w-1 rounded-full transition-all",
                state === "recording"
                  ? "bg-accent"
                  : state === "stopped" || state === "uploading" || state === "uploaded"
                  ? "bg-line"
                  : "bg-line"
              )}
              style={{ height: `${h}%` }}
            />
          );
        })}
      </div>

      {/* 컨트롤 */}
      {state === "denied" || state === "device_error" ? (
        <>
          {error && (
            <ErrorPanel
              icon={ShieldAlert}
              tone="accent"
              title={error.title}
              description={error.description}
            />
          )}
          <button
            onClick={start}
            className="w-full mt-4 h-14 rounded-2xl bg-ink text-cream font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Mic size={18} /> 다시 시도
          </button>
        </>
      ) : state === "idle" ? (
        <button
          onClick={start}
          className="w-full h-20 rounded-3xl bg-accent text-cream font-bold text-[18px] flex items-center justify-center gap-3 active:scale-[0.98] transition-transform shadow-sm"
        >
          <Mic size={22} /> 녹음 시작
        </button>
      ) : state === "recording" || state === "stopping" ? (
        <button
          onClick={stop}
          disabled={state === "stopping"}
          className="w-full h-20 rounded-3xl bg-ink text-cream font-bold text-[18px] flex items-center justify-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-60"
        >
          {state === "stopping" ? (
            <>
              <Loader2 size={20} className="animate-spin" /> 마무리 중…
            </>
          ) : (
            <>
              <Square size={20} /> 녹음 정지
            </>
          )}
        </button>
      ) : (
        // stopped / uploading / uploaded
        <div className="space-y-4">
          {/* 미리듣기 */}
          {audioUrl && (
            <div className="rounded-2xl bg-surface p-3">
              <div className="text-[10px] tracking-[0.25em] uppercase text-gold mb-2 px-1">
                Preview
              </div>
              <audio
                src={audioUrl}
                controls
                preload="metadata"
                className="w-full"
                style={{ height: 44 }}
              />
            </div>
          )}

          {/* 제목 입력 */}
          <div>
            <label className="block text-[11px] text-ink-soft mb-1.5">
              제목 <span className="text-ink-mute">(선택)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={state !== "stopped"}
              placeholder="예: 김미영 단체 견학 상담"
              maxLength={200}
              className="w-full px-4 py-3 rounded-xl border border-line bg-cream focus:border-accent outline-none text-[14px] disabled:opacity-60"
            />
          </div>

          {/* 결과 메시지 */}
          {uploadResult && (
            <div
              className={cn(
                "rounded-xl px-4 py-3 text-[12px] flex items-start gap-2",
                uploadResult.ok
                  ? "bg-olive/10 text-olive"
                  : "bg-accent/10 text-accent"
              )}
            >
              {uploadResult.ok ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              ) : (
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
              )}
              <span>
                {uploadResult.message}
                {uploadResult.mock && (
                  <span className="ml-1.5 px-1.5 py-px rounded bg-gold/20 text-gold text-[10px]">
                    mock
                  </span>
                )}
              </span>
            </div>
          )}

          {/* 액션 버튼 */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={reset}
              disabled={state === "uploading" || state === "uploaded"}
              className="h-16 rounded-2xl bg-surface text-ink font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              <RotateCcw size={17} /> 다시 녹음
            </button>
            <button
              onClick={upload}
              disabled={
                state !== "stopped" || isPending || !audioBlob || audioBlob.size < 100
              }
              className="h-16 rounded-2xl bg-accent text-cream font-bold text-[15px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              {state === "uploading" ? (
                <>
                  <Loader2 size={17} className="animate-spin" /> 업로드 중
                </>
              ) : state === "uploaded" ? (
                <>
                  <CheckCircle2 size={17} /> 완료
                </>
              ) : (
                <>
                  <Upload size={17} /> 업로드
                </>
              )}
            </button>
          </div>

          {state === "stopped" && (
            <div className="text-[11px] text-ink-mute text-center">
              업로드 후 자동으로 STT 변환이 시작됩니다.
            </div>
          )}
        </div>
      )}
    </Shell>
  );
}

// ─────────────────────────────────────────────────────────
// 보조 컴포넌트
// ─────────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-paper border border-line p-5 sm:p-6 max-w-md mx-auto">
      {children}
    </div>
  );
}

function NativeCallPanel({
  call,
  history,
  loading,
  onRefresh,
}: {
  call: NativeCallEvent | null;
  history: PhoneHistoryItem[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="mb-5 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
            <PhoneIncoming size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-[13px] font-bold">전화 자동녹음 연결</div>
            <div className="text-[11px] text-ink-mute leading-relaxed">
              Android 네이티브 앱이 수신번호를 보내면 이 화면에 통화내역이 즉시 표시됩니다.
            </div>
          </div>
        </div>
        <span className="px-2 py-1 rounded-full bg-gold/15 text-gold text-[10px] font-bold shrink-0">
          앱 연동
        </span>
      </div>

      {call?.phone ? (
        <div className="mt-4 rounded-xl bg-paper border border-line-soft p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] tracking-[0.18em] uppercase text-gold">
                Incoming Call
              </div>
              <div className="mt-1 text-[18px] font-display font-bold num">{call.phone}</div>
              <div className="text-[11px] text-ink-mute">
                {call.direction === "outgoing" ? "발신" : call.direction === "missed" ? "부재중" : "수신"} ·{" "}
                {call.status === "recording" ? "녹음 중" : "대기 중"}
              </div>
            </div>
            <button
              type="button"
              onClick={onRefresh}
              className="px-3 py-2 rounded-xl bg-surface border border-line text-[11px] font-semibold flex items-center gap-1.5"
            >
              {loading ? <Loader2 size={13} className="animate-spin" /> : <History size={13} />}
              내역
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {loading ? (
              <div className="text-[11px] text-ink-mute">같은 번호 통화내역을 불러오는 중입니다.</div>
            ) : history.length > 0 ? (
              history.slice(0, 4).map((item) => (
                <a
                  key={item.id}
                  href={`/recordings/${item.id}`}
                  className="block rounded-lg bg-surface border border-line-soft px-3 py-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[12px] font-semibold truncate">
                      {item.title || item.customer_name || item.customer_phone || "통화"}
                    </div>
                    <div className="text-[10px] text-ink-mute shrink-0">{formatShortDate(item.recorded_at)}</div>
                  </div>
                  <div className="text-[10px] text-ink-mute truncate">
                    {item.excerpt || `${item.status ?? "처리 대기"} · ${formatDuration(item.duration_sec ?? 0)}`}
                  </div>
                </a>
              ))
            ) : (
              <div className="text-[11px] text-ink-mute">
                이 번호의 기존 통화내역이 아직 없습니다. 통화 종료 후 자동 업로드되면 누적됩니다.
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-4 text-[11px] text-ink-mute leading-relaxed">
          웹브라우저 단독으로는 실제 전화 수신 감지와 통화 자동녹음을 할 수 없습니다. Android 앱에서
          전화 상태 권한과 녹음/파일 권한을 받아 이 화면으로 번호와 녹음파일을 보내야 합니다.
        </div>
      )}
    </div>
  );
}

function StatusBadge({ state }: { state: RecState }) {
  if (state === "recording") {
    return (
      <div className="flex items-center gap-2">
        <span className="relative flex w-2.5 h-2.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-accent animate-rec-pulse" />
          <span className="relative inline-flex w-2.5 h-2.5 rounded-full bg-accent" />
        </span>
        <span className="text-[13px] font-semibold text-accent">REC</span>
      </div>
    );
  }
  if (state === "stopping") {
    return <span className="text-[12px] font-semibold text-ink-soft">정지 중…</span>;
  }
  if (state === "stopped") {
    return <span className="text-[12px] font-semibold text-ink-soft">녹음 완료</span>;
  }
  if (state === "uploading") {
    return (
      <span className="text-[12px] font-semibold text-sky flex items-center gap-1">
        <Loader2 size={11} className="animate-spin" /> 업로드 중
      </span>
    );
  }
  if (state === "uploaded") {
    return (
      <span className="text-[12px] font-semibold text-olive flex items-center gap-1">
        <CheckCircle2 size={12} /> 텍스트 변환 대기 중
      </span>
    );
  }
  if (state === "denied" || state === "device_error") {
    return <span className="text-[12px] font-semibold text-accent">오류</span>;
  }
  return <span className="text-[12px] text-ink-mute">대기 중</span>;
}

function ErrorPanel({
  icon: Icon,
  tone,
  title,
  description,
}: {
  icon: typeof AlertCircle;
  tone: "accent" | "gold";
  title: string;
  description: string;
}) {
  const cls =
    tone === "accent"
      ? "bg-accent/10 border-accent/30 text-accent"
      : "bg-gold/10 border-gold/30 text-gold";
  return (
    <div className={cn("rounded-2xl border p-4 flex items-start gap-3", cls)}>
      <Icon size={18} className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <div className="text-[13px] font-bold">{title}</div>
        <div className="text-[11px] mt-1 leading-relaxed text-ink-soft">
          {description}
        </div>
      </div>
    </div>
  );
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("82")) digits = `0${digits.slice(2)}`;
  if (digits.length < 9 || digits.length > 11) return null;
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10 && digits.startsWith("02")) return `${digits.slice(0, 2)}-${digits.slice(2, 6)}-${digits.slice(6)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits;
}

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
