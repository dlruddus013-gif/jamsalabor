"""
긴 오디오 파일을 청크로 나눠 처리하기 위한 유틸.

설계:
  - ffmpeg/ffprobe 가 시스템에 설치되어 있으면 시간 기반으로 분할.
  - 없거나 실패하면 분할 없이 전체 파일을 그대로 반환 (단일 청크).
    → 엔진별 자체 처리 한도를 넘어서면 엔진이 에러를 던지지만,
      대부분의 짧은 통화에는 분할이 불필요하므로 graceful fallback.
  - 분할 결과는 (start_offset_sec, chunk_path) 튜플 리스트.

엔진은 STTEngine.transcribe_chunked() 를 통해 이 모듈을 활용합니다.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────
# 사용 가능 여부 검사
# ─────────────────────────────────────────────────────────


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None


def has_ffprobe() -> bool:
    return shutil.which("ffprobe") is not None


# ─────────────────────────────────────────────────────────
# 길이 측정
# ─────────────────────────────────────────────────────────


def get_duration_sec(audio_path: Path) -> float | None:
    """ffprobe 로 오디오 길이를 초 단위로 반환. 실패 시 None."""
    if not has_ffprobe():
        return None
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(audio_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if out.returncode != 0:
            logger.warning("ffprobe failed: %s", out.stderr.strip())
            return None
        return float(out.stdout.strip())
    except (ValueError, subprocess.TimeoutExpired, OSError) as e:
        logger.warning("ffprobe error: %s", e)
        return None


# ─────────────────────────────────────────────────────────
# 청크 분할
# ─────────────────────────────────────────────────────────


@dataclass
class AudioChunk:
    index: int
    start_sec: float        # 원본 기준 오프셋
    end_sec: float          # 원본 기준 오프셋 (분할 시점 기준 추정값)
    path: Path


@contextmanager
def split_audio(
    audio_path: Path,
    chunk_sec: int,
    overlap_sec: float = 0.0,
) -> Iterator[list[AudioChunk]]:
    """오디오를 chunk_sec 길이로 분할.

    - chunk_sec 가 0 이거나 ffmpeg 미설치 시: 전체 파일을 단일 청크로 반환.
    - 분할이 성공하면 임시 디렉토리를 자동 정리하는 컨텍스트 매니저.
    - overlap_sec: 청크 사이에 겹침 — 발화가 잘리는 문제 완화 (기본 0).

    사용:
        with split_audio(path, chunk_sec=600) as chunks:
            for c in chunks:
                ...  # c.path 로 STT 호출, 결과 시간에 c.start_sec 더하기
    """
    duration = get_duration_sec(audio_path)

    # 분할 불필요 / 불가
    if (
        chunk_sec <= 0
        or not has_ffmpeg()
        or duration is None
        or duration <= chunk_sec
    ):
        if not has_ffmpeg() and duration is None:
            logger.info("ffmpeg/ffprobe 미설치 — 분할 없이 단일 청크로 처리")
        single = [
            AudioChunk(
                index=0,
                start_sec=0.0,
                end_sec=duration if duration is not None else 0.0,
                path=audio_path,
            )
        ]
        yield single
        return

    # 실제 분할
    with tempfile.TemporaryDirectory(prefix="stt-chunk-") as tmpdir:
        tmp = Path(tmpdir)
        chunks: list[AudioChunk] = []
        idx = 0
        start = 0.0
        while start < duration:
            end = min(start + chunk_sec + overlap_sec, duration)
            out_path = tmp / f"chunk_{idx:03d}{audio_path.suffix or '.wav'}"
            cmd = [
                "ffmpeg",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(audio_path),
                "-ss",
                f"{start:.3f}",
                "-to",
                f"{end:.3f}",
                "-c",
                "copy",  # 가능하면 재인코딩 없이 빠르게
                str(out_path),
            ]
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if res.returncode != 0:
                # copy 실패 시 재인코딩으로 재시도 (컨테이너 호환성 문제일 수 있음)
                cmd_reenc = [
                    "ffmpeg",
                    "-loglevel",
                    "error",
                    "-y",
                    "-i",
                    str(audio_path),
                    "-ss",
                    f"{start:.3f}",
                    "-to",
                    f"{end:.3f}",
                    "-vn",
                    "-acodec",
                    "libmp3lame",
                    str(out_path.with_suffix(".mp3")),
                ]
                res2 = subprocess.run(
                    cmd_reenc, capture_output=True, text=True, timeout=300
                )
                if res2.returncode != 0:
                    raise RuntimeError(
                        f"ffmpeg chunk split failed at {start}s: {res2.stderr.strip()}"
                    )
                out_path = out_path.with_suffix(".mp3")

            chunks.append(
                AudioChunk(
                    index=idx,
                    start_sec=start,
                    end_sec=end,
                    path=out_path,
                )
            )
            idx += 1
            start += chunk_sec  # 다음 청크 시작점 (overlap 은 종료점에만 적용)

        logger.info(
            "split %s into %d chunks of ~%ds (duration=%.1fs)",
            audio_path.name,
            len(chunks),
            chunk_sec,
            duration,
        )
        yield chunks
