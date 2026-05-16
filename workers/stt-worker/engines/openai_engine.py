"""
OpenAI Whisper API STT engine.

활성화:
  pip install openai>=1.0
  export OPENAI_API_KEY=sk-...
  export STT_ENGINE=openai

OpenAI Whisper API 는 단일 요청당 25MB 한도가 있습니다. 긴 파일은
부모 클래스의 transcribe_chunked() 가 ffmpeg 로 자동 분할해 호출합니다.
권장 chunk 길이: 600초(10분) 내외 — 환경변수 STT_CHUNK_SEC 로 조정.

화자분리는 API 단독으로 제공되지 않으므로, 모든 세그먼트가 'customer'
단일 화자로 반환됩니다. 화자분리가 필요하면 별도 diarization 단계를
파이프라인에 추가하세요.
"""

from __future__ import annotations

import logging
from pathlib import Path

from engines.base import STTEngine, STTResult, STTSegment

logger = logging.getLogger(__name__)


class OpenAIEngine(STTEngine):
    name = "openai"

    def __init__(
        self,
        api_key: str | None,
        model: str = "whisper-1",
    ) -> None:
        if not api_key:
            raise RuntimeError(
                "OPENAI_API_KEY 가 설정되지 않았습니다. "
                "STT_ENGINE=mock 으로 변경하거나 .env 에 키를 입력하세요."
            )
        # 지연 import — openai 패키지가 설치되지 않아도 mock 모드는 동작해야 함
        try:
            from openai import OpenAI  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "openai 패키지가 설치되어 있지 않습니다. "
                "`pip install openai>=1.0` 후 다시 실행하세요."
            ) from e

        self._client = OpenAI(api_key=api_key)
        self._model = model

    def transcribe(self, audio_path: Path, *, language: str = "ko") -> STTResult:
        if not audio_path.exists():
            raise FileNotFoundError(f"오디오 파일 없음: {audio_path}")

        size = audio_path.stat().st_size
        # 25MB 한도 초과 가능성 — 사전 경고 (분할은 transcribe_chunked 에서)
        if size > 25 * 1024 * 1024:
            logger.warning(
                "[openai] 파일 크기 %.1fMB 가 25MB 한도를 넘습니다. "
                "transcribe_chunked() 로 호출하거나 STT_CHUNK_SEC 를 설정하세요.",
                size / 1024 / 1024,
            )

        with audio_path.open("rb") as f:
            resp = self._client.audio.transcriptions.create(
                model=self._model,
                file=f,
                language=language,
                response_format="verbose_json",
                timestamp_granularities=["segment"],
            )

        # SDK 응답은 dict 또는 pydantic 모델일 수 있음 — 양쪽 모두 처리
        raw_segments = _extract_segments(resp)
        segments = [
            STTSegment(
                start_sec=float(s.get("start", 0.0)),
                end_sec=float(s.get("end", 0.0)),
                speaker="customer",  # API 단독으로는 화자분리 없음
                text=str(s.get("text", "")).strip(),
                confidence=None,
            )
            for s in raw_segments
            if str(s.get("text", "")).strip()
        ]

        return STTResult(
            segments=segments,
            language=_get_attr(resp, "language") or language,
            model=self._model,
            duration_sec=float(_get_attr(resp, "duration") or 0.0),
            raw={"engine": "openai", "model": self._model},
        )


# ─────────────────────────────────────────────────────────
# 보조 — SDK 응답 정규화
# ─────────────────────────────────────────────────────────


def _get_attr(obj, key: str):
    """dict / pydantic model 양쪽에서 안전하게 값 가져오기."""
    if obj is None:
        return None
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _extract_segments(resp) -> list[dict]:
    segs = _get_attr(resp, "segments")
    if not segs:
        return []
    out: list[dict] = []
    for s in segs:
        if isinstance(s, dict):
            out.append(s)
        elif hasattr(s, "model_dump"):
            out.append(s.model_dump())
        else:
            out.append(
                {
                    "start": getattr(s, "start", 0),
                    "end": getattr(s, "end", 0),
                    "text": getattr(s, "text", ""),
                }
            )
    return out
