"""
Configuration loader for the STT worker.

환경변수 우선순위:
  1) 실제 환경변수
  2) .env (워커 폴더)
  3) ../../.env.local (Next.js 프로젝트 루트)

NEXT_PUBLIC_ 접두사 변수는 Next.js 측과 공유 가능. SERVICE_ROLE_KEY 는 워커 전용.
"""

from __future__ import annotations

import os
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

# ─────────────────────────────────────────────────────────
# .env 로딩 — 워커 폴더 → 프로젝트 루트 순으로 시도
# ─────────────────────────────────────────────────────────
_HERE = Path(__file__).resolve().parent
_PROJECT_ROOT = _HERE.parent.parent  # workers/stt-worker → project root

for candidate in [_HERE / ".env", _PROJECT_ROOT / ".env.local", _PROJECT_ROOT / ".env"]:
    if candidate.exists():
        load_dotenv(candidate, override=False)


EngineName = Literal["mock", "openai", "local_whisper"]


@dataclass(frozen=True)
class Config:
    # Supabase
    supabase_url: str
    supabase_service_role_key: str
    storage_bucket: str

    # 엔진 선택
    stt_engine: EngineName
    stt_language: str
    stt_model: str

    # 처리 옵션
    poll_interval_sec: float
    max_retries: int
    job_timeout_sec: int

    # 청크 분할 — 긴 오디오를 시간 단위로 나눠 처리
    chunk_sec: int           # 0=비활성. OpenAI 권장 600 (10분)
    chunk_overlap_sec: float # 청크 경계에서 겹치는 시간

    # 후처리
    use_lexicon: bool        # 잠사박물관 도메인 사전 적용 여부

    # 운영 모드
    use_supabase: bool

    # OpenAI (옵션)
    openai_api_key: str | None
    openai_model: str

    # 로컬 Whisper (옵션)
    whisper_model_size: str
    whisper_device: str  # 'cpu' | 'cuda' | 'auto'
    whisper_compute_type: str  # 'int8' | 'int8_float16' | 'float16' | 'float32' | 'auto'

    # 로깅
    log_level: str

    @property
    def is_mock(self) -> bool:
        return self.stt_engine == "mock"


def _bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _engine_name(raw: str | None) -> EngineName:
    value = (raw or "mock").strip().lower()
    if value in ("mock", "openai", "local_whisper"):
        return value  # type: ignore[return-value]
    raise ValueError(
        f"Unknown STT_ENGINE='{raw}'. Allowed: mock, openai, local_whisper"
    )


def load_config() -> Config:
    """환경변수에서 Config 를 로드합니다. 잘못된 값은 즉시 예외."""
    use_supabase = _bool("WORKER_USE_SUPABASE", default=False) or _bool(
        "NEXT_PUBLIC_USE_SUPABASE", default=False
    )

    supabase_url = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "").strip()
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()

    # mock 엔진 + offline 모드를 위해 Supabase URL/KEY 가 없어도 시작 자체는 허용.
    # 실제 fetch 시점에 use_supabase=True 인데 키가 없으면 SupabaseClient 가 에러.

    return Config(
        supabase_url=supabase_url,
        supabase_service_role_key=service_key,
        storage_bucket=os.getenv("NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET", "recordings"),
        stt_engine=_engine_name(os.getenv("STT_ENGINE")),
        stt_language=os.getenv("STT_LANGUAGE", "ko"),
        stt_model=os.getenv("STT_MODEL", "whisper-large-v3"),
        poll_interval_sec=float(os.getenv("WORKER_POLL_INTERVAL_SEC", "5")),
        max_retries=int(os.getenv("WORKER_MAX_RETRIES", "3")),
        job_timeout_sec=int(os.getenv("WORKER_JOB_TIMEOUT_SEC", "1800")),  # 30분
        chunk_sec=int(os.getenv("STT_CHUNK_SEC", "0")),
        chunk_overlap_sec=float(os.getenv("STT_CHUNK_OVERLAP_SEC", "0")),
        use_lexicon=_bool("STT_USE_LEXICON", default=True),
        use_supabase=use_supabase,
        openai_api_key=os.getenv("OPENAI_API_KEY") or None,
        openai_model=os.getenv("OPENAI_STT_MODEL", "whisper-1"),
        whisper_model_size=os.getenv("WHISPER_MODEL_SIZE", "base"),
        whisper_device=os.getenv("WHISPER_DEVICE", "auto"),
        whisper_compute_type=os.getenv("WHISPER_COMPUTE_TYPE", "auto"),
        log_level=os.getenv("LOG_LEVEL", "INFO").upper(),
    )


def setup_logging(level: str = "INFO") -> None:
    logging.basicConfig(
        level=getattr(logging, level, logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    # 외부 라이브러리 노이즈 줄이기
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("hpack").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
