# jamsa-vito STT Worker

Supabase 의 `stt_jobs` 큐에서 `queued` 상태 잡을 가져와 음성을 텍스트로 변환하고, 요약·분류·마스킹 후 `transcript_segments` 와 `recording_summaries` 에 저장하는 백그라운드 워커.

## 폴더 구조

```
workers/stt-worker/
├─ main.py                     # CLI 진입점, 잡 처리 루프
├─ config.py                   # 환경변수 로드 (.env 자동 탐색)
├─ supabase_client.py          # 실제 + offline 두 가지 저장소 구현
├─ engines/
│  ├─ base.py                  # STTEngine 추상 + transcribe_chunked 헬퍼
│  ├─ chunking.py              # ffmpeg 기반 청크 분할 + graceful fallback
│  ├─ mock_engine.py           # 잠사박물관 샘플 transcript 반환
│  ├─ openai_engine.py         # OpenAI Whisper API — 실작동
│  └─ local_whisper_engine.py  # faster-whisper 로컬 — 실작동
├─ processors/
│  ├─ lexicon.py               # 잠사박물관 도메인 후처리 사전
│  ├─ privacy_masker.py        # 휴대폰·이메일·주민번호·카드 PII 마스킹
│  ├─ classifier.py            # 카테고리·태그·감정·핸드오프 추정
│  ├─ summarizer.py            # 요약 bullet + 액션 아이템 추출
│  └─ export_formatter.py      # txt / markdown 변환
├─ requirements.txt
└─ README.md
```

## 빠른 시작 — Mock 엔진으로 끝까지 동작 확인

Supabase 키 없이도 워커 흐름을 검증할 수 있습니다.

```bash
cd workers/stt-worker
python -m venv .venv && source .venv/bin/activate
pip install python-dotenv         # mock 만 쓰면 supabase 도 불필요

# 1건 처리 후 종료, 결과 JSON 출력
python main.py --once --offline

# 결과를 파일로도 저장
python main.py --once --offline --output ./out

# 메모리 상태 스냅샷까지 출력 (디버깅)
python main.py --once --offline --print-snapshot
```

`--offline` 은 Supabase 호출을 건너뛰고 메모리 안에 데모 잡 1건을 자동으로 시드합니다. 결과는 stdout 으로 JSON 출력되고, `--output` 지정 시 `rec_demo.txt`, `rec_demo.md` 파일이 생성됩니다.

## Supabase 와 연결해 동작

```bash
pip install -r requirements.txt   # supabase, python-dotenv

# .env.local (프로젝트 루트) 또는 .env (워커 폴더) 에 키 입력
#   NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
#   SUPABASE_SERVICE_ROLE_KEY=eyJ...
#   NEXT_PUBLIC_USE_SUPABASE=true     ← 또는 WORKER_USE_SUPABASE=true
#   STT_ENGINE=mock                    ← 일단 mock 으로 검증 권장

# 큐 1건 처리 후 종료
python main.py --once

# 큐가 빌 때까지 처리
python main.py --drain

# 데몬: 5초 간격으로 폴링
python main.py --daemon
```

## CLI 옵션

| 플래그 | 설명 |
|---|---|
| `--once` | 1건만 처리 (기본) |
| `--drain` | 큐가 빌 때까지 처리 후 종료 |
| `--daemon` | 폴링 데몬 — `WORKER_POLL_INTERVAL_SEC` (기본 5초) |
| `--offline` | Supabase 없이 메모리 큐로 동작 |
| `--engine {mock,openai,local_whisper}` | env 의 `STT_ENGINE` 무시하고 강제 지정 |
| `--audio-fixture PATH` | offline 모드에서 placeholder 대신 사용할 로컬 오디오 파일 |
| `--output DIR` | 처리 결과(.txt, .md) 저장 |
| `--print-snapshot` | offline 모드 종료 시 메모리 상태 JSON 출력 |
| `--log-level LEVEL` | DEBUG / INFO / WARNING / ERROR |

## 환경변수

`config.py` 가 다음 순서로 `.env` 를 자동 로드합니다:

1. 워커 폴더의 `.env`
2. 프로젝트 루트의 `.env.local`
3. 프로젝트 루트의 `.env`

| 키 | 기본값 | 설명 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | — | Supabase URL |
| `SUPABASE_SERVICE_ROLE_KEY` | — | service role key (워커 전용) |
| `NEXT_PUBLIC_SUPABASE_AUDIO_BUCKET` | `recordings` | Storage 버킷 이름 |
| `NEXT_PUBLIC_USE_SUPABASE` / `WORKER_USE_SUPABASE` | `false` | 실제 Supabase 사용 여부 |
| `STT_ENGINE` | `mock` | `mock` / `openai` / `local_whisper` |
| `STT_LANGUAGE` | `ko` | 기본 언어 |
| `STT_MODEL` | `whisper-large-v3` | 표시용 모델명 |
| `STT_CHUNK_SEC` | `0` | 청크 길이(초). 0=비활성. OpenAI 권장 `600` |
| `STT_CHUNK_OVERLAP_SEC` | `0` | 청크 사이 겹침(초). 발화 잘림 완화용 |
| `STT_USE_LEXICON` | `true` | 잠사박물관 도메인 후처리 사전 사용 여부 |
| `WORKER_POLL_INTERVAL_SEC` | `5` | daemon 폴링 간격 |
| `WORKER_MAX_RETRIES` | `3` | 실패 잡 재시도 한도 (현재는 표시용) |
| `WORKER_JOB_TIMEOUT_SEC` | `1800` | 잡 처리 타임아웃 |
| `OPENAI_API_KEY` | — | openai 엔진 사용 시 |
| `OPENAI_STT_MODEL` | `whisper-1` | OpenAI 모델 ID |
| `WHISPER_MODEL_SIZE` | `base` | local_whisper: tiny/base/small/medium/large-v3 |
| `WHISPER_DEVICE` | `auto` | local_whisper: cpu/cuda/auto |
| `WHISPER_COMPUTE_TYPE` | `auto` | local_whisper: int8/int8_float16/float16/float32/auto |
| `LOG_LEVEL` | `INFO` | 로깅 레벨 |

## 처리 파이프라인

`main.process_job()` 의 단계별 흐름:

1. `stt_jobs` 에서 `queued` 잡 1건 → `running` 으로 갱신
2. `recordings.audio_path` 조회
3. Storage 에서 오디오 다운로드 (임시 디렉토리)
4. **STT 엔진 `transcribe_chunked()`** — `STT_CHUNK_SEC > 0` 이면 ffmpeg 로 자동 분할 후 시간 오프셋을 보정해 병합. ffmpeg 미설치/짧은 파일이면 단일 호출 fallback
5. `lexicon` 후처리 — 잠사박물관 도메인 어휘 교정 (장사→잠사, 누엔→누에, 양태정원→양떼정원, …)
6. `privacy_masker` PII 마스킹
7. `classifier` 카테고리·태그·감정·excerpt·escalated/resolved 추정
8. `summarizer` 요약 bullet + 액션 아이템 추출
9. `transcript_segments` 일괄 INSERT (200개 단위)
10. `recording_summaries` INSERT (트리거가 이전 `is_current=true` 자동 해제)
11. `recordings` UPDATE → `status='completed'`, duration, sentiment, excerpt, category, tags
12. `stt_jobs` → `completed` (duration_ms 기록)
13. 옵션: `--output` 지정 시 `.txt` `.md` 내보내기

실패 시:
- `stt_jobs.status='failed'`, `error_code`, `error_message` (스택 일부 포함), `retry_count` 증가
- `recordings.status='failed'` 로 갱신

## 엔진 추가하기

1. `engines/` 에 새 파일 작성, `STTEngine` 상속
2. `transcribe(audio_path, language)` 구현 — `STTResult` 반환. 청크 처리는 부모의 `transcribe_chunked()` 가 자동
3. `main.build_engine()` 의 분기에 추가
4. `config.py` 의 `EngineName` 타입과 `_engine_name()` 검증 갱신

새 엔진의 시간 좌표는 **항상 0초부터** 시작하면 됩니다. 청크 분할 시 부모 클래스가 각 청크의 오프셋만큼 시프트해 합쳐줍니다.

## OpenAI / Local Whisper 활성화

두 엔진 모두 실제 작동 코드가 들어있고, 의존성·환경변수만 갖추면 즉시 사용 가능합니다.

### OpenAI Whisper API
```bash
pip install openai

# .env
OPENAI_API_KEY=sk-...
STT_ENGINE=openai
STT_CHUNK_SEC=600          # 25MB 한도 회피 (10분 권장)
```

### Local — faster-whisper
```bash
# 시스템에 ffmpeg 설치 필요 (청크 분할에도 사용)
sudo apt install ffmpeg     # 또는 brew install ffmpeg
pip install faster-whisper

# .env
STT_ENGINE=local_whisper
WHISPER_MODEL_SIZE=base     # tiny → 빠름, large-v3 → 정확
WHISPER_DEVICE=auto         # GPU 자동 감지
WHISPER_COMPUTE_TYPE=auto   # CPU=int8, GPU=float16
```

> 첫 실행 시 모델이 자동 다운로드되며 ~/.cache/huggingface 에 캐시됩니다.

## 한국어 후처리 사전

`processors/lexicon.py` 가 잠사박물관 콜센터 도메인 어휘 교정을 담당합니다. 흔한 STT 오인식을 정답으로 치환:

| 오인식 → 교정 | 예시 |
|---|---|
| 장사 박물관 → 잠사박물관 | "장사박물관 견학 가능한가요" → "잠사박물관 …" |
| 누엔 / 누애 → 누에 | "누엔 체험" → "누에 체험" |
| 양태 정원 → 양떼정원 | "양 태정원 가는 길" → "양떼정원 …" |
| 에어 마운스 → 에어바운스 | |
| 사계절 서매장 → 사계절썰매장 | |
| 키즈 카페 → 키즈카페 | |
| 단체 예약 → 단체예약 | |
| 뽕앞 → 뽕잎 / 오 디 → 오디 | |
| `60 명` → `60명` (숫자+단위 붙이기) | |

`STT_USE_LEXICON=false` 로 비활성화 가능.
사전 확장은 `_VOCABULARY` 리스트에 `(["오인식", ...], "정답")` 페어를 추가하면 됩니다. 모듈 단독 실행으로 빠른 검증:
```bash
python -m processors.lexicon
```

## 운영 시 고려사항

- **동시성**: 현재 `claim_one_queued_job()` 은 단순 SELECT → UPDATE 라 다중 워커에서 race condition 가능. Postgres function `select … for update skip locked` 로 교체 권장.
- **재시도**: `retry_count` 만 증가하고 자동 재시도는 미구현. `cron` 또는 별도 스케줄러로 `failed` + `retry_count < max_retries` 잡을 다시 `queued` 로 돌리는 작업 필요.
- **타임아웃**: 잡 단위 hard timeout 미적용. 장시간 hang 방지를 위해 `signal.alarm` 또는 별도 프로세스 매니저 활용.
- **PII**: 정규식 기반 마스킹은 100% 보장 불가. 민감 데이터 환경에서는 NER 모델 도입 검토.
- **요약 비용**: 현재 mock summarizer 는 무료. Claude API 로 교체 시 토큰 사용량을 `recording_summaries.tokens_input/output` 에 기록하도록 설계되어 있습니다.
