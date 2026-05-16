"""
STTEngine base interface.

모든 엔진은 transcribe(audio_path) → STTResult 를 구현합니다.
긴 파일은 transcribe_chunked() 가 자동으로 청크 분할 후 결과를 병합합니다 —
엔진 구현은 단일 파일 기준만 작성하면 됩니다.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from engines.chunking import AudioChunk, split_audio

logger = logging.getLogger(__name__)


@dataclass
class STTSegment:
    """단일 발화 세그먼트."""

    start_sec: float
    end_sec: float
    speaker: str  # 'agent' | 'customer'
    text: str
    confidence: float | None = None


@dataclass
class STTResult:
    """전체 전사 결과."""

    segments: list[STTSegment]
    language: str
    model: str  # 사용된 모델/엔진 식별자
    duration_sec: float = 0.0
    raw: dict = field(default_factory=dict)  # 디버깅용 원본 응답

    def total_text(self) -> str:
        return "\n".join(s.text for s in self.segments)


class STTEngine(ABC):
    """모든 STT 엔진의 공통 인터페이스."""

    name: str = "base"

    @abstractmethod
    def transcribe(self, audio_path: Path, *, language: str = "ko") -> STTResult:
        """단일 오디오 파일 전사. 청크 분할 없이 호출됩니다.

        구현 시 주의:
          - audio_path 는 로컬 파일 경로
          - 실패 시 예외를 던질 것 (워커가 잡아 stt_jobs.failed 로 기록)
          - speaker 라벨링이 어려운 엔진은 일단 'customer' 단일 화자로 반환
        """
        raise NotImplementedError

    # ─────────────────────────────────────────────────────
    # 청크 처리 — 긴 파일을 분할 → 각 청크 transcribe → 결과 병합
    #
    # 모든 엔진이 공유하는 기본 구현. 엔진별로 더 효율적인 streaming
    # API 가 있다면 override 해도 됩니다.
    # ─────────────────────────────────────────────────────

    def transcribe_chunked(
        self,
        audio_path: Path,
        *,
        language: str = "ko",
        chunk_sec: int = 0,
        overlap_sec: float = 0.0,
    ) -> STTResult:
        """긴 오디오를 청크로 나눠 처리.

        chunk_sec=0 이거나 ffmpeg 미설치 시 자동으로 단일 호출 fallback.
        """
        merged_segments: list[STTSegment] = []
        languages: set[str] = set()
        models: set[str] = set()
        total_duration = 0.0
        chunk_count = 0

        with split_audio(audio_path, chunk_sec=chunk_sec, overlap_sec=overlap_sec) as chunks:
            for chunk in chunks:
                logger.info(
                    "[%s] chunk %d/%d (%.1fs–%.1fs) → %s",
                    self.name,
                    chunk.index + 1,
                    len(chunks),
                    chunk.start_sec,
                    chunk.end_sec,
                    chunk.path.name,
                )
                result = self.transcribe(chunk.path, language=language)

                # 시간 오프셋 보정 — 청크 내부 시간을 원본 기준 시간으로 시프트
                for seg in result.segments:
                    merged_segments.append(
                        STTSegment(
                            start_sec=seg.start_sec + chunk.start_sec,
                            end_sec=seg.end_sec + chunk.start_sec,
                            speaker=seg.speaker,
                            text=seg.text,
                            confidence=seg.confidence,
                        )
                    )
                if result.language:
                    languages.add(result.language)
                if result.model:
                    models.add(result.model)
                total_duration = max(total_duration, chunk.end_sec)
                chunk_count += 1

        # 청크 경계에서 중복된 발화가 생길 수 있음 (overlap 사용 시)
        if overlap_sec > 0 and chunk_count > 1:
            merged_segments = _dedupe_overlapping(merged_segments, overlap_sec)

        # 시작 시간 순 정렬 — 안전장치
        merged_segments.sort(key=lambda s: s.start_sec)

        return STTResult(
            segments=merged_segments,
            language=next(iter(languages), language),
            model=" + ".join(sorted(models)) if models else self.name,
            duration_sec=total_duration,
            raw={"chunks": chunk_count, "chunk_sec": chunk_sec},
        )


# ─────────────────────────────────────────────────────────
# 보조: overlap 영역의 중복 세그먼트 제거
# 청크 경계에서 같은 발화가 두 번 잡히는 케이스 방어.
# 단순 휴리스틱: 인접 세그먼트의 텍스트가 같고 시간이 가까우면 후자 제거.
# ─────────────────────────────────────────────────────────


def _dedupe_overlapping(
    segments: list[STTSegment], overlap_sec: float
) -> list[STTSegment]:
    if not segments:
        return segments
    out: list[STTSegment] = [segments[0]]
    for cur in segments[1:]:
        prev = out[-1]
        if (
            cur.text.strip() == prev.text.strip()
            and abs(cur.start_sec - prev.start_sec) <= overlap_sec
        ):
            continue  # 중복으로 간주
        out.append(cur)
    return out
