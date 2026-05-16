"""Batch import configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

# .env 자동 탐색 — 워커 폴더 → 프로젝트 루트
_HERE = Path(__file__).resolve().parent
_ROOT = _HERE.parent.parent
for cand in [_HERE / ".env", _ROOT / ".env.local", _ROOT / ".env"]:
    if cand.exists():
        load_dotenv(cand, override=False)


@dataclass(frozen=True)
class Config:
    supabase_url: str
    supabase_service_role_key: str
    storage_bucket: str
    owner_id: str | None
    stt_engine: str
    stt_language: str
    use_supabase: bool


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def load_config() -> Config:
    use_supabase = _bool("WORKER_USE_SUPABASE", default=False) or _bool(
        "NEXT_PUBLIC_USE_SUPABASE", default=False
    )

    return Config(
        supabase_url=os.getenv("NEXT_PUBLIC_SUPABASE_URL", "").strip(),
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip(),
        storage_bucket=os.getenv("NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET", "recordings"),
        # batch import 는 시스템 계정으로 수행 — owner_id 를 명시 지정하거나 NULL
        owner_id=os.getenv("BATCH_IMPORT_OWNER_ID") or None,
        stt_engine=os.getenv("STT_ENGINE", "mock"),
        stt_language=os.getenv("STT_LANGUAGE", "ko"),
        use_supabase=use_supabase,
    )
