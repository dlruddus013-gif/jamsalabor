"""
잠사플레이팜 세무/금융 연동 API
Vercel Python Serverless Function (ASGI - FastAPI)

환경변수:
  DATABASE_URL — Supabase Postgres 연결 문자열
                 권장: 풀러(Supabase Connection Pooling, 포트 6543) URL 사용
                 예: postgresql://postgres.<ref>:<pwd>@aws-0-...pooler.supabase.com:6543/postgres
"""
import json
import os
import urllib.request as _urllib
from datetime import datetime

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

# ─── DB 연결 ───
DATABASE_URL = os.environ.get("DATABASE_URL", "")
_engine = None
_SessionLocal = None
if DATABASE_URL:
    _engine = create_engine(
        DATABASE_URL,
        pool_pre_ping=True,
        pool_size=1,
        max_overflow=0,
        connect_args={"sslmode": "require"},
    )
    _SessionLocal = sessionmaker(bind=_engine, autocommit=False, autoflush=False)


def get_db():
    if _SessionLocal is None:
        raise RuntimeError("DATABASE_URL 환경변수가 설정되지 않았습니다")
    db = _SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── FastAPI 앱 ───
app = FastAPI(title="JamsaLabor Finance API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "service": "jamsalabor-finance-api",
        "db_configured": _SessionLocal is not None,
        "ts": datetime.utcnow().isoformat() + "Z",
    }


# ─── 공통: API 자격증명 로드 ───
def _get_cred(provider: str, db: Session) -> dict:
    try:
        row = db.execute(
            text("SELECT credentials FROM api_credentials WHERE provider=:p AND is_active=true"),
            {"p": provider},
        ).mappings().first()
        if not row:
            return {}
        c = row["credentials"]
        return c if isinstance(c, dict) else json.loads(c)
    except Exception:
        return {}


# ═══════════════ 1. 국세청 사업자 조회 ═══════════════

@app.post("/api/finance/nts/status")
async def nts_biz_status(request: Request, db: Session = Depends(get_db)):
    """사업자등록 상태조회 (국세청 공공데이터포털)"""
    data = await request.json()
    biz_nos = data.get("biz_nos", [])
    if not biz_nos:
        return {"ok": False, "error": "사업자번호를 입력하세요"}

    cred = _get_cred("nts", db)
    service_key = cred.get("service_key", "")
    if not service_key:
        return {"ok": False, "error": "국세청 API 키 미설정. /api/finance/settings에서 설정하세요."}

    url = f"https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey={service_key}&returnType=JSON"
    payload = json.dumps({"b_no": biz_nos}).encode("utf-8")

    try:
        req = _urllib.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with _urllib.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        for item in result.get("data", []):
            bno = item.get("b_no", "")
            db.execute(text("""
                INSERT INTO business_partners (biz_no, corp_name, nts_status, nts_status_code, nts_tax_type, nts_verified_at)
                VALUES (:bno, :bno, :stt, :stt_cd, :tax, now())
                ON CONFLICT (biz_no) DO UPDATE SET
                    nts_status=:stt, nts_status_code=:stt_cd, nts_tax_type=:tax, nts_verified_at=now()
            """), {
                "bno": bno,
                "stt": item.get("b_stt", ""),
                "stt_cd": item.get("b_stt_cd", ""),
                "tax": item.get("tax_type", ""),
            })
        db.commit()
        return {"ok": True, "data": result.get("data", []), "count": len(result.get("data", []))}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


@app.post("/api/finance/nts/validate")
async def nts_biz_validate(request: Request, db: Session = Depends(get_db)):
    """사업자 진위확인"""
    data = await request.json()
    cred = _get_cred("nts", db)
    service_key = cred.get("service_key", "")
    if not service_key:
        return {"ok": False, "error": "국세청 API 키 미설정"}

    url = f"https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey={service_key}&returnType=JSON"
    payload = json.dumps({"businesses": [data]}).encode("utf-8")

    try:
        req = _urllib.Request(url, data=payload, headers={"Content-Type": "application/json"})
        with _urllib.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        valid = result.get("data", [{}])[0].get("valid", "") == "01"
        bno = data.get("b_no", "")
        if bno:
            db.execute(
                text("UPDATE business_partners SET nts_valid=:v, nts_verified_at=now() WHERE biz_no=:bno"),
                {"v": valid, "bno": bno},
            )
            db.commit()
        return {"ok": True, "valid": valid, "data": result.get("data", [])}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# ═══════════════ 2. NH농협 API ═══════════════

def _nh_header(api_nm: str, cred: dict) -> dict:
    now = datetime.now()
    return {
        "ApiNm": api_nm,
        "Tsymd": now.strftime("%Y%m%d"),
        "Trtm": now.strftime("%H%M%S"),
        "Iscd": cred.get("iscd", ""),
        "FintechApsno": "001",
        "ApiSvcCd": "ReceivedTransferA",
        "IsTuno": now.strftime("%Y%m%d") + "0000000001",
        "AccessToken": cred.get("access_token", ""),
    }


@app.post("/api/finance/nh/depositor")
async def nh_depositor(request: Request, db: Session = Depends(get_db)):
    """NH 예금주조회"""
    data = await request.json()
    cred = _get_cred("nh", db)
    if not cred.get("access_token"):
        return {"ok": False, "error": "NH API 토큰 미설정"}

    payload = {
        "Header": _nh_header("InquireDepositorAccountNumber", cred),
        "Bncd": data.get("bank_code", "011"),
        "Acno": data.get("account_no", ""),
    }
    try:
        req = _urllib.Request(
            f"{cred.get('base_url', 'https://developers.nonghyup.com')}/InquireDepositorAccountNumber.nh",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with _urllib.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        return {"ok": True, "depositor_name": result.get("Dpnm", ""), "data": result}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


@app.post("/api/finance/nh/balance")
async def nh_balance(request: Request, db: Session = Depends(get_db)):
    """NH 잔액조회"""
    data = await request.json()
    cred = _get_cred("nh", db)
    if not cred.get("access_token"):
        return {"ok": False, "error": "NH API 토큰 미설정"}

    payload = {"Header": _nh_header("InquireBalance", cred), "FinAcno": data.get("fin_acno", "")}
    try:
        req = _urllib.Request(
            f"{cred.get('base_url', 'https://developers.nonghyup.com')}/InquireBalance.nh",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with _urllib.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        balance = int(result.get("Ldbl", "0"))
        db.execute(
            text("UPDATE bank_accounts SET balance=:b, balance_updated_at=now() WHERE fin_acno=:fa"),
            {"b": balance, "fa": data.get("fin_acno", "")},
        )
        db.commit()
        return {"ok": True, "balance": balance, "data": result}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


@app.post("/api/finance/nh/transactions")
async def nh_transactions(request: Request, db: Session = Depends(get_db)):
    """NH 거래내역조회"""
    data = await request.json()
    cred = _get_cred("nh", db)
    if not cred.get("access_token"):
        return {"ok": False, "error": "NH API 토큰 미설정"}

    payload = {
        "Header": _nh_header("InquireTransactionHistory", cred),
        "Bncd": data.get("bank_code", "011"),
        "Acno": data.get("account_no", ""),
        "Insymd": data.get("from_date", ""),
        "Ineymd": data.get("to_date", ""),
        "TrnsDsnc": data.get("tran_type", "A"),
        "Lnsq": "DESC",
        "PageNo": str(data.get("page", 1)),
        "Dmcnt": str(data.get("count", 100)),
    }
    try:
        req = _urllib.Request(
            f"{cred.get('base_url', 'https://developers.nonghyup.com')}/InquireTransactionHistory.nh",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with _urllib.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))

        account = db.execute(
            text("SELECT id FROM bank_accounts WHERE account_no=:acno LIMIT 1"),
            {"acno": data.get("account_no", "")},
        ).mappings().first()
        account_id = account["id"] if account else None

        saved = 0
        for t in result.get("REC", []):
            try:
                db.execute(text("""
                    INSERT INTO bank_transactions (account_id, tran_date, tran_time, inout_type, amount, balance_after, print_content, source)
                    VALUES (:aid, :td, :tt, :io, :amt, :bal, :pc, 'nh_api')
                """), {
                    "aid": account_id,
                    "td": t.get("Trdd", ""),
                    "tt": t.get("Txtm", ""),
                    "io": "입금" if t.get("MnrcDrotDsnc") == "1" else "출금",
                    "amt": int(t.get("Tram", "0")),
                    "bal": int(t.get("AftrBlnc", "0")),
                    "pc": t.get("BnprCntn", ""),
                })
                saved += 1
            except Exception:
                pass
        db.commit()
        return {"ok": True, "transactions": result.get("REC", []), "saved": saved}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# ═══════════════ 3. 금융결제원 오픈뱅킹 ═══════════════

@app.post("/api/finance/openbanking/balance")
async def ob_balance(request: Request, db: Session = Depends(get_db)):
    """오픈뱅킹 잔액조회"""
    data = await request.json()
    cred = _get_cred("openbanking", db)
    if not cred.get("access_token"):
        return {"ok": False, "error": "오픈뱅킹 토큰 미설정"}

    params = (
        f"fintech_use_num={data.get('fintech_use_num','')}"
        f"&bank_tran_id=F000000000U0000000000"
        f"&tran_dtime={datetime.now().strftime('%Y%m%d%H%M%S')}"
    )
    url = f"{cred.get('base_url','https://openapi.openbanking.or.kr')}/v2.0/account/balance/fin_num?{params}"
    try:
        req = _urllib.Request(url, headers={"Authorization": f"Bearer {cred['access_token']}"})
        with _urllib.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        if result.get("rsp_code") == "A0000":
            balance = int(result.get("balance_amt", "0"))
            db.execute(
                text("UPDATE bank_accounts SET balance=:b, balance_updated_at=now() WHERE fintech_use_num=:fn"),
                {"b": balance, "fn": data.get("fintech_use_num", "")},
            )
            db.commit()
            return {"ok": True, "balance": balance, "bank_name": result.get("bank_name"), "data": result}
        return {"ok": False, "error": result.get("rsp_message", "조회 실패")}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


@app.post("/api/finance/openbanking/transactions")
async def ob_transactions(request: Request, db: Session = Depends(get_db)):
    """오픈뱅킹 거래내역조회"""
    data = await request.json()
    cred = _get_cred("openbanking", db)
    if not cred.get("access_token"):
        return {"ok": False, "error": "오픈뱅킹 토큰 미설정"}

    params = "&".join([
        "bank_tran_id=F000000000U0000000001",
        f"fintech_use_num={data.get('fintech_use_num','')}",
        "inquiry_type=A&inquiry_base=D",
        f"from_date={data.get('from_date','')}&from_time=000000",
        f"to_date={data.get('to_date','')}&to_time=235959",
        "sort_order=D",
        f"tran_dtime={datetime.now().strftime('%Y%m%d%H%M%S')}",
    ])
    url = f"{cred.get('base_url','https://openapi.openbanking.or.kr')}/v2.0/account/transaction_list/fin_num?{params}"
    try:
        req = _urllib.Request(url, headers={"Authorization": f"Bearer {cred['access_token']}"})
        with _urllib.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
        transactions = result.get("res_list", [])
        return {"ok": True, "transactions": transactions, "count": len(transactions), "data": result}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# ═══════════════ 4. 세금계산서 / 현금영수증 ═══════════════

@app.post("/api/finance/invoice/create")
async def create_invoice(request: Request, db: Session = Depends(get_db)):
    """전자세금계산서 생성 (DB 저장)"""
    data = await request.json()
    now = datetime.now()
    mgt_key = f"JAMSA-{now.strftime('%Y%m%d')}-{str(now.microsecond)[:4].zfill(4)}"

    db.execute(text("""
        INSERT INTO tax_invoices (mgt_key, issue_date, buyer_biz_no, buyer_name, buyer_ceo, buyer_email,
            supply_cost, tax_amount, total_amount, items, purpose_type, tax_type, status)
        VALUES (:mk, :id, :bno, :bn, :bc, :be, :sc, :ta, :tot, :items, :pt, :tt, 'draft')
    """), {
        "mk": mgt_key,
        "id": data.get("issue_date", now.strftime("%Y-%m-%d")),
        "bno": data.get("buyer_biz_no", ""),
        "bn": data.get("buyer_name", ""),
        "bc": data.get("buyer_ceo", ""),
        "be": data.get("buyer_email", ""),
        "sc": data.get("supply_cost", 0),
        "ta": data.get("tax_amount", 0),
        "tot": data.get("total_amount", 0),
        "items": json.dumps(data.get("items", []), ensure_ascii=False),
        "pt": data.get("purpose_type", "영수"),
        "tt": data.get("tax_type", "과세"),
    })
    db.commit()
    return {"ok": True, "mgt_key": mgt_key}


@app.post("/api/finance/receipt/create")
async def create_receipt(request: Request, db: Session = Depends(get_db)):
    """현금영수증 생성 (DB 저장)"""
    data = await request.json()
    now = datetime.now()
    mgt_key = f"CR-{now.strftime('%Y%m%d')}-{str(now.microsecond)[:4].zfill(4)}"

    db.execute(text("""
        INSERT INTO cash_receipts (mgt_key, trade_date, trade_type, trade_usage, identity_num, identity_type,
            supply_cost, tax_amount, total_amount, item_name, status)
        VALUES (:mk, :td, :tt, :tu, :inum, :itype, :sc, :ta, :tot, :item, 'draft')
    """), {
        "mk": mgt_key,
        "td": data.get("trade_date", now.strftime("%Y-%m-%d")),
        "tt": data.get("trade_type", "승인거래"),
        "tu": data.get("trade_usage", "소득공제용"),
        "inum": data.get("identity_num", ""),
        "itype": data.get("identity_type", "phone"),
        "sc": data.get("supply_cost", 0),
        "ta": data.get("tax_amount", 0),
        "tot": data.get("total_amount", 0),
        "item": data.get("item_name", "잠사박물관 입장권"),
    })
    db.commit()
    return {"ok": True, "mgt_key": mgt_key}


# ═══════════════ 5. 입금매칭 ═══════════════

@app.post("/api/finance/match-deposits")
async def match_deposits(db: Session = Depends(get_db)):
    """미매칭 입금 → 예약 자동 매칭"""
    try:
        trans = db.execute(text(
            "SELECT * FROM bank_transactions WHERE matched=false AND inout_type='입금' ORDER BY tran_date DESC LIMIT 100"
        )).mappings().all()
        reservs = db.execute(text(
            "SELECT * FROM reservations WHERE deposit_status IN ('pending','partial') ORDER BY visit_date"
        )).mappings().all()

        matched_count = 0
        for t in trans:
            for r in reservs:
                if (
                    t["amount"] == r["total_amount"]
                    and r["group_name"]
                    and t["print_content"]
                    and r["group_name"][:2] in (t["print_content"] or "")
                ):
                    db.execute(
                        text("UPDATE bank_transactions SET matched=true, matched_type='reservation', matched_id=:rid WHERE id=:tid"),
                        {"rid": r["id"], "tid": t["id"]},
                    )
                    db.execute(
                        text("UPDATE reservations SET deposit_amount=:amt, deposit_status='complete', deposit_matched_at=now() WHERE id=:rid"),
                        {"amt": t["amount"], "rid": r["id"]},
                    )
                    matched_count += 1
                    break
        db.commit()
        return {"ok": True, "matched": matched_count, "unmatched_deposits": len(trans) - matched_count}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


# ─── 조회 API ───

@app.get("/api/finance/partners")
def list_partners(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text(
            "SELECT * FROM business_partners WHERE is_active=true ORDER BY updated_at DESC"
        )).mappings().all()
        return [dict(r) for r in rows]
    except Exception:
        return []


@app.get("/api/finance/invoices")
def list_invoices(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text(
            "SELECT * FROM tax_invoices ORDER BY issue_date DESC LIMIT 50"
        )).mappings().all()
        return [dict(r) for r in rows]
    except Exception:
        return []


@app.get("/api/finance/transactions")
def list_bank_trans(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text(
            "SELECT * FROM bank_transactions ORDER BY tran_date DESC, tran_time DESC LIMIT 100"
        )).mappings().all()
        return [dict(r) for r in rows]
    except Exception:
        return []


@app.get("/api/finance/reservations")
def list_reservations(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text(
            "SELECT * FROM reservations ORDER BY visit_date DESC LIMIT 50"
        )).mappings().all()
        return [dict(r) for r in rows]
    except Exception:
        return []


# ─── API 설정 관리 ───

@app.get("/api/finance/settings")
def finance_settings(db: Session = Depends(get_db)):
    try:
        rows = db.execute(text(
            "SELECT provider, display_name, is_active, expires_at, updated_at FROM api_credentials ORDER BY provider"
        )).mappings().all()
        return [dict(r) for r in rows]
    except Exception:
        return []


@app.post("/api/finance/settings")
async def update_finance_settings(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    provider = data.get("provider", "")
    credentials = data.get("credentials", {})
    try:
        db.execute(
            text("UPDATE api_credentials SET credentials=:c, updated_at=now() WHERE provider=:p"),
            {"c": json.dumps(credentials, ensure_ascii=False), "p": provider},
        )
        db.commit()
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)[:100]}
