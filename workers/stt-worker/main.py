"""
STT Worker entrypoint.

CLI 사용 예:
  # 데모: --offline 모드로 mock 엔진을 끝까지 실행 (Supabase 키 불필요)
  python main.py --once --offline

  # 결과를 텍스트/마크다운 파일로 함께 저장
  python main.py --once --offline --output ./out

  # Supabase 모드, 큐를 1회 비우고 종료
  python main.py --drain

  # 데몬: 큐를 polling 하며 계속 처리
  python main.py --daemon

환경변수는 config.py 의 load_config() 참조.
"""

from __future__ import annotations

import argparse
import json
import logging
import signal
import sys
import tempfile
import time
import traceback
from pathlib import Path

from config import Config, load_config, setup_logging
from engines import STTEngine
from engines.base import STTResult
from engines.local_whisper_engine import LocalWhisperEngine
from engines.mock_engine import MockEngine
from engines.openai_engine import OpenAIEngine
from processors.classifier import classify_call
from processors.export_formatter import segments_to_markdown, segments_to_text
from processors.lexicon import postprocess_segments
from processors.privacy_masker import mask_segments
from processors.summarizer import summarize
from supabase_client import (
    Recording,
    SttJob,
    SummaryPayload,
    SupabaseRepo,
    TranscriptSegmentPayload,
    build_repo,
)

logger = logging.getLogger("stt-worker")

# ─────────────────────────────────────────────────────────
# 엔진 팩토리
# ─────────────────────────────────────────────────────────


def build_engine(config: Config) -> STTEngine:
    name = config.stt_engine
    if name == "mock":
        return MockEngine()
    if name == "openai":
        return OpenAIEngine(
            api_key=config.openai_api_key, model=config.openai_model
        )
    if name == "local_whisper":
        return LocalWhisperEngine(
            model_size=config.whisper_model_size,
            device=config.whisper_device,
            compute_type=config.whisper_compute_type,
        )
    raise ValueError(f"Unknown engine: {name}")


# ─────────────────────────────────────────────────────────
# 단일 잡 처리
# ─────────────────────────────────────────────────────────


def process_job(
    job: SttJob,
    *,
    repo: SupabaseRepo,
    engine: STTEngine,
    config: Config,
    output_dir: Path | None = None,
) -> dict:
    """단일 stt_job 을 처리.

    반환: 처리 결과 요약 dict (CLI 출력용)
    """
    started = time.time()
    logger.info("─── job %s (recording=%s) ───", job.id, job.recording_id)

    # ── 1) 잡 → running ───────────────────────────────────
    repo.mark_job_running(job.id)
    try:
        # ── 2) recording 메타 조회 ────────────────────────
        recording = repo.get_recording(job.recording_id)
        if recording is None:
            raise RuntimeError(
                f"recording {job.recording_id} 가 존재하지 않습니다."
            )
        if not recording.audio_path:
            raise RuntimeError(
                f"recording {recording.id} 에 audio_path 가 없습니다."
            )

        # ── 3) 오디오 다운로드 (임시 파일) ─────────────────
        with tempfile.TemporaryDirectory(prefix="stt-") as tmpdir:
            local_path = Path(tmpdir) / Path(recording.audio_path).name
            repo.download_audio(recording.audio_path, local_path)
            logger.info(
                "audio downloaded: %s (%d bytes)",
                local_path.name,
                local_path.stat().st_size,
            )

            # ── 4) 전사 — chunk_sec>0 이면 자동 분할 처리 ──
            stt: STTResult = engine.transcribe_chunked(
                local_path,
                language=job.language or config.stt_language,
                chunk_sec=config.chunk_sec,
                overlap_sec=config.chunk_overlap_sec,
            )
            logger.info(
                "transcribed: %d segments, %.1f sec, model=%s, chunks=%s",
                len(stt.segments),
                stt.duration_sec,
                stt.model,
                stt.raw.get("chunks", 1),
            )

        # ── 5) 후처리 사전 (도메인 어휘 교정) ─────────────
        if config.use_lexicon:
            stt = STTResult(
                segments=postprocess_segments(stt.segments),
                language=stt.language,
                model=stt.model,
                duration_sec=stt.duration_sec,
                raw=stt.raw,
            )

        # ── 6) PII 마스킹 ─────────────────────────────────
        # 원본은 보존 (transcript_segments.text_raw 로 저장),
        # 마스킹된 값이 일반 사용자에게 노출됩니다.
        original_segments = stt.segments
        masked_segments = mask_segments(original_segments)

        # ── 7) 분류·태깅 (마스킹된 텍스트 기준 — PII 가 분류에 영향 X) ─
        classification = classify_call(masked_segments)

        # ── 8) 요약·액션 추출 ─────────────────────────────
        # 표시용 = 마스킹된 결과
        summary = summarize(
            masked_segments, sentiment_hint=classification.sentiment
        )
        # 관리자용 = 원본으로 다시 한 번 추출 (개인정보 포함된 요약)
        summary_raw_obj = summarize(
            original_segments, sentiment_hint=classification.sentiment
        )

        # ── 9) recording status='processing' (이미 그럴 수 있지만 명시) ─
        repo.update_recording(recording.id, status="processing")

        # ── 10) transcript_segments 저장 ──────────────────
        # text=마스킹, text_raw=원본 — 같은 인덱스의 두 리스트를 zip
        transcript_payload = [
            TranscriptSegmentPayload(
                start_sec=int(round(m.start_sec)),
                end_sec=int(round(m.end_sec)),
                speaker=m.speaker,
                text=m.text,
                text_raw=o.text,
                confidence=m.confidence,
            )
            for m, o in zip(masked_segments, original_segments)
        ]
        repo.insert_transcript_segments(recording.id, transcript_payload)

        # ── 11) recording_summaries 저장 ──────────────────
        repo.upsert_summary(
            recording.id,
            SummaryPayload(
                summary=summary.summary,
                summary_raw=summary_raw_obj.summary,
                action_items=summary.action_items,
                action_items_raw=summary_raw_obj.action_items,
                key_topics=summary.key_topics,
                sentiment=summary.sentiment,
                model=summary.model,
            ),
            created_by="system",
        )

        # ── 12) recordings 메타 갱신 ──────────────────────
        repo.update_recording(
            recording.id,
            status="completed",
            duration_sec=int(round(stt.duration_sec)),
            sentiment=classification.sentiment,
            excerpt=classification.excerpt or None,
            category=classification.category,
            tags=classification.tags,
        )

        # ── 13) 잡 완료 ───────────────────────────────────
        elapsed_ms = int((time.time() - started) * 1000)
        repo.mark_job_completed(job.id, duration_ms=elapsed_ms)

        # ── 14) 옵션: 파일 내보내기 ───────────────────────
        if output_dir:
            output_dir.mkdir(parents=True, exist_ok=True)
            base = output_dir / f"{recording.id}"
            (base.with_suffix(".txt")).write_text(
                segments_to_text(masked_segments), encoding="utf-8"
            )
            (base.with_suffix(".md")).write_text(
                segments_to_markdown(
                    masked_segments,
                    title=f"통화 {recording.id}",
                    summary=summary.summary,
                    actions=summary.action_items,
                ),
                encoding="utf-8",
            )
            logger.info("exported: %s.txt / %s.md", base, base)

        result = {
            "ok": True,
            "job_id": job.id,
            "recording_id": recording.id,
            "elapsed_ms": elapsed_ms,
            "segments": len(transcript_payload),
            "duration_sec": int(round(stt.duration_sec)),
            "category": classification.category,
            "sentiment": classification.sentiment,
            "tags": classification.tags,
            "summary": summary.summary,
            "actions": summary.action_items,
            "key_topics": summary.key_topics,
        }
        logger.info("job %s completed in %d ms", job.id, elapsed_ms)
        return result

    except NotImplementedError as e:
        # 엔진이 아직 구현되지 않은 경우 — 운영자에게 명시적으로 알림
        msg = str(e)
        logger.error("engine not implemented: %s", msg)
        repo.mark_job_failed(
            job.id,
            error_code="engine_not_implemented",
            error_message=msg,
            retry_count=job.retry_count + 1,
        )
        repo.update_recording(job.recording_id, status="failed")
        return {"ok": False, "job_id": job.id, "error": msg, "code": "engine_not_implemented"}

    except Exception as e:
        # 알 수 없는 실패 — 스택 포함 로깅, retry_count 증가
        msg = str(e) or repr(e)
        logger.exception("job %s failed: %s", job.id, msg)
        repo.mark_job_failed(
            job.id,
            error_code=type(e).__name__,
            error_message=f"{msg}\n{traceback.format_exc()[-500:]}",
            retry_count=job.retry_count + 1,
        )
        repo.update_recording(job.recording_id, status="failed")
        return {
            "ok": False,
            "job_id": job.id,
            "error": msg,
            "code": type(e).__name__,
        }


# ─────────────────────────────────────────────────────────
# 루프
# ─────────────────────────────────────────────────────────


_should_stop = False


def _install_signal_handlers() -> None:
    def handler(signum, frame):
        global _should_stop
        logger.info("received signal %d, will stop after current job…", signum)
        _should_stop = True

    signal.signal(signal.SIGINT, handler)
    try:
        signal.signal(signal.SIGTERM, handler)
    except Exception:
        pass  # Windows 등


def run_loop(
    *,
    repo: SupabaseRepo,
    engine: STTEngine,
    config: Config,
    mode: str,  # 'once' | 'drain' | 'daemon'
    output_dir: Path | None,
) -> list[dict]:
    """잡 처리 루프.

    once   → 큐에서 1건만 처리하고 종료
    drain  → 큐가 빌 때까지 반복 후 종료
    daemon → 빈 큐일 때 폴링 대기, 신호 받으면 종료
    """
    results: list[dict] = []

    while True:
        if _should_stop:
            break
        job = repo.claim_one_queued_job()
        if job is None:
            if mode == "daemon":
                logger.debug("queue empty, sleeping %.1fs", config.poll_interval_sec)
                time.sleep(config.poll_interval_sec)
                continue
            break  # once / drain
        result = process_job(
            job,
            repo=repo,
            engine=engine,
            config=config,
            output_dir=output_dir,
        )
        results.append(result)
        if mode == "once":
            break

    return results


# ─────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="stt-worker",
        description="jamsa-vito STT background worker",
    )
    mode = p.add_mutually_exclusive_group()
    mode.add_argument(
        "--once", action="store_true", help="큐에서 1건만 처리 후 종료 (기본값)"
    )
    mode.add_argument(
        "--drain", action="store_true", help="큐가 빌 때까지 처리 후 종료"
    )
    mode.add_argument(
        "--daemon", action="store_true", help="데몬 모드: 큐를 폴링하며 계속 처리"
    )

    p.add_argument(
        "--offline",
        action="store_true",
        help="Supabase 없이 메모리 큐로 동작 (mock 엔진 검증용)",
    )
    p.add_argument(
        "--engine",
        choices=["mock", "openai", "local_whisper"],
        help="엔진 강제 지정 (env 의 STT_ENGINE 보다 우선)",
    )
    p.add_argument(
        "--audio-fixture",
        type=Path,
        default=None,
        help="--offline 모드에서 다운로드 대신 사용할 로컬 오디오 파일 경로",
    )
    p.add_argument(
        "--output",
        type=Path,
        default=None,
        help="처리 결과(.txt, .md)를 저장할 디렉토리",
    )
    p.add_argument(
        "--print-snapshot",
        action="store_true",
        help="--offline 모드 종료 시 메모리 상태 JSON 출력",
    )
    p.add_argument("--log-level", default=None, help="DEBUG/INFO/WARNING/ERROR")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)

    config = load_config()
    if args.engine:
        config = Config(
            **{**config.__dict__, "stt_engine": args.engine}
        )  # frozen → 새 인스턴스
    if args.log_level:
        config = Config(**{**config.__dict__, "log_level": args.log_level.upper()})

    setup_logging(config.log_level)

    logger.info(
        "STT worker starting · engine=%s · use_supabase=%s · offline_flag=%s",
        config.stt_engine,
        config.use_supabase,
        args.offline,
    )

    repo = build_repo(
        config, force_offline=args.offline, audio_fixture=args.audio_fixture
    )
    engine = build_engine(config)

    # 모드 기본값: --once
    mode = "daemon" if args.daemon else "drain" if args.drain else "once"
    logger.info("mode=%s", mode)

    _install_signal_handlers()

    results = run_loop(
        repo=repo,
        engine=engine,
        config=config,
        mode=mode,
        output_dir=args.output,
    )

    # ─ 결과 출력 ──────────────────────────────────────────
    if not results:
        logger.info("처리할 잡이 없습니다.")
    else:
        ok = sum(1 for r in results if r.get("ok"))
        logger.info("처리 완료: 총 %d건 (성공 %d, 실패 %d)", len(results), ok, len(results) - ok)
        for r in results:
            print(json.dumps(r, ensure_ascii=False, indent=2))

    if args.print_snapshot and hasattr(repo, "snapshot"):
        print("\n─── repo snapshot ───")
        print(json.dumps(repo.snapshot(), ensure_ascii=False, indent=2, default=str))

    # 종료 코드: 모든 잡 성공이면 0, 일부 실패면 1
    if results and any(not r.get("ok") for r in results):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
