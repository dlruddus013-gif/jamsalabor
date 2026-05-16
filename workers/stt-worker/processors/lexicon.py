"""
한국어 상담용 후처리 사전.

STT 엔진은 도메인 고유명사를 잘못 옮겨 적기 쉽습니다 (예: '잠사' → '장사', '누에' → '누엔').
이 모듈은 흔한 오인식을 잠사박물관 도메인 어휘로 교정합니다.

설계 원칙:
  - 보수적으로: 너무 광범위한 패턴은 오히려 오교정을 만듭니다.
    - 한국어 어절 경계가 모호하므로 '단어' 보다는 '구' 단위로 매칭합니다.
    - "씨" 같은 한 글자는 절대 교정하지 않습니다.
  - 결정적으로: 같은 입력에 항상 같은 출력. 통계가 아닌 사전 + 정규식.
  - 확장 가능: lexicon dict 만 늘리면 별도 코드 변경 없음.

사용법:
    from processors.lexicon import postprocess_text, postprocess_segments
    text = postprocess_text("장사 박물관 누엔 체험")
    # → "잠사 박물관 누에 체험"
"""

from __future__ import annotations

import re
from dataclasses import replace
from typing import Iterable

from engines.base import STTSegment


# ─────────────────────────────────────────────────────────
# 1) 단순 치환 사전 — 흔한 오인식 → 정답
#
# 키는 정규식 패턴(어절 단위로 가두기 위해 보통 (?<!\S) ... (?!\S) 사용),
# 값은 치환 문자열입니다. 치환은 사전 등록 순서대로 한 번씩만 적용됩니다.
# ─────────────────────────────────────────────────────────

# (오인식 후보, 정답) 페어. 후보는 한 항목당 여러 표기 가능.
_VOCABULARY: list[tuple[list[str], str]] = [
    # ── 잠사·박물관 핵심 어휘 ─────────────────────────────
    (["장사 박물관", "잠사박 물관", "잠사 박 물관"], "잠사박물관"),
    (["한국 잠사", "한국 장사"], "한국잠사"),

    # 누에 — '누엔', '누애', '누엥' 등
    (["누엔", "누애", "누엥", "누에이"], "누에"),

    # 오디(뽕나무 열매)
    (["오 디", "오디 열매"], "오디"),

    # 뽕잎 — '뽕앞', '봉잎' 등
    (["뽕앞", "뽕 잎", "봉잎"], "뽕잎"),

    # 명주실 / 견사
    (["명주 실", "명 주실"], "명주실"),

    # ── 시설명 ────────────────────────────────────────────
    (["눈 썰매장", "눈썰매 장", "눈서매장"], "눈썰매장"),
    (["사계절 썰매장", "사계절 서매장"], "사계절썰매장"),
    (["양떼 정원", "양 떼정원", "양태정원", "양태 정원"], "양떼정원"),
    (["에어 바운스", "에어바 운스", "에어 마운스"], "에어바운스"),
    (["키즈 카페", "키즈카 페"], "키즈카페"),
    (["디지털 키즈카페", "디지털 키즈 카페"], "디지털 키즈카페"),

    # ── 운영·예약 어휘 ───────────────────────────────────
    (["단체 예약"], "단체예약"),
    (["연간 회원권", "연간회 원권"], "연간회원권"),
    (["단체 식당"], "단체식당"),
    (["단체 견학"], "단체 견학"),  # 띄어쓰기 정규화

    # ── 자주 쓰는 명사 ───────────────────────────────────
    (["견적 서"], "견적서"),
    (["입장 권"], "입장권"),
]


# ─────────────────────────────────────────────────────────
# 2) 보조: 띄어쓰기·문장부호 정리
# ─────────────────────────────────────────────────────────

_RE_MULTI_SPACE = re.compile(r"[ \t]{2,}")
_RE_SPACE_BEFORE_PUNCT = re.compile(r"\s+([,.?!])")
_RE_NUMBER_UNIT = re.compile(r"(\d+)\s*(명|분|시간|시|개|건|월|일|주|만원|원)")


def _normalize_whitespace(text: str) -> str:
    """다중 공백·문장부호 앞 공백 정리."""
    text = _RE_MULTI_SPACE.sub(" ", text)
    text = _RE_SPACE_BEFORE_PUNCT.sub(r"\1", text)
    return text.strip()


def _normalize_number_unit(text: str) -> str:
    """'60 명' → '60명' 같은 숫자+단위 붙이기."""
    return _RE_NUMBER_UNIT.sub(r"\1\2", text)


# ─────────────────────────────────────────────────────────
# 3) 사전 컴파일 — 모듈 로드 시 한 번만
#
# 각 후보 표기를 어절 경계 기반 정규식으로 변환.
# (?<!\S) ... (?!\S) — 앞뒤가 공백이거나 줄경계여야 매치 (한국어 친화)
# ─────────────────────────────────────────────────────────

def _compile_rules() -> list[tuple[re.Pattern[str], str]]:
    rules: list[tuple[re.Pattern[str], str]] = []
    for variants, canonical in _VOCABULARY:
        for v in variants:
            # 띄어쓰기는 1개 이상 공백 허용
            pattern = re.escape(v).replace(r"\ ", r"\s+")
            # 앞 경계: 단어 시작이거나 공백/문장부호 뒤
            # 뒤 경계: (한국어 조사가 붙을 수 있으므로) 풀어둠 — 단,
            #         숫자/영문이 바로 이어지는 경우는 제외
            rules.append(
                (re.compile(rf"(?<![가-힣A-Za-z0-9]){pattern}(?![A-Za-z0-9])"), canonical)
            )
    return rules


_RULES: list[tuple[re.Pattern[str], str]] = _compile_rules()


# ─────────────────────────────────────────────────────────
# 4) 공개 API
# ─────────────────────────────────────────────────────────


def postprocess_text(text: str) -> str:
    """단일 문자열에 후처리 사전을 적용합니다."""
    if not text:
        return text
    out = text
    for pattern, replacement in _RULES:
        out = pattern.sub(replacement, out)
    out = _normalize_number_unit(out)
    out = _normalize_whitespace(out)
    return out


def postprocess_segments(segments: Iterable[STTSegment]) -> list[STTSegment]:
    """세그먼트 리스트의 text 를 후처리한 새 리스트를 반환 (불변)."""
    return [replace(s, text=postprocess_text(s.text)) for s in segments]


# ─────────────────────────────────────────────────────────
# 5) 자가 검사
# ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    samples = [
        "장사 박물관 누엔 체험을 원해요",
        "양 떼정원에서 에어 마운스 타고 싶어요",
        "60 명 단체 예약 가능한가요",
        "사계절 서매장 운영 시간 알려주세요",
        "뽕앞 오 디 따기 체험이요",
        "키즈 카페랑 눈 썰매장도 가나요",
    ]
    for s in samples:
        print(f"  {s}\n→ {postprocess_text(s)}\n")
