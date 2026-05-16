"""
Mock STT engine.

실제 음성 인식 없이 고정된 샘플 transcript 를 반환합니다.
한국잠사박물관 단체 견학 상담 시나리오로, agent / customer 화자분리가
이미 적용된 상태입니다.

오디오 파일의 존재 여부만 검증 (워커 다운로드 단계가 정상 동작했는지 확인).
"""

from __future__ import annotations

import logging
from pathlib import Path

from engines.base import STTEngine, STTResult, STTSegment

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────
# 고정 샘플 (jamsa-vito mock_data 와 동일한 시나리오)
# ─────────────────────────────────────────────────────────
_SAMPLE_SEGMENTS: list[tuple[float, float, str, str]] = [
    (0,  4,  "agent",    "안녕하세요. 한국잠사박물관입니다. 무엇을 도와드릴까요."),
    (4,  9,  "customer", "안녕하세요. 저희 회사에서 단체 견학을 가려고 하는데요."),
    (9,  13, "customer", "인원이 한 60명 정도 되거든요."),
    (13, 18, "agent",    "네, 60명 단체 가능합니다. 혹시 희망하시는 날짜가 있으실까요?"),
    (18, 24, "customer", "5월 셋째 주 정도로 평일 중에 보고 있어요."),
    (24, 29, "agent",    "확인해드리겠습니다. 그리고 식사도 같이 하시는 건가요?"),
    (29, 35, "customer", "네, 가능하면 단체식당에서 점심까지 하고 싶은데요."),
    (35, 42, "agent",    "단체식당이 최대 80명까지 동시 수용 가능해서 60명이면 충분하실 거예요."),
    (42, 49, "agent",    "5월 셋째 주 가용 일자 확인해서 견적서랑 같이 보내드릴게요."),
    (49, 53, "customer", "아 좋네요. 그럼 메일로 받을게요."),
    (53, 57, "agent",    "네, 메일 주소만 한번 알려주시겠어요?"),
    (57, 64, "customer", "kim.miyoung@example.co.kr 입니다."),
    (64, 71, "agent",    "확인했습니다. 오늘 안에 견적서 보내드리겠습니다."),
    (71, 76, "customer", "네 감사합니다. 수고하세요."),
]


class MockEngine(STTEngine):
    name = "mock"

    def transcribe(self, audio_path: Path, *, language: str = "ko") -> STTResult:
        if not audio_path.exists():
            raise FileNotFoundError(f"오디오 파일을 찾을 수 없습니다: {audio_path}")

        size = audio_path.stat().st_size
        logger.info(
            "[mock] transcribing %s (%d bytes, language=%s)", audio_path, size, language
        )

        segments = [
            STTSegment(
                start_sec=float(s),
                end_sec=float(e),
                speaker=spk,
                text=text,
                confidence=0.95,
            )
            for (s, e, spk, text) in _SAMPLE_SEGMENTS
        ]
        duration = segments[-1].end_sec if segments else 0.0

        return STTResult(
            segments=segments,
            language=language,
            model="mock-stt",
            duration_sec=duration,
            raw={"source": "mock_engine", "file_size": size},
        )
