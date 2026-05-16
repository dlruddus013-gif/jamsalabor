"""
Supabase client wrapper with offline / mock-friendly behaviour.

워커는 service_role 키를 사용하므로 RLS 를 우회합니다.
실제 키가 없거나 use_supabase=False 인 경우, 메모리 내 가짜 큐로 동작하여
mock 엔진을 그대로 검증할 수 있도록 합니다.
"""

from __future__ import annotations

import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import Config

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────
# 도메인 타입
# ─────────────────────────────────────────────────────────


@dataclass
class SttJob:
    id: str
    recording_id: str
    status: str
    engine: str
    language: str | None
    retry_count: int
    priority: int


@dataclass
class Recording:
    id: str
    audio_path: str | None  # Storage 내 객체 경로 (예: "{user_id}/{ts}_name.webm")
    audio_mime: str | None
    duration_sec: int


@dataclass
class TranscriptSegmentPayload:
    start_sec: int
    end_sec: int
    speaker: str  # 'agent' | 'customer'
    text: str            # 마스킹된 텍스트 (일반 사용자가 보는 값)
    text_raw: str | None = None   # 마스킹 전 원본 (관리자 전용)
    confidence: float | None = None


@dataclass
class SummaryPayload:
    summary: list[str]            # 마스킹된 bullets
    action_items: list[dict[str, Any]]   # 마스킹된 액션
    key_topics: list[str]
    sentiment: str | None
    model: str | None
    prompt_version: str | None = None
    tokens_input: int | None = None
    tokens_output: int | None = None
    summary_raw: list[str] | None = None             # 원본 bullets (관리자)
    action_items_raw: list[dict[str, Any]] | None = None   # 원본 액션 (관리자)


# ─────────────────────────────────────────────────────────
# 클라이언트 인터페이스
# ─────────────────────────────────────────────────────────


class SupabaseRepo:
    """워커가 사용하는 데이터 액세스 면 (face).

    실제 구현(_RealRepo)과 오프라인 구현(_OfflineRepo) 둘 다 같은 메서드를 갖습니다.
    워커 코드는 이 클래스의 인스턴스만 다루면 되므로 모드 변경에 영향받지 않습니다.
    """

    def claim_one_queued_job(self) -> SttJob | None:
        raise NotImplementedError

    def get_recording(self, recording_id: str) -> Recording | None:
        raise NotImplementedError

    def download_audio(self, audio_path: str, dest: Path) -> Path:
        raise NotImplementedError

    def insert_transcript_segments(
        self, recording_id: str, segments: list[TranscriptSegmentPayload]
    ) -> None:
        raise NotImplementedError

    def upsert_summary(
        self, recording_id: str, payload: SummaryPayload, created_by: str | None = None
    ) -> None:
        raise NotImplementedError

    def update_recording(
        self,
        recording_id: str,
        *,
        status: str | None = None,
        duration_sec: int | None = None,
        sentiment: str | None = None,
        excerpt: str | None = None,
        category: str | None = None,
        tags: list[str] | None = None,
    ) -> None:
        raise NotImplementedError

    def mark_job_running(self, job_id: str) -> None:
        raise NotImplementedError

    def mark_job_completed(self, job_id: str, duration_ms: int) -> None:
        raise NotImplementedError

    def mark_job_failed(
        self, job_id: str, *, error_code: str, error_message: str, retry_count: int
    ) -> None:
        raise NotImplementedError


# ─────────────────────────────────────────────────────────
# 실제 Supabase 구현
# ─────────────────────────────────────────────────────────


class _RealRepo(SupabaseRepo):
    def __init__(self, config: Config) -> None:
        if not config.supabase_url or not config.supabase_service_role_key:
            raise RuntimeError(
                "Supabase 키가 누락되었습니다. NEXT_PUBLIC_SUPABASE_URL 와 "
                "SUPABASE_SERVICE_ROLE_KEY 를 .env 또는 환경변수에 설정하세요."
            )

        # 지연 import (의존성이 없는 환경에서도 mock 모드는 동작해야 함)
        from supabase import create_client  # type: ignore

        self._client = create_client(
            config.supabase_url, config.supabase_service_role_key
        )
        self._bucket = config.storage_bucket
        self._cfg = config

    # ─── jobs ─────────────────────────────────────────────

    def claim_one_queued_job(self) -> SttJob | None:
        """status='queued' 잡 중 우선순위가 높은 것 1개를 가져옴.

        주의: 다중 워커 환경에서는 race condition 이 가능하므로, 운영 시에는
        Postgres function (`select … for update skip locked`) 으로 교체 권장.
        현재는 단일 워커 가정.
        """
        resp = (
            self._client.table("stt_jobs")
            .select("id, recording_id, status, engine, language, retry_count, priority")
            .eq("status", "queued")
            .order("priority", desc=False)
            .order("created_at", desc=False)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        r = rows[0]
        return SttJob(
            id=r["id"],
            recording_id=r["recording_id"],
            status=r["status"],
            engine=r.get("engine") or "whisper-large-v3",
            language=r.get("language"),
            retry_count=r.get("retry_count") or 0,
            priority=r.get("priority") or 100,
        )

    def mark_job_running(self, job_id: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self._client.table("stt_jobs").update(
            {"status": "running", "started_at": now}
        ).eq("id", job_id).execute()

    def mark_job_completed(self, job_id: str, duration_ms: int) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self._client.table("stt_jobs").update(
            {
                "status": "completed",
                "completed_at": now,
                "duration_ms": duration_ms,
            }
        ).eq("id", job_id).execute()

    def mark_job_failed(
        self, job_id: str, *, error_code: str, error_message: str, retry_count: int
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        self._client.table("stt_jobs").update(
            {
                "status": "failed",
                "completed_at": now,
                "error_code": error_code,
                "error_message": error_message[:2000],  # 안전 잘라내기
                "retry_count": retry_count,
            }
        ).eq("id", job_id).execute()

    # ─── recordings ───────────────────────────────────────

    def get_recording(self, recording_id: str) -> Recording | None:
        resp = (
            self._client.table("recordings")
            .select("id, audio_path, audio_mime, duration_sec")
            .eq("id", recording_id)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        r = rows[0]
        return Recording(
            id=r["id"],
            audio_path=r.get("audio_path"),
            audio_mime=r.get("audio_mime"),
            duration_sec=r.get("duration_sec") or 0,
        )

    def update_recording(
        self,
        recording_id: str,
        *,
        status: str | None = None,
        duration_sec: int | None = None,
        sentiment: str | None = None,
        excerpt: str | None = None,
        category: str | None = None,
        tags: list[str] | None = None,
    ) -> None:
        patch: dict[str, Any] = {}
        if status is not None:
            patch["status"] = status
        if duration_sec is not None:
            patch["duration_sec"] = duration_sec
        if sentiment is not None:
            patch["sentiment"] = sentiment
        if excerpt is not None:
            patch["excerpt"] = excerpt
        if category is not None:
            patch["category"] = category
        if tags is not None:
            patch["tags"] = tags
        if not patch:
            return
        self._client.table("recordings").update(patch).eq(
            "id", recording_id
        ).execute()

    # ─── storage ──────────────────────────────────────────

    def download_audio(self, audio_path: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        data: bytes = self._client.storage.from_(self._bucket).download(audio_path)
        if not data:
            raise RuntimeError(
                f"Storage 다운로드 결과가 비어있습니다: {self._bucket}/{audio_path}"
            )
        dest.write_bytes(data)
        return dest

    # ─── transcripts & summaries ──────────────────────────

    def insert_transcript_segments(
        self, recording_id: str, segments: list[TranscriptSegmentPayload]
    ) -> None:
        if not segments:
            return
        rows = [
            {
                "recording_id": recording_id,
                "start_sec": s.start_sec,
                "end_sec": s.end_sec,
                "speaker": s.speaker,
                "text": s.text,                # 마스킹된 값
                "text_raw": s.text_raw,        # 원본 (관리자 전용 컬럼)
                "confidence": s.confidence,
            }
            for s in segments
        ]
        # 청크로 분할 — 너무 긴 통화 대응
        CHUNK = 200
        for i in range(0, len(rows), CHUNK):
            self._client.table("transcript_segments").insert(rows[i : i + CHUNK]).execute()

    def upsert_summary(
        self, recording_id: str, payload: SummaryPayload, created_by: str | None = None
    ) -> None:
        # 트리거가 동일 recording 의 기존 is_current=true 를 자동 해제
        self._client.table("recording_summaries").insert(
            {
                "recording_id": recording_id,
                "summary": payload.summary,
                "summary_raw": payload.summary_raw,
                "action_items": payload.action_items,
                "action_items_raw": payload.action_items_raw,
                "key_topics": payload.key_topics,
                "sentiment": payload.sentiment,
                "model": payload.model,
                "prompt_version": payload.prompt_version,
                "tokens_input": payload.tokens_input,
                "tokens_output": payload.tokens_output,
                "is_current": True,
                "created_by": created_by,
            }
        ).execute()


# ─────────────────────────────────────────────────────────
# 오프라인 (mock) 구현
# ─────────────────────────────────────────────────────────


@dataclass
class _OfflineState:
    jobs: dict[str, SttJob] = field(default_factory=dict)
    recordings: dict[str, Recording] = field(default_factory=dict)
    transcripts: dict[str, list[TranscriptSegmentPayload]] = field(default_factory=dict)
    summaries: dict[str, SummaryPayload] = field(default_factory=dict)


class _OfflineRepo(SupabaseRepo):
    """Supabase 가 없을 때 메모리/파일로 동작하는 더미 저장소.

    --offline 모드: 실행 시 가짜 job/recording 1건을 자동 시드합니다.
    워커 동작 흐름과 mock 엔진 통합을 검증할 수 있습니다.
    """

    def __init__(self, config: Config, audio_fixture: Path | None = None) -> None:
        self._cfg = config
        self._state = _OfflineState()
        self._audio_fixture = audio_fixture
        self._seed_demo_job()

    def _seed_demo_job(self) -> None:
        rec_id = "rec_demo"
        job_id = "job_demo"
        self._state.recordings[rec_id] = Recording(
            id=rec_id,
            audio_path="demo/sample.webm",
            audio_mime="audio/webm",
            duration_sec=0,
        )
        self._state.jobs[job_id] = SttJob(
            id=job_id,
            recording_id=rec_id,
            status="queued",
            engine="mock",
            language=self._cfg.stt_language,
            retry_count=0,
            priority=100,
        )
        logger.info("[offline] seeded demo job=%s recording=%s", job_id, rec_id)

    # ─── jobs ─────────────────────────────────────────────

    def claim_one_queued_job(self) -> SttJob | None:
        for j in self._state.jobs.values():
            if j.status == "queued":
                return j
        return None

    def mark_job_running(self, job_id: str) -> None:
        if job_id in self._state.jobs:
            self._state.jobs[job_id].status = "running"
        logger.info("[offline] job %s → running", job_id)

    def mark_job_completed(self, job_id: str, duration_ms: int) -> None:
        if job_id in self._state.jobs:
            self._state.jobs[job_id].status = "completed"
        logger.info("[offline] job %s → completed (%d ms)", job_id, duration_ms)

    def mark_job_failed(
        self, job_id: str, *, error_code: str, error_message: str, retry_count: int
    ) -> None:
        if job_id in self._state.jobs:
            self._state.jobs[job_id].status = "failed"
            self._state.jobs[job_id].retry_count = retry_count
        logger.error(
            "[offline] job %s → failed [%s] %s", job_id, error_code, error_message
        )

    # ─── recordings ───────────────────────────────────────

    def get_recording(self, recording_id: str) -> Recording | None:
        return self._state.recordings.get(recording_id)

    def update_recording(self, recording_id: str, **patch: Any) -> None:
        rec = self._state.recordings.get(recording_id)
        if not rec:
            return
        if "duration_sec" in patch and patch["duration_sec"] is not None:
            rec.duration_sec = patch["duration_sec"]
        # 다른 필드는 로그만 — 메모리만 사용
        logger.info(
            "[offline] recording %s patch: %s",
            recording_id,
            {k: v for k, v in patch.items() if v is not None},
        )

    # ─── storage ──────────────────────────────────────────

    def download_audio(self, audio_path: str, dest: Path) -> Path:
        """오디오 파일을 다운로드.

        offline 모드에서는 실제 다운로드 대신:
          - audio_fixture 가 주어졌으면 그것을 복사
          - 아니면 빈 placeholder 를 만들어 mock 엔진이 신호로만 사용
        """
        dest.parent.mkdir(parents=True, exist_ok=True)
        if self._audio_fixture and self._audio_fixture.exists():
            dest.write_bytes(self._audio_fixture.read_bytes())
            logger.info("[offline] copied fixture → %s", dest)
        else:
            dest.write_bytes(b"OFFLINE_MOCK_AUDIO\n")
            logger.info("[offline] wrote placeholder → %s", dest)
        return dest

    # ─── transcripts & summaries ──────────────────────────

    def insert_transcript_segments(
        self, recording_id: str, segments: list[TranscriptSegmentPayload]
    ) -> None:
        self._state.transcripts[recording_id] = list(segments)
        logger.info(
            "[offline] inserted %d transcript segments for %s",
            len(segments),
            recording_id,
        )

    def upsert_summary(
        self, recording_id: str, payload: SummaryPayload, created_by: str | None = None
    ) -> None:
        self._state.summaries[recording_id] = payload
        logger.info(
            "[offline] saved summary for %s (model=%s, %d bullets)",
            recording_id,
            payload.model,
            len(payload.summary),
        )

    # ─── 검증·디버깅용 ────────────────────────────────────

    def snapshot(self) -> dict[str, Any]:
        return {
            "jobs": {k: vars(v) for k, v in self._state.jobs.items()},
            "recordings": {k: vars(v) for k, v in self._state.recordings.items()},
            "transcripts": {
                k: [vars(s) for s in v] for k, v in self._state.transcripts.items()
            },
            "summaries": {k: vars(v) for k, v in self._state.summaries.items()},
        }


# ─────────────────────────────────────────────────────────
# 팩토리
# ─────────────────────────────────────────────────────────


def build_repo(
    config: Config, *, force_offline: bool = False, audio_fixture: Path | None = None
) -> SupabaseRepo:
    """설정에 맞는 저장소 구현을 반환.

    use_supabase=False, force_offline=True, 또는 supabase 패키지 미설치 시
    오프라인 모드로 폴백합니다.
    """
    if force_offline or not config.use_supabase:
        return _OfflineRepo(config, audio_fixture=audio_fixture)

    try:
        return _RealRepo(config)
    except ImportError as e:
        logger.warning("supabase 패키지 미설치 → 오프라인 모드: %s", e)
        return _OfflineRepo(config, audio_fixture=audio_fixture)
    except Exception as e:
        logger.error("Supabase 클라이언트 초기화 실패: %s", e)
        raise
