"""
PII 마스킹.

전사 결과에서 휴대폰·이메일·주민등록번호·카드번호 같은 개인정보를
정규식으로 찾아 마스킹된 문자열로 교체합니다.

운영 시 주의:
  - 정규식만으로는 100% 보장이 어렵습니다. 고민감 환경에서는 별도 NER 모델 도입.
  - DB 에는 마스킹된 텍스트를 저장하고, 원본은 service_role 만 접근 가능한
    별도 컬럼/테이블에 보관하는 것이 권장됩니다 (현재는 마스킹된 단일 저장).
"""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Iterable

from engines.base import STTSegment

# ─────────────────────────────────────────────────────────
# 패턴 정의
# 순서 중요: 더 길고 구체적인 패턴 먼저
# ─────────────────────────────────────────────────────────
_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    # 주민등록번호: 6자리-7자리
    (re.compile(r"\b(\d{6})[- ]?(\d{7})\b"), r"\1-*******"),
    # 카드번호: 16자리 (4-4-4-4 또는 연속)
    (re.compile(r"\b(\d{4})[- ]?\d{4}[- ]?\d{4}[- ]?(\d{4})\b"), r"\1-****-****-\2"),
    # 휴대폰: 010-XXXX-XXXX, 010 XXXX XXXX, 01012345678
    (re.compile(r"\b(01[016789])[- ]?(\d{3,4})[- ]?(\d{4})\b"), r"\1-\2-****"),
    # 일반 전화: 02-XXX-XXXX, 0XX-XXX-XXXX
    (re.compile(r"\b(0\d{1,2})[- ](\d{3,4})[- ](\d{4})\b"), r"\1-\2-****"),
    # 이메일: 로컬파트 일부 마스킹
    (
        re.compile(r"\b([A-Za-z0-9._%+-]{1,3})[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b"),
        r"\1***@\2",
    ),
    # 계좌번호: 8자리 이상 연속 숫자 (휴대폰/주민/카드 보다 뒤)
    (re.compile(r"\b\d{8,16}\b"), r"********"),
]


def mask_text(text: str) -> str:
    """단일 문자열의 PII 를 마스킹."""
    if not text:
        return text
    out = text
    for pattern, replacement in _PATTERNS:
        out = pattern.sub(replacement, out)
    return out


def mask_segments(segments: Iterable[STTSegment]) -> list[STTSegment]:
    """세그먼트 리스트의 text 를 모두 마스킹한 새 리스트를 반환 (불변)."""
    return [replace(s, text=mask_text(s.text)) for s in segments]


# ─────────────────────────────────────────────────────────
# 자가 검사 — 직접 실행 시 빠른 sanity check
# ─────────────────────────────────────────────────────────
if __name__ == "__main__":
    samples = [
        "010-1234-5678 로 연락주세요",
        "주민번호 901231-1234567",
        "카드 1234-5678-9012-3456 으로 결제",
        "이메일 kim.miyoung@example.co.kr",
        "계좌 1100123456789",
        "02-235-1267 로 전화 주세요",
    ]
    for s in samples:
        print(f"  {s}\n→ {mask_text(s)}\n")
