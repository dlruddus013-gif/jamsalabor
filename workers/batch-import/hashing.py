"""Streaming SHA-256 helper for large audio files."""

from __future__ import annotations

import hashlib
from pathlib import Path

CHUNK = 1 << 20  # 1 MiB


def sha256_of(path: Path) -> str:
    """파일의 SHA-256 (소문자 hex 64자)."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        while True:
            buf = f.read(CHUNK)
            if not buf:
                break
            h.update(buf)
    return h.hexdigest()
