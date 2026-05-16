"""
간단한 키워드 기반 분류기.

추후 Claude / 모델 기반 분류로 교체할 자리이며, 현재는
잠사박물관 콜센터 도메인의 주요 카테고리·태그를 키워드 매칭으로 추정합니다.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from engines.base import STTSegment

# ─────────────────────────────────────────────────────────
# 카테고리 사전
# ─────────────────────────────────────────────────────────
_CATEGORIES: list[tuple[str, list[str]]] = [
    ("환불",       ["환불", "취소", "결제 취소", "돌려"]),
    ("단체 견적",   ["단체", "견적", "60명", "50명", "40명", "30명", "20명", "유치원", "학교", "회사"]),
    ("예약",       ["예약", "회원권", "양도", "연간"]),
    ("운영시간",    ["운영시간", "오픈", "영업시간", "닫나요", "여나요"]),
    ("교통",       ["주차", "오시는 길", "길찾기", "차량", "버스", "지하철"]),
    ("정책",       ["할인", "장애인", "복지카드", "어린이", "경로"]),
    ("시설",       ["VR", "체험", "썰매", "키즈카페", "양떼", "전시"]),
    ("문의",       []),  # fallback
]

# ─────────────────────────────────────────────────────────
# 태그 사전 — 카테고리보다 결이 좁은 자유 키워드
# ─────────────────────────────────────────────────────────
_TAGS: dict[str, list[str]] = {
    "단체":     ["단체", "회사", "기업"],
    "견학":     ["견학", "탐방"],
    "식사":     ["식사", "점심", "도시락", "식당"],
    "B2B":      ["회사", "기업", "법인"],
    "환불":     ["환불", "취소"],
    "결제":     ["결제", "카드", "계좌이체"],
    "날씨":     ["비", "눈", "태풍", "날씨"],
    "유치원":    ["유치원", "어린이집"],
    "회원권":    ["회원권", "연간권"],
    "양도":     ["양도"],
    "장애인":    ["장애인", "복지카드"],
    "할인":     ["할인", "감면"],
    "교통":     ["주차", "오시는 길", "버스"],
    "VR":       ["VR"],
}

# ─────────────────────────────────────────────────────────
# 감정 분류 — 표면적 어휘 기반
# ─────────────────────────────────────────────────────────
_NEGATIVE = ["환불", "취소", "불만", "화", "짜증", "안돼", "불편", "실망", "최악", "왜"]
_POSITIVE = ["감사", "좋네요", "좋아요", "친절", "확인했", "확정", "수고하"]


@dataclass
class Classification:
    category: str
    sentiment: str  # 'pos' | 'neu' | 'neg'
    tags: list[str]
    excerpt: str
    escalated: bool
    resolved: bool


def _full_text(segments: Iterable[STTSegment]) -> str:
    return "\n".join(s.text for s in segments)


def _customer_text(segments: Iterable[STTSegment]) -> str:
    return "\n".join(s.text for s in segments if s.speaker == "customer")


def _first_customer_excerpt(segments: Iterable[STTSegment], max_len: int = 60) -> str:
    for s in segments:
        if s.speaker == "customer" and s.text.strip():
            t = s.text.strip()
            return t if len(t) <= max_len else t[: max_len - 1] + "…"
    # fallback: 첫 발화
    for s in segments:
        if s.text.strip():
            t = s.text.strip()
            return t if len(t) <= max_len else t[: max_len - 1] + "…"
    return ""


def classify_call(segments: list[STTSegment]) -> Classification:
    text = _full_text(segments)
    cust_text = _customer_text(segments)

    # ─ 카테고리: 가장 많이 매치된 사전이 승리 ────────────────
    best_cat = "문의"
    best_hits = 0
    for cat, kws in _CATEGORIES:
        if not kws:
            continue
        hits = sum(text.count(k) for k in kws)
        if hits > best_hits:
            best_hits = hits
            best_cat = cat

    # ─ 태그 ───────────────────────────────────────────────
    tags: list[str] = []
    for tag, kws in _TAGS.items():
        if any(k in text for k in kws):
            tags.append(tag)

    # ─ 감정 ───────────────────────────────────────────────
    neg = sum(text.count(k) for k in _NEGATIVE)
    pos = sum(text.count(k) for k in _POSITIVE)
    if neg > pos and neg > 0:
        sentiment = "neg"
    elif pos > neg and pos > 0:
        sentiment = "pos"
    else:
        sentiment = "neu"

    # ─ 발췌 ───────────────────────────────────────────────
    excerpt = _first_customer_excerpt(segments)

    # ─ 핸드오프(추정): 환불·견적·콜백·메일 발송 등 후속 액션이 약속된 경우 ─
    escalated = any(
        kw in text
        for kw in ["견적서", "콜백", "회신", "메일로 받", "다시 연락", "담당자"]
    )

    # ─ 해결(추정): 마지막 customer 발화에 감사/긍정 어휘 ─────
    last_cust = ""
    for s in reversed(segments):
        if s.speaker == "customer" and s.text.strip():
            last_cust = s.text
            break
    resolved = any(k in last_cust for k in ["감사", "수고하", "알겠습니다"])

    return Classification(
        category=best_cat,
        sentiment=sentiment,
        tags=tags,
        excerpt=excerpt,
        escalated=escalated,
        resolved=resolved,
    )
