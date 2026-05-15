# 잠사플레이팜 통합 시스템

한국잠사박물관 직원관리 + 세무/금융 연동 통합 웹앱
Vercel + Supabase 기반 배포

---

## 구성

```
jamsalabor/
├── public/
│   └── index.html              # 번들된 프런트 (잠사박물관 관리시스템)
├── api/
│   └── index.py                # FastAPI 세무/금융 API (Vercel Python Serverless)
├── supabase/
│   └── migrations/
│       └── 0001_finance.sql    # 거래처/세금계산서/은행 테이블
├── requirements.txt            # Python 의존성
├── vercel.json                 # Vercel 라우팅
└── .env.example                # 환경변수 템플릿
```

---

## 1) Supabase 세팅

1. <https://supabase.com> 접속 → 새 프로젝트 생성 (서울 리전 권장)
2. 좌측 메뉴 **SQL Editor** → `supabase/migrations/0001_finance.sql` 내용 전체 복사·붙여넣기 → **Run** 클릭
3. **Project Settings → Database → Connection string** → **URI** 탭 → **"Use connection pooling"** 체크 후 복사
   - 포트는 반드시 `6543` (PgBouncer Transaction pooling)
   - 형식: `postgresql://postgres.<ref>:<password>@aws-0-...pooler.supabase.com:6543/postgres`
4. 비밀번호를 실제 DB 비밀번호로 치환

---

## 2) Vercel 배포

1. <https://vercel.com/new> 접속 → **Import Git Repository**
2. `dlruddus013-gif/jamsalabor` 선택 → **Import**
3. **Environment Variables** 섹션에서 추가:
   - `DATABASE_URL` = 위 1번 4단계의 Supabase Pooler URL
4. **Deploy** 클릭
5. 빌드 완료 후 부여된 도메인(`<프로젝트명>.vercel.app`)으로 접속

### 라우팅 동작

- `/` → `public/index.html` (정적 프런트엔드)
- `/api/*` → `api/index.py`의 FastAPI 라우트
- 예: `https://<도메인>/api/health` 로 헬스체크 가능

---

## 3) API 자격증명 등록 (배포 후)

`api_credentials` 테이블에 4개 제공자(`nts`, `nh`, `openbanking`, `popbill`)가 시드돼 있습니다. 다음 방법 중 하나로 키를 채워주세요.

### 방법 A: Supabase SQL Editor

```sql
update api_credentials
   set credentials = '{"service_key":"<공공데이터포털 발급키>","base_url":"https://api.odcloud.kr/api/nts-businessman/v1"}'
 where provider = 'nts';

update api_credentials
   set credentials = '{"access_token":"<NH 토큰>","iscd":"<기관코드>","base_url":"https://developers.nonghyup.com"}'
 where provider = 'nh';

update api_credentials
   set credentials = '{"access_token":"<오픈뱅킹 토큰>","client_id":"...","client_secret":"...","base_url":"https://openapi.openbanking.or.kr"}'
 where provider = 'openbanking';
```

### 방법 B: API 호출

```bash
curl -X POST https://<도메인>/api/finance/settings \
  -H "Content-Type: application/json" \
  -d '{"provider":"nts","credentials":{"service_key":"...","base_url":"https://api.odcloud.kr/api/nts-businessman/v1"}}'
```

---

## API 엔드포인트 (요약)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET  | `/api/health` | 헬스체크 (DB 연결 여부 포함) |
| POST | `/api/finance/nts/status` | 사업자 상태조회 (국세청) |
| POST | `/api/finance/nts/validate` | 사업자 진위확인 |
| POST | `/api/finance/nh/depositor` | NH 예금주조회 |
| POST | `/api/finance/nh/balance` | NH 잔액조회 |
| POST | `/api/finance/nh/transactions` | NH 거래내역 |
| POST | `/api/finance/openbanking/balance` | 오픈뱅킹 잔액 |
| POST | `/api/finance/openbanking/transactions` | 오픈뱅킹 거래내역 |
| POST | `/api/finance/invoice/create` | 세금계산서 생성 |
| POST | `/api/finance/receipt/create` | 현금영수증 생성 |
| POST | `/api/finance/match-deposits` | 입금-예약 자동매칭 |
| GET  | `/api/finance/partners` | 거래처 목록 |
| GET  | `/api/finance/invoices` | 세금계산서 목록 |
| GET  | `/api/finance/transactions` | 은행 거래내역 |
| GET  | `/api/finance/reservations` | 예약 목록 |
| GET/POST | `/api/finance/settings` | API 자격증명 조회/저장 |

---

## 로컬 개발 (선택)

```bash
pip install -r requirements.txt
export DATABASE_URL="postgresql://..."
uvicorn api.index:app --reload --port 8000
```

프런트엔드는 `public/index.html`을 브라우저로 열면 됨.
