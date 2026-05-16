"""
Local STT engine — faster-whisper 기반.

faster-whisper 는 OpenAI 의 Whisper 를 CTranslate2 로 재구현해 CPU/GPU 에서
2~4배 빠르게 동작합니다. 오프라인·온프레미스 환경에 적합합니다.

활성화:
  pip install faster-whisper
  export STT_ENGINE=local_whisper
  export WHISPER_MODEL_SIZE=base       # tiny | base | small | medium | large-v3
  export WHISPER_DEVICE=auto           # cpu | cuda | auto
  export WHISPER_COMPUTE_TYPE=auto     # int8 | int8_float16 | float16 | float32 | auto

긴 파일은 자체 VAD/스트리밍을 지원하지만, 파이프라인 일관성을 위해
부모 클래스의 transcribe_chunked() 도 그대로 쓸 수 있게 만들었습니다.
"""

from __future__ import annotations

import logging
from pathlib import Path

from engines.base import STTEngine, STTResult, STTSegment

logger = logging.getLogger(__name__)


class LocalWhisperEngine(STTEngine):
    name = "local_whisper"

    def __init__(
        self,
        model_size: str = "base",
        device: str = "auto",
        compute_type: str = "auto",
    ) -> None:
        self._model_size = model_size
        self._device_pref = device
        self._compute_type_pref = compute_type
        self._model = None  # lazy

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        try:
            from faster_whisper import WhisperModel  # type: ignore
        except ImportError as e:
            raise RuntimeError(
                "faster-whisper 패키지가 설치되어 있지 않습니다. "
                "`pip install faster-whisper` 후 다시 실행하세요."
            ) from e

        device = self._resolve_device(self._device_pref)
        compute_type = self._resolve_compute_type(
            self._compute_type_pref, device
        )

        logger.info(
            "[local_whisper] loading: model=%s device=%s compute_type=%s",
            self._model_size,
            device,
            compute_type,
        )
        # CTranslate2 가 모델을 자동 다운로드 (HuggingFace 캐시)
        self._model = WhisperModel(
            self._model_size,
            device=device,
            compute_type=compute_type,
        )

    def transcribe(self, audio_path: Path, *, language: str = "ko") -> STTResult:
        self._ensure_loaded()
        if not audio_path.exists():
            raise FileNotFoundError(f"오디오 파일 없음: {audio_path}")

        # faster-whisper 는 generator 를 반환 — list 로 소비해야 실제 디코딩
        segments_iter, info = self._model.transcribe(  # type: ignore
            str(audio_path),
            language=language,
            beam_size=5,
            vad_filter=True,                 # 묵음 자동 제외 — 정확도 향상
            vad_parameters={"min_silence_duration_ms": 500},
            condition_on_previous_text=True, # 문맥 유지
        )

        segments: list[STTSegment] = []
        for s in segments_iter:
            text = (s.text or "").strip()
            if not text:
                continue
            # avg_logprob 는 음수 — 1 + logprob/N 로 0~1 근사
            conf = None
            if s.avg_logprob is not None:
                conf = max(0.0, min(1.0, 1.0 + s.avg_logprob / 5.0))
            segments.append(
                STTSegment(
                    start_sec=float(s.start),
                    end_sec=float(s.end),
                    speaker="customer",  # 화자분리 별도 단계에서
                    text=text,
                    confidence=conf,
                )
            )

        return STTResult(
            segments=segments,
            language=info.language or language,
            model=f"local-whisper-{self._model_size}",
            duration_sec=float(info.duration or 0),
            raw={
                "engine": "local_whisper",
                "model": self._model_size,
                "language_probability": info.language_probability,
            },
        )

    # ─────────────────────────────────────────────────────
    # 디바이스/연산 타입 자동 결정
    # ─────────────────────────────────────────────────────

    @staticmethod
    def _resolve_device(pref: str) -> str:
        if pref != "auto":
            return pref
        try:
            import torch  # type: ignore
            return "cuda" if torch.cuda.is_available() else "cpu"
        except ImportError:
            return "cpu"

    @staticmethod
    def _resolve_compute_type(pref: str, device: str) -> str:
        if pref != "auto":
            return pref
        # GPU 면 float16, CPU 면 int8 이 일반적으로 가장 빠름
        return "float16" if device == "cuda" else "int8"
