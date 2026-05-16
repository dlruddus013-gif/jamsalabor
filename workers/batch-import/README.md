# jamsa-vito Batch Import

기존에 보관 중인 상담 녹음파일을 한 번에 업로드해 STT 분석 큐에 등록하는 도구.

## 폴더 구조

```
workers/batch-import/
├─ main.py             # CLI 진입점
├─ scanner.py          # 폴더 스캔 + 파일명에서 timestamp 추출
├─ uploader.py         # Storage 업로드 + DB INSERT + stt_jobs 등록
├─ hashing.py          # 스트리밍 SHA-256 (대용량 안전)
├─ config.py           # 환경변수 로드
├─ requirements.txt
└─ README.md
```

## 빠른 시작

```bash
cd workers/batch-import
pip install -r requirements.txt

# 드라이런 — 실제 업로드 없이 스캔/해시/중복검사만
python main.py /path/to/audio --dry-run

# 실제 업로드 — .env 또는 프로젝트 루트의 .env.local 에 키 필요
python main.py /path/to/audio
```

## CLI 옵션

| 플래그 | 설명 |
|---|---|
| `folder` (positional) | 스캔할 로컬 폴더 |
| `--recursive`, `-r` | 하위 폴더까지 재귀 스캔 |
| `--dry-run`, `-n` | 실제 업로드 없이 시뮬레이션 |
| `--owner <uuid>` | 모든 파일을 이 user_id 로 등록 (env `BATCH_IMPORT_OWNER_ID` 보다 우선) |
| `--engine {mock,openai,local_whisper}` | `stt_jobs.engine` 값 |
| `--limit N` | 앞에서 N개만 처리 |
| `--log-level` | DEBUG/INFO/WARNING/ERROR |

## 환경변수

`config.py` 가 다음 순서로 `.env` 자동 탐색:
1. `workers/batch-import/.env`
2. 프로젝트 루트의 `.env.local`
3. 프로젝트 루트의 `.env`

| 키 | 기본값 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | — | |
| `SUPABASE_SERVICE_ROLE_KEY` | — | RLS 우회 (admin) |
| `NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET` | `recordings` | |
| `NEXT_PUBLIC_USE_SUPABASE` / `WORKER_USE_SUPABASE` | `false` | true 가 아니면 자동으로 dry-run |
| `BATCH_IMPORT_OWNER_ID` | — | 대량 import 시 일괄 owner 지정 (선택) |
| `STT_ENGINE` | `mock` | `stt_jobs.engine` 표시값 |
| `STT_LANGUAGE` | `ko` | |

## 파일명 → recorded_at 추출

`scanner.parse_recorded_at()` 가 다음 패턴을 시도합니다 (위에서부터):

| 패턴 | 예시 | 결과 |
|---|---|---|
| ISO  | `2026-04-27T05-21-00.mp3` | `2026-04-27 05:21:00 UTC` |
| 한국식 슬래시 | `2026/04/27_05-21.wav` | `2026-04-27 05:21:00 UTC` |
| 압축형 14자리 | `20260427_052100.mp3` | `2026-04-27 05:21:00 UTC` |
| 압축형 8자리 | `20260427.mp3` | `2026-04-27 00:00:00 UTC` |
| 매치 실패 | `call_random.webm` | 파일 mtime 사용 |

자가 검사:
```bash
python scanner.py
```

## 처리 흐름

1. 폴더 스캔 — 지원 확장자(.mp3 .m4a .wav .webm) 만 수집
2. 시간순 정렬 (오래된 파일부터)
3. 파일별로:
   - **SHA-256 계산** (스트리밍 — 대용량 안전)
   - **중복 검사** — `recordings.audio_sha256` 동일 row 있으면 skip
   - **Storage 업로드** — `{owner}/batch/{ts}_{name}` 경로
   - **`recordings` INSERT** — `status='processing'`, `audio_sha256`, `metadata.batch=true`
   - **`stt_jobs` INSERT** — `status='queued'`, `priority=200` (인터랙티브보다 후순위)
   - 실패 시 Storage 객체 자동 롤백
4. **진행률 표시** (`tqdm` 있으면 ETA 포함, 없으면 카운터 폴백)
5. 결과 요약 출력 — 성공/skip/실패 수, 실패 파일 목록과 사유

## 중복 방지

마이그레이션 008 이 `recordings` 에 두 가지 안전 장치를 둡니다:

- `audio_sha256 text` 컬럼
- `unique (owner_id, audio_sha256) where audio_sha256 is not null` 인덱스

같은 사용자가 같은 파일을 두 번 올리려 하면:
1. 클라이언트 측에서 `find_existing()` 이 먼저 발견해 skip
2. 그래도 race condition 으로 통과하면 DB 인덱스가 두 번째 INSERT 거부

다른 사용자는 별도 row 로 인정합니다 (개인별 업로드 이력 보존).

## 출력 예시

```
─── batch-import ───
폴더:      /home/recordings (recursive=True)
모드:      Supabase 연결
버킷:      recordings
owner_id:  3a4f...
발견: 1,247개 파일, 총 8.3 GB
  - 파일명에서 추론: 1,201  /  mtime 사용: 46

업로드 중: 100%|███████████| 1247/1247 [02:14<00:00,  9.3file/s]

────────────────────────────────────────────────────────────
  처리 완료 — 134.2초 경과
────────────────────────────────────────────────────────────
  총 파일       : 1247
  업로드 성공   : 1198 (8.0 GB)
  중복 skip     : 47
  실패          : 2
────────────────────────────────────────────────────────────
  skip 된 파일 (중복):
    · 20260301_093412.mp3 — 이미 업로드됨 (status=completed)
      → 기존 recording: 8a4f...
    · 20260301_104530.mp3 — 이미 업로드됨 (status=completed)
      → 기존 recording: 9b5c...
    … 외 45건

  실패 파일:
    × corrupted_20260315.m4a
      사유: Storage 업로드 실패: payload too large
      크기: 152.3 MB · 녹음일자: 2026-03-15T00:00:00+00:00
    × locked_file.wav
      사유: 파일 읽기 실패: [Errno 13] Permission denied: ...

  ✓ 1198건이 STT 큐에 등록되었습니다.
  → 워커 실행: cd workers/stt-worker && python main.py --drain
```

## 운영 팁

- **드라이런 먼저** — 큰 폴더는 `--dry-run` 으로 timestamp 추론과 중복 분포를 확인한 뒤 본 실행
- **STT 처리량 분리** — 배치 잡은 `priority=200` 으로 큐에 들어가므로, 인터랙티브 업로드(`priority=100`)가 먼저 처리됩니다
- **재실행 안전** — 중복 검사 덕분에 같은 명령을 다시 실행해도 이미 올라간 파일은 건너뜁니다
- **대용량** — SHA-256 은 1MB chunk 스트리밍이라 GB 단위 파일도 안전. Storage 업로드는 Supabase 기본 한도(100MB) 적용
- **권한** — service_role 키 사용. 파일은 `audio_path` 컬럼이 가리키는 경로에 저장되며, 일반 사용자는 RLS 정책에 따라 자신이 owner_id 인 row 만 보입니다
