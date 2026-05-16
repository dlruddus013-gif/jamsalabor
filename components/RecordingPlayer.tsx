"use client";

import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
} from "react";
import { Play, Pause, Volume2, SkipBack, SkipForward, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatDuration } from "@/lib/mock-data";

// ─────────────────────────────────────────────────────────
// 외부에서 seek 호출할 수 있는 imperative handle
// 부모가 transcript 클릭 같은 이벤트로 audio.currentTime 을 바꿀 때 사용
// ─────────────────────────────────────────────────────────

export interface RecordingPlayerHandle {
  seekTo(sec: number): void;
  play(): void;
  pause(): void;
}

interface Props {
  audioUrl?: string | null;
  durationSec: number;
  onTimeUpdate?: (sec: number) => void;
}

// ─────────────────────────────────────────────────────────
// 시각화용 placeholder waveform
// 실제 디코딩 없이 결정적 패턴을 만들어 표시 (UI 신호용)
// ─────────────────────────────────────────────────────────

function makeWave(n: number, peak: number): number[] {
  const arr: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = Math.sin(i / 3) * 0.3 + 0.5;
    const noise = (Math.sin(i * 1.7) + Math.cos(i * 0.9)) * 0.15;
    arr.push(Math.max(0.1, Math.min(1, base + noise) * peak));
  }
  return arr;
}

// ─────────────────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────────────────

const RecordingPlayer = forwardRef<RecordingPlayerHandle, Props>(
  function RecordingPlayer({ audioUrl, durationSec, onTimeUpdate }, ref) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const waveRef = useRef<HTMLDivElement | null>(null);
    const fallbackTickRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const [playing, setPlaying] = useState(false);
    const [currentSec, setCurrentSec] = useState(0);
    // 실제 오디오 메타에서 가져온 길이 (없으면 prop fallback)
    const [actualDuration, setActualDuration] = useState<number>(durationSec);
    const [loading, setLoading] = useState<boolean>(!!audioUrl);
    const [loadError, setLoadError] = useState<string | null>(null);

    const effectiveDuration = actualDuration > 0 ? actualDuration : durationSec;
    const bars = useRef(makeWave(Math.max(40, Math.floor(effectiveDuration / 6)), 0.75));

    // 외부에서 seek 가능
    useImperativeHandle(
      ref,
      () => ({
        seekTo(sec: number) {
          const clamped = Math.max(0, Math.min(effectiveDuration, sec));
          setCurrentSec(clamped);
          if (audioRef.current) {
            audioRef.current.currentTime = clamped;
          }
          onTimeUpdate?.(clamped);
        },
        play() {
          if (audioRef.current) {
            audioRef.current.play().catch(() => {});
          } else {
            setPlaying(true);
          }
        },
        pause() {
          audioRef.current?.pause();
          setPlaying(false);
        },
      }),
      [effectiveDuration, onTimeUpdate]
    );

    // ── audio 엘리먼트 이벤트 ────────────────────────────
    useEffect(() => {
      const a = audioRef.current;
      if (!a) return;

      const onLoadedMetadata = () => {
        if (Number.isFinite(a.duration) && a.duration > 0) {
          setActualDuration(a.duration);
        }
        setLoading(false);
      };
      const onTimeUpdateEvt = () => {
        const t = a.currentTime;
        setCurrentSec(t);
        onTimeUpdate?.(t);
      };
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      const onEnded = () => {
        setPlaying(false);
        setCurrentSec(a.duration || 0);
      };
      const onError = () => {
        setLoading(false);
        setLoadError("오디오를 불러올 수 없습니다 (URL 만료 가능).");
      };
      const onWaiting = () => setLoading(true);
      const onCanPlay = () => setLoading(false);

      a.addEventListener("loadedmetadata", onLoadedMetadata);
      a.addEventListener("timeupdate", onTimeUpdateEvt);
      a.addEventListener("play", onPlay);
      a.addEventListener("pause", onPause);
      a.addEventListener("ended", onEnded);
      a.addEventListener("error", onError);
      a.addEventListener("waiting", onWaiting);
      a.addEventListener("canplay", onCanPlay);

      return () => {
        a.removeEventListener("loadedmetadata", onLoadedMetadata);
        a.removeEventListener("timeupdate", onTimeUpdateEvt);
        a.removeEventListener("play", onPlay);
        a.removeEventListener("pause", onPause);
        a.removeEventListener("ended", onEnded);
        a.removeEventListener("error", onError);
        a.removeEventListener("waiting", onWaiting);
        a.removeEventListener("canplay", onCanPlay);
      };
    }, [onTimeUpdate]);

    // ── 폴백 시뮬레이션 (audio 가 없을 때만) ─────────────
    useEffect(() => {
      if (audioUrl) return; // 실제 오디오 모드면 시뮬레이션 안함
      if (!playing) {
        if (fallbackTickRef.current) {
          clearInterval(fallbackTickRef.current);
          fallbackTickRef.current = null;
        }
        return;
      }
      fallbackTickRef.current = setInterval(() => {
        setCurrentSec((prev) => {
          const next = prev + 1;
          if (next >= effectiveDuration) {
            setPlaying(false);
            onTimeUpdate?.(effectiveDuration);
            return effectiveDuration;
          }
          onTimeUpdate?.(next);
          return next;
        });
      }, 1000);
      return () => {
        if (fallbackTickRef.current) {
          clearInterval(fallbackTickRef.current);
          fallbackTickRef.current = null;
        }
      };
    }, [audioUrl, playing, effectiveDuration, onTimeUpdate]);

    // ── 버튼 핸들러 ───────────────────────────────────────
    const togglePlay = () => {
      if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play().catch(() => {});
        } else {
          audioRef.current.pause();
        }
      } else {
        setPlaying((p) => !p);
      }
    };

    const seekRelative = (delta: number) => {
      const target = Math.max(
        0,
        Math.min(effectiveDuration, currentSec + delta)
      );
      setCurrentSec(target);
      if (audioRef.current) audioRef.current.currentTime = target;
      onTimeUpdate?.(target);
    };

    const handleWaveClick = (e: React.MouseEvent<HTMLDivElement>) => {
      if (!waveRef.current || effectiveDuration === 0) return;
      const rect = waveRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const target = Math.max(0, Math.min(effectiveDuration, ratio * effectiveDuration));
      setCurrentSec(target);
      if (audioRef.current) audioRef.current.currentTime = target;
      onTimeUpdate?.(target);
    };

    const progress = effectiveDuration > 0 ? currentSec / effectiveDuration : 0;

    return (
      <div className="rounded-xl bg-surface p-3">
        {/* 실제 오디오 — 화면엔 보이지 않음 */}
        {audioUrl && (
          <audio ref={audioRef} src={audioUrl} preload="metadata" className="hidden" />
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={() => seekRelative(-10)}
            disabled={!!loadError}
            className="w-8 h-8 rounded-full bg-paper text-ink-soft flex items-center justify-center hover:bg-line-soft disabled:opacity-50"
            title="10초 뒤로"
          >
            <SkipBack size={12} />
          </button>

          <button
            onClick={togglePlay}
            disabled={!!loadError}
            className="w-11 h-11 rounded-full bg-ink text-cream flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-50"
            aria-label={playing ? "일시정지" : "재생"}
          >
            {loading && audioUrl ? (
              <Loader2 size={16} className="animate-spin" />
            ) : playing ? (
              <Pause size={16} />
            ) : (
              <Play size={16} className="ml-0.5" />
            )}
          </button>

          <button
            onClick={() => seekRelative(10)}
            disabled={!!loadError}
            className="w-8 h-8 rounded-full bg-paper text-ink-soft flex items-center justify-center hover:bg-line-soft disabled:opacity-50"
            title="10초 앞으로"
          >
            <SkipForward size={12} />
          </button>

          <div className="flex-1 min-w-0">
            <div
              ref={waveRef}
              onClick={handleWaveClick}
              className={cn(
                "flex items-center gap-[2px] h-8",
                loadError ? "cursor-not-allowed" : "cursor-pointer"
              )}
            >
              {bars.current.map((h, i) => {
                const isPlayed = i / bars.current.length <= progress;
                return (
                  <div
                    key={i}
                    className={cn(
                      "w-[2px] rounded-[1px] transition-colors",
                      isPlayed ? "bg-accent" : "bg-line"
                    )}
                    style={{ height: `${Math.max(2, h * 100)}%` }}
                  />
                );
              })}
            </div>
          </div>

          <div className="text-[11px] num shrink-0 text-ink-soft">
            {formatDuration(Math.floor(currentSec))}{" "}
            <span className="text-ink-mute">
              / {formatDuration(Math.floor(effectiveDuration))}
            </span>
          </div>

          <button
            onClick={() => audioRef.current?.muted && (audioRef.current.muted = false)}
            className="w-8 h-8 rounded-full bg-paper text-ink-soft flex items-center justify-center hover:bg-line-soft"
            title="볼륨"
          >
            <Volume2 size={13} />
          </button>
        </div>

        {/* 보조 메시지 */}
        {loadError ? (
          <div className="mt-2 text-[10px] text-accent text-center">{loadError}</div>
        ) : !audioUrl ? (
          <div className="mt-2 text-[10px] text-ink-mute text-center">
            오디오 URL 없음 · 시뮬레이션 재생 (Storage 연결 후 활성화)
          </div>
        ) : null}
      </div>
    );
  }
);

export default RecordingPlayer;
