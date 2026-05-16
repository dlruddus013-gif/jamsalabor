"""
Storage 업로드 + recordings INSERT + stt_jobs 큐 등록.

핵심 동작:
  - 기존에 동일 SHA256 으로 등록된 recording 이 있으면 skip (중복 방지)
  - Storage 경로: {owner_id 또는 'system'}/batch/{timestamp}_{safe_name}
  - recordings.status = 'processing', source = 'upload', metadata = {batch: true, ...}
  - stt_jobs.status = 'queued'
"""

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from pathlib import Path

from config import Config
from hashing import sha256_of
from scanner import ScannedFile

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────
# 결과 타입
# ─────────────────────────────────────────────────────────


@dataclass
class ImportOutcome:
    file: ScannedFile
    status: str          # 'imported' | 'skipped' | 'failed'
    recording_id: str | None
    job_id: str | None
    sha256: str | None
    reason: str | None   # skipped/failed 사유


# ─────────────────────────────────────────────────────────
# 보조
# ─────────────────────────────────────────────────────────


def _sanitize(name: str, max_len: int = 60) -> str:
    base = re.sub(r"[^\w.\-]+", "_", name).strip("_")
    return base[:max_len] or "audio"


# ─────────────────────────────────────────────────────────
# 메인 업로더
# ─────────────────────────────────────────────────────────


class BatchUploader:
    """Supabase 모드 + 오프라인(드라이런) 두 가지로 동작."""

    def __init__(self, config: Config, dry_run: bool = False) -> None:
        self._cfg = config
        self._dry_run = dry_run or not config.use_supabase
        self._client = None  # lazy

        if not self._dry_run:
            if not config.supabase_url or not config.supabase_service_role_key:
                raise RuntimeError(
                    "Supabase 키가 누락되었습니다. .env 에 NEXT_PUBLIC_SUPABASE_URL "
                    "와 SUPABASE_SERVICE_ROLE_KEY 를 설정하거나 --dry-run 으로 시도하세요."
                )
            from supabase import create_client  # type: ignore

            self._client = create_client(
                config.supabase_url, config.supabase_service_role_key
            )

    # ── 중복 검사 ─────────────────────────────────────────

    def find_existing(self, sha256: str) -> dict | None:
        """audio_sha256 로 기존 레코드 검색."""
        if self._dry_run:
            return None
        assert self._client is not None
        resp = (
            self._client.table("recordings")
            .select("id, audio_path, status")
            .eq("audio_sha256", sha256)
            .limit(1)
            .execute()
        )
        rows = resp.data or []
        return rows[0] if rows else None

    # ── 단일 파일 import ─────────────────────────────────

    def import_one(self, sf: ScannedFile) -> ImportOutcome:
        # 1) 해시 (대용량 안전)
        try:
            digest = sha256_of(sf.path)
        except OSError as e:
            return ImportOutcome(
                file=sf,
                status="failed",
                recording_id=None,
                job_id=None,
                sha256=None,
                reason=f"파일 읽기 실패: {e}",
            )

        # 2) 중복 검사
        existing = self.find_existing(digest)
        if existing:
            return ImportOutcome(
                file=sf,
                status="skipped",
                recording_id=existing.get("id"),
                job_id=None,
                sha256=digest,
                reason=f"이미 업로드됨 (status={existing.get('status')})",
            )

        # 3) Storage 경로
        owner_seg = self._cfg.owner_id or "system"
        ts = int(sf.recorded_at.timestamp())
        safe = _sanitize(sf.path.name)
        path = f"{owner_seg}/batch/{ts}_{safe}"

        # 4) Dry-run: 시뮬레이션만
        if self._dry_run:
            logger.info(
                "[dry-run] would upload %s (%d bytes) → %s",
                sf.path.name,
                sf.size_bytes,
                path,
            )
            return ImportOutcome(
                file=sf,
                status="imported",
                recording_id=f"dry_{digest[:12]}",
                job_id=f"dry_job_{digest[:12]}",
                sha256=digest,
                reason=None,
            )

        # 5) Storage 업로드
        assert self._client is not None
        try:
            with sf.path.open("rb") as f:
                self._client.storage.from_(self._cfg.storage_bucket).upload(
                    path,
                    f,
                    {
                        "content-type": sf.mime,
                        "cache-control": "3600",
                        "upsert": "false",
                    },
                )
        except Exception as e:  # supabase storage 는 다양한 에러 타입을 던짐
            return ImportOutcome(
                file=sf,
                status="failed",
                recording_id=None,
                job_id=None,
                sha256=digest,
                reason=f"Storage 업로드 실패: {e}",
            )

        # 6) recordings INSERT
        recording_id: str | None = None
        try:
            resp = (
                self._client.table("recordings")
                .insert(
                    {
                        "owner_id": self._cfg.owner_id,
                        "recorded_at": sf.recorded_at.isoformat(),
                        "duration_sec": 0,  # 워커가 STT 후 채움
                        "audio_path": path,
                        "audio_mime": sf.mime,
                        "audio_size_bytes": sf.size_bytes,
                        "audio_sha256": digest,
                        "status": "processing",
                        "source": "upload",
                        "metadata": {
                            "batch": True,
                            "original_filename": sf.path.name,
                            "recorded_at_inferred_from": sf.inferred_from,
                        },
                    }
                )
                .execute()
            )
            row = (resp.data or [{}])[0]
            recording_id = row.get("id")
        except Exception as e:
            # 롤백: 방금 올린 Storage 객체 제거
            self._rollback_storage(path)
            return ImportOutcome(
                file=sf,
                status="failed",
                recording_id=None,
                job_id=None,
                sha256=digest,
                reason=f"DB INSERT 실패: {e}",
            )

        if not recording_id:
            self._rollback_storage(path)
            return ImportOutcome(
                file=sf,
                status="failed",
                recording_id=None,
                job_id=None,
                sha256=digest,
                reason="DB INSERT 응답에 id 없음",
            )

        # 7) stt_jobs INSERT (실패해도 recording 은 살아있게 — 워커가 수동 재큐 가능)
        job_id: str | None = None
        try:
            resp = (
                self._client.table("stt_jobs")
                .insert(
                    {
                        "recording_id": recording_id,
                        "status": "queued",
                        "engine": self._cfg.stt_engine if self._cfg.stt_engine != "mock"
                                  else "whisper-large-v3",
                        "language": self._cfg.stt_language,
                        "priority": 200,  # batch 는 인터랙티브보다 후순위
                    }
                )
                .execute()
            )
            row = (resp.data or [{}])[0]
            job_id = row.get("id")
        except Exception as e:
            logger.warning("stt_jobs insert 실패 (recording=%s): %s", recording_id, e)

        return ImportOutcome(
            file=sf,
            status="imported",
            recording_id=recording_id,
            job_id=job_id,
            sha256=digest,
            reason=None,
        )

    # ── 내부: 실패 시 Storage 롤백 ───────────────────────

    def _rollback_storage(self, path: str) -> None:
        if self._dry_run or self._client is None:
            return
        try:
            self._client.storage.from_(self._cfg.storage_bucket).remove([path])
        except Exception as e:
            logger.error("Storage 롤백 실패 (%s): %s", path, e)
