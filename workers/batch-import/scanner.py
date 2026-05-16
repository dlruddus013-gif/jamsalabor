"""
파일 스캔과 메타데이터 추론.

지원 확장자: mp3, m4a, wav, webm

파일명 → recorded_at 추론 규칙 (앞에서부터 매치되는 첫 패턴 사용):
  1) ISO 형식         : 2026-04-27T05-21-00.mp3, 2026-04-27 05:21:00.m4a
  2) 한국식 슬래시      : 2026/04/27_05-21.wav
  3) 압축형 14자리     : 20260427_052100.mp3
  4) 압축형 8자리      : 20260427.mp3 (시각은 00:00:00)
  5) 매치 실패         : 파일 mtime 사용
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)

ACCEPTED_EXTS = {".mp3", ".m4a", ".wav", ".webm"}

EXT_TO_MIME = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".wav": "audio/wav",
    ".webm": "audio/webm",
}


@dataclass
class ScannedFile:
    path: Path
    size_bytes: int
    ext: str           # 소문자 ('.mp3' 등)
    mime: str
    recorded_at: datetime  # tz-aware (UTC)
    inferred_from: str     # 'filename' | 'mtime'


# ─────────────────────────────────────────────────────────
# 파일명 timestamp 추출
# ─────────────────────────────────────────────────────────

# 1) 2026-04-27T05-21-00 / 2026-04-27 05:21:00 / 2026-04-27_05-21
_RE_ISO = re.compile(
    r"(?P<y>\d{4})[-_./](?P<m>\d{2})[-_./](?P<d>\d{2})"
    r"(?:[ Tt_-](?P<h>\d{2})[-:_](?P<mi>\d{2})(?:[-:_](?P<s>\d{2}))?)?"
)

# 2) 20260427_052100 / 20260427-052100
_RE_COMPACT_14 = re.compile(
    r"(?<!\d)(?P<y>\d{4})(?P<m>\d{2})(?P<d>\d{2})[_\-](?P<h>\d{2})(?P<mi>\d{2})(?P<s>\d{2})(?!\d)"
)

# 3) 20260427 (시각 없음)
_RE_COMPACT_8 = re.compile(r"(?<!\d)(?P<y>\d{4})(?P<m>\d{2})(?P<d>\d{2})(?!\d)")


def parse_recorded_at(name: str) -> datetime | None:
    """파일명에서 timestamp 를 추론. 실패하면 None."""
    for regex in (_RE_ISO, _RE_COMPACT_14, _RE_COMPACT_8):
        m = regex.search(name)
        if not m:
            continue
        try:
            y = int(m.group("y"))
            mo = int(m.group("m"))
            d = int(m.group("d"))
            h = int(m.groupdict().get("h") or 0)
            mi = int(m.groupdict().get("mi") or 0)
            s = int(m.groupdict().get("s") or 0)
            # 합리적 범위 체크
            if y < 1990 or y > 2100:
                continue
            if not (1 <= mo <= 12 and 1 <= d <= 31):
                continue
            if not (0 <= h <= 23 and 0 <= mi <= 59 and 0 <= s <= 59):
                continue
            return datetime(y, mo, d, h, mi, s, tzinfo=timezone.utc)
        except (ValueError, KeyError):
            continue
    return None


def _from_mtime(path: Path) -> datetime:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)


# ─────────────────────────────────────────────────────────
# 스캔
# ─────────────────────────────────────────────────────────


def scan(folder: Path, recursive: bool = False) -> list[ScannedFile]:
    """폴더에서 지원 확장자 파일을 스캔."""
    if not folder.exists() or not folder.is_dir():
        raise FileNotFoundError(f"폴더를 찾을 수 없습니다: {folder}")

    pattern = "**/*" if recursive else "*"
    files: list[ScannedFile] = []
    for entry in folder.glob(pattern):
        if not entry.is_file():
            continue
        ext = entry.suffix.lower()
        if ext not in ACCEPTED_EXTS:
            continue

        recorded_at = parse_recorded_at(entry.name)
        inferred = "filename"
        if recorded_at is None:
            recorded_at = _from_mtime(entry)
            inferred = "mtime"

        files.append(
            ScannedFile(
                path=entry,
                size_bytes=entry.stat().st_size,
                ext=ext,
                mime=EXT_TO_MIME[ext],
                recorded_at=recorded_at,
                inferred_from=inferred,
            )
        )

    # 시간 순 정렬 (오래된 파일부터 업로드)
    files.sort(key=lambda f: f.recorded_at)
    return files


def iter_scan(folder: Path, recursive: bool = False) -> Iterator[ScannedFile]:
    """대용량 폴더에서도 메모리 효율적으로 스캔."""
    yield from scan(folder, recursive=recursive)


# ─────────────────────────────────────────────────────────
# 자가 검사
# ─────────────────────────────────────────────────────────

if __name__ == "__main__":
    samples = [
        "20260427_052100.mp3",
        "2026-04-27T05-21-00.m4a",
        "2026-04-27 05:21:00.wav",
        "20260427.mp3",
        "call_random_name.webm",
        "고객상담_2026-04-27_김미영.m4a",
    ]
    for name in samples:
        ts = parse_recorded_at(name)
        print(f"  {name:40s} → {ts.isoformat() if ts else '(파일 mtime 사용)'}")
