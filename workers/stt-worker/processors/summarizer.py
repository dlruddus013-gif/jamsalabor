"""
요약 생성기.

현재는 추출형(extractive) mock — 키워드 빈도와 문장 위치 기반으로
중요 발화를 골라 bullet 요약과 액션 아이템을 만듭니다.

추후 Anthropic Claude API 로 교체할 자리. 인터페이스(summarize)는 동일하게 유지합니다.
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from typing import Iterable

from engines.base import STTSegment

# ─────────────────────────────────────────────────────────
# 액션 아이템 트리거
# 후속 조치를 약속하는 표현이 포함된 발화를 액션으로 추출
# ─────────────────────────────────────────────────────────
_ACTION_TRIGGERS = [
    "보내드릴",
    "보내드리",
    "발송",
    "안내드리",
    "확인해드리",
    "확인 후",
    "회신",
    "콜백",
    "전송",
    "메일",
    "처리",
    "접수",
]

# 핵심 정보 트리거 — 요약 bullet 후보
_INFO_TRIGGERS = [
    "60명", "50명", "40명", "30명", "20명",
    "단체", "견학", "식사", "환불", "결제", "예약",
    "5월", "6월", "7월", "셋째 주", "둘째 주", "넷째 주", "평일",
    "회원권", "양도", "장애인", "복지카드",
    "VR", "체험", "키즈카페",
]


@dataclass
class SummaryResult:
    summary: list[str]
    action_items: list[dict]
    key_topics: list[str]
    sentiment: str | None
    model: str


def _split_sentences(text: str) -> list[str]:
    """한국어 문장 단위 분리 (단순)."""
    text = text.strip()
    if not text:
        return []
    parts = re.split(r"(?<=[.?!。])\s+|(?<=[다요])(?=\s|$)", text)
    return [p.strip() for p in parts if p and p.strip()]


def _score_sentence(sent: str) -> int:
    return sum(sent.count(t) for t in _INFO_TRIGGERS)


def _is_action(sent: str) -> bool:
    return any(t in sent for t in _ACTION_TRIGGERS)


def _extract_topics(segments: Iterable[STTSegment], limit: int = 5) -> list[str]:
    text = " ".join(s.text for s in segments)
    counter: dict[str, int] = {}
    for t in _INFO_TRIGGERS:
        c = text.count(t)
        if c > 0:
            counter[t] = c
    ranked = sorted(counter.items(), key=lambda kv: -kv[1])
    return [k for k, _ in ranked[:limit]]


def summarize(
    segments: list[STTSegment],
    *,
    sentiment_hint: str | None = None,
) -> SummaryResult:
    """전사 세그먼트로부터 요약/액션/토픽을 추출합니다."""

    if not segments:
        return SummaryResult(
            summary=[],
            action_items=[],
            key_topics=[],
            sentiment=sentiment_hint,
            model="mock-summarizer-v1",
        )

    # ─ 후보 문장 모으기 ────────────────────────────────────
    sentences: list[tuple[int, str, str]] = []  # (idx, speaker, sentence)
    for i, seg in enumerate(segments):
        for sent in _split_sentences(seg.text):
            sentences.append((i, seg.speaker, sent))

    # ─ 액션 아이템: 상담원이 약속한 후속 조치 ─────────────────
    actions: list[dict] = []
    seen_action_text: set[str] = set()
    for i, spk, sent in sentences:
        if spk != "agent":
            continue
        if not _is_action(sent):
            continue
        # 너무 짧은 인사·끝맺음은 제외
        if len(sent) < 10:
            continue
        if sent in seen_action_text:
            continue
        seen_action_text.add(sent)
        actions.append(
            {
                "id": f"act_{uuid.uuid4().hex[:8]}",
                "text": sent.rstrip(".?!"),
                "done": False,
            }
        )

    # ─ 요약 bullet: 정보 점수 상위 N + 첫 customer 의도 ─────
    bullets: list[str] = []
    seen_bullets: set[str] = set()

    # 1) 첫 customer 발화 (의도)
    for _i, spk, sent in sentences:
        if spk == "customer" and len(sent) > 8:
            bullets.append(sent.rstrip(".?!"))
            seen_bullets.add(sent)
            break

    # 2) 정보 점수 상위
    scored = sorted(
        ((s, sent) for (_i, _spk, sent) in sentences for s in [_score_sentence(sent)]),
        key=lambda x: -x[0],
    )
    for score, sent in scored:
        if score <= 0:
            break
        if sent in seen_bullets:
            continue
        if len(sent) < 10:
            continue
        bullets.append(sent.rstrip(".?!"))
        seen_bullets.add(sent)
        if len(bullets) >= 4:
            break

    # 3) 액션이 있으면 마지막 bullet 으로 요약
    if actions and len(bullets) < 5:
        bullets.append(f"후속 조치 {len(actions)}건 약속됨")

    topics = _extract_topics(segments)

    return SummaryResult(
        summary=bullets,
        action_items=actions,
        key_topics=topics,
        sentiment=sentiment_hint,
        model="mock-summarizer-v1",
    )
