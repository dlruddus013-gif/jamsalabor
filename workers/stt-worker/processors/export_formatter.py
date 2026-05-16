"""
전사·요약 결과를 사람 친화적 텍스트로 내보내기.

CLI 의 --output 옵션이나 향후 다운로드 라우트에서 사용할 수 있는
간단한 포매터 모음입니다.
"""

from __future__ import annotations

from typing import Iterable

from engines.base import STTSegment


def _hms(sec: float) -> str:
    s = int(sec)
    m, s = divmod(s, 60)
    return f"{m:02d}:{s:02d}"


def segments_to_text(segments: Iterable[STTSegment]) -> str:
    """[MM:SS] 화자: 텍스트 형식의 plain text."""
    lines = []
    for s in segments:
        spk = "상담원" if s.speaker == "agent" else "고객"
        lines.append(f"[{_hms(s.start_sec)}] {spk}: {s.text}")
    return "\n".join(lines)


def segments_to_markdown(
    segments: Iterable[STTSegment],
    *,
    title: str | None = None,
    summary: list[str] | None = None,
    actions: list[dict] | None = None,
) -> str:
    """제목 + 요약 + 액션 + 전사 형식의 markdown."""
    out: list[str] = []
    if title:
        out.append(f"# {title}\n")

    if summary:
        out.append("## 핵심 요약\n")
        for i, s in enumerate(summary, 1):
            out.append(f"{i}. {s}")
        out.append("")

    if actions:
        out.append("## 액션 아이템\n")
        for a in actions:
            mark = "x" if a.get("done") else " "
            out.append(f"- [{mark}] {a.get('text', '')}")
        out.append("")

    out.append("## 전사\n")
    out.append("```")
    out.append(segments_to_text(segments))
    out.append("```")
    return "\n".join(out)
