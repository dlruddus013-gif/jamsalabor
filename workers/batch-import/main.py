"""
Batch import entrypoint.

사용 예:
  # 드라이런 — 실제 업로드 없이 스캔·해시·중복 검사만
  python main.py /path/to/audio --dry-run

  # 실제 업로드 (.env 또는 .env.local 에 SUPABASE_SERVICE_ROLE_KEY 필요)
  python main.py /path/to/audio

  # 하위 폴더까지 재귀 스캔
  python main.py /path/to/audio --recursive

  # 모든 파일을 특정 owner 로 등록
  python main.py /path/to/audio --owner 00000000-0000-0000-0000-000000000001
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

from config import Config, load_config
from scanner import scan
from uploader import BatchUploader, ImportOutcome

# ─────────────────────────────────────────────────────────
# 진행률 — tqdm 이 없으면 폴백
# ─────────────────────────────────────────────────────────

try:
    from tqdm import tqdm  # type: ignore
    _HAS_TQDM = True
except ImportError:
    _HAS_TQDM = False


def _progress(iterable, total: int, desc: str):
    if _HAS_TQDM:
        return tqdm(iterable, total=total, desc=desc, unit="file", dynamic_ncols=True)
    # 폴백: 한 줄짜리 카운터
    counter = {"i": 0}

    def gen():
        for item in iterable:
            counter["i"] += 1
            sys.stdout.write(f"\r[{counter['i']:>4}/{total}] {desc}")
            sys.stdout.flush()
            yield item
        sys.stdout.write("\n")

    return gen()


# ─────────────────────────────────────────────────────────
# 결과 집계
# ─────────────────────────────────────────────────────────


@dataclass
class Summary:
    total: int = 0
    imported: int = 0
    skipped: int = 0
    failed: int = 0
    bytes_imported: int = 0
    elapsed_sec: float = 0.0
    failures: list[ImportOutcome] = field(default_factory=list)
    skips: list[ImportOutcome] = field(default_factory=list)


# ─────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────


def parse_args(argv=None):
    p = argparse.ArgumentParser(
        prog="batch-import",
        description="기존 상담 녹음파일을 일괄 업로드합니다.",
    )
    p.add_argument("folder", type=Path, help="스캔할 로컬 폴더 경로")
    p.add_argument("--recursive", "-r", action="store_true", help="하위 폴더까지 재귀 스캔")
    p.add_argument(
        "--dry-run",
        "-n",
        action="store_true",
        help="실제 업로드 없이 스캔·해시·중복검사만 수행 (Supabase 연결도 생략)",
    )
    p.add_argument(
        "--owner",
        type=str,
        default=None,
        help="모든 파일을 이 user_id 로 등록 (env BATCH_IMPORT_OWNER_ID 보다 우선)",
    )
    p.add_argument(
        "--engine",
        choices=["mock", "openai", "local_whisper"],
        default=None,
        help="stt_jobs.engine 값 (env STT_ENGINE 보다 우선)",
    )
    p.add_argument(
        "--limit",
        type=int,
        default=None,
        help="N개만 처리 후 종료 (테스트용)",
    )
    p.add_argument("--log-level", default="INFO", help="DEBUG/INFO/WARNING/ERROR")
    return p.parse_args(argv)


def setup_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)


# ─────────────────────────────────────────────────────────
# 메인
# ─────────────────────────────────────────────────────────


def main(argv=None) -> int:
    args = parse_args(argv)
    setup_logging(args.log_level)
    log = logging.getLogger("batch-import")

    # Config 로드 + CLI 오버라이드
    config = load_config()
    if args.owner:
        config = Config(**{**config.__dict__, "owner_id": args.owner})
    if args.engine:
        config = Config(**{**config.__dict__, "stt_engine": args.engine})

    log.info("─── batch-import ───")
    log.info("폴더:      %s (recursive=%s)", args.folder, args.recursive)
    log.info(
        "모드:      %s",
        "dry-run (실제 업로드 안 함)" if args.dry_run or not config.use_supabase else "Supabase 연결",
    )
    if config.use_supabase:
        log.info("버킷:      %s", config.storage_bucket)
        log.info(
            "owner_id:  %s",
            config.owner_id or "(NULL — 시스템 계정 업로드)",
        )

    # 1) 스캔
    try:
        files = scan(args.folder, recursive=args.recursive)
    except FileNotFoundError as e:
        log.error("%s", e)
        return 2

    if args.limit:
        files = files[: args.limit]

    if not files:
        log.warning("지원 확장자(.mp3 .m4a .wav .webm) 파일이 없습니다.")
        return 0

    total_bytes = sum(f.size_bytes for f in files)
    log.info(
        "발견: %d개 파일, 총 %s",
        len(files),
        _human_size(total_bytes),
    )
    log.info(
        "  - 파일명에서 추론: %d  /  mtime 사용: %d",
        sum(1 for f in files if f.inferred_from == "filename"),
        sum(1 for f in files if f.inferred_from == "mtime"),
    )

    # 2) 업로더
    try:
        uploader = BatchUploader(config, dry_run=args.dry_run)
    except RuntimeError as e:
        log.error("%s", e)
        return 2

    # 3) 처리 루프
    summary = Summary(total=len(files))
    started = time.time()

    for sf in _progress(files, total=len(files), desc="업로드 중"):
        outcome = uploader.import_one(sf)
        if outcome.status == "imported":
            summary.imported += 1
            summary.bytes_imported += sf.size_bytes
        elif outcome.status == "skipped":
            summary.skipped += 1
            summary.skips.append(outcome)
        else:
            summary.failed += 1
            summary.failures.append(outcome)

    summary.elapsed_sec = time.time() - started

    # 4) 결과 출력
    print()
    print_summary(summary)

    return 0 if summary.failed == 0 else 1


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024  # type: ignore[assignment]
    return f"{n:.1f} TB"


# ─────────────────────────────────────────────────────────
# 결과 요약 출력
# ─────────────────────────────────────────────────────────


def print_summary(s: Summary) -> None:
    line = "─" * 60
    print(line)
    print(f"  처리 완료 — {s.elapsed_sec:.1f}초 경과")
    print(line)
    print(f"  총 파일       : {s.total}")
    print(f"  업로드 성공   : {s.imported} ({_human_size(s.bytes_imported)})")
    print(f"  중복 skip     : {s.skipped}")
    print(f"  실패          : {s.failed}")
    print(line)

    if s.skips:
        print("  skip 된 파일 (중복):")
        for o in s.skips[:20]:
            print(f"    · {o.file.path.name} — {o.reason}")
            if o.recording_id:
                print(f"      → 기존 recording: {o.recording_id}")
        if len(s.skips) > 20:
            print(f"    … 외 {len(s.skips) - 20}건")
        print()

    if s.failures:
        print("  실패 파일:")
        for o in s.failures:
            print(f"    × {o.file.path.name}")
            print(f"      사유: {o.reason}")
            print(f"      크기: {_human_size(o.file.size_bytes)} · "
                  f"녹음일자: {o.file.recorded_at.isoformat()}")
        print()

    if s.imported > 0:
        print(f"  ✓ {s.imported}건이 STT 큐에 등록되었습니다.")
        print(f"  → 워커 실행: cd workers/stt-worker && python main.py --drain")


if __name__ == "__main__":
    sys.exit(main())
