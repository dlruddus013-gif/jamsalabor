-- ═══════════════════════════════════════════════════════════════
-- 잠사플레이팜 세무/금융 연동 DB 마이그레이션
-- Supabase SQL Editor에서 실행
-- ═══════════════════════════════════════════════════════════════

-- 1. 거래처 관리
create table if not exists business_partners (
  id bigint primary key generated always as identity,
  biz_no text unique not null,           -- 사업자등록번호 (10자리)
  corp_name text not null,               -- 상호
  ceo_name text,                         -- 대표자명
  biz_type text,                         -- 업태
  biz_class text,                        -- 종목
  addr text,                             -- 주소
  email text,
  phone text,
  -- 국세청 조회 결과
  nts_status text,                       -- 계속사업자/휴업자/폐업자
  nts_status_code text,                  -- 01/02/03
  nts_tax_type text,                     -- 과세유형
  nts_verified_at timestamptz,           -- 최종 조회 시각
  nts_valid boolean,                     -- 진위확인 결과
  -- 메타
  category text default '일반',           -- 일반/단체/관공서/학교
  memo text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2. 전자세금계산서
create table if not exists tax_invoices (
  id bigint primary key generated always as identity,
  mgt_key text unique,                   -- 관리번호 JAMSA-YYYYMMDD-NNNN
  issue_date date not null,
  -- 공급자 (잠사플레이팜)
  supplier_biz_no text default '000-00-00000',
  supplier_name text default '한국잠사플레이팜 농업회사법인(주)',
  supplier_ceo text default '이경연',
  -- 공급받는자
  buyer_id bigint references business_partners(id),
  buyer_biz_no text not null,
  buyer_name text not null,
  buyer_ceo text,
  buyer_email text,
  -- 금액
  supply_cost integer not null,          -- 공급가액
  tax_amount integer not null,           -- 세액
  total_amount integer not null,         -- 합계
  -- 품목
  items jsonb not null default '[]',     -- [{itemName,qty,unitCost,supplyCost,tax}]
  -- 상태
  purpose_type text default '영수',       -- 영수/청구
  tax_type text default '과세',           -- 과세/영세/면세
  status text default 'draft',           -- draft/issued/sent/failed/cancelled
  asp_provider text,                     -- popbill/barobill/hometaxbill
  asp_response jsonb,                    -- ASP 응답 원본
  nts_send_status text,                  -- 국세청 전송 상태
  nts_send_at timestamptz,
  note text,
  created_by uuid,
  created_at timestamptz default now()
);

-- 3. 현금영수증
create table if not exists cash_receipts (
  id bigint primary key generated always as identity,
  mgt_key text unique,
  trade_date date not null,
  trade_type text default '승인거래',      -- 승인거래/취소거래
  trade_usage text default '소득공제용',    -- 소득공제용/지출증빙
  identity_num text not null,             -- 식별번호 (휴대폰/사업자/카드)
  identity_type text,                     -- phone/bizno/card
  supply_cost integer not null,
  tax_amount integer not null,
  total_amount integer not null,
  item_name text,
  status text default 'draft',
  asp_response jsonb,
  created_by uuid,
  created_at timestamptz default now()
);

-- 4. 은행 계좌 관리
create table if not exists bank_accounts (
  id bigint primary key generated always as identity,
  bank_code text not null,                -- 011:농협 012:상호금융
  bank_name text not null,
  account_no text not null,
  account_name text,                      -- 예금주
  fintech_use_num text,                   -- 오픈뱅킹 핀테크이용번호
  fin_acno text,                          -- NH 핀-어카운트
  purpose text default '운영',             -- 운영/급여/예치
  is_primary boolean default false,
  balance integer default 0,
  balance_updated_at timestamptz,
  is_active boolean default true,
  created_at timestamptz default now()
);

-- 5. 거래내역 (농협/오픈뱅킹 조회 결과)
create table if not exists bank_transactions (
  id bigint primary key generated always as identity,
  account_id bigint references bank_accounts(id),
  tran_date date not null,
  tran_time text,
  inout_type text not null,               -- 입금/출금
  tran_type text,                         -- 현금/이체/카드
  amount integer not null,
  balance_after integer,
  print_content text,                     -- 통장인자내용 (입금자명)
  -- 매칭
  matched boolean default false,
  matched_type text,                      -- reservation/invoice/payroll/other
  matched_id bigint,                      -- 매칭된 예약/계산서 ID
  memo text,
  source text default 'api',              -- api/manual/import
  created_at timestamptz default now()
);

-- 6. 단체예약 입금매칭
create table if not exists reservations (
  id bigint primary key generated always as identity,
  group_name text not null,
  contact_name text,
  contact_phone text,
  visit_date date,
  person_count integer default 0,
  unit_price integer default 5000,
  total_amount integer not null,
  deposit_amount integer default 0,       -- 입금된 금액
  deposit_status text default 'pending',  -- pending/partial/complete/overpaid
  deposit_matched_at timestamptz,
  biz_no text,                            -- 세금계산서 발행용
  invoice_id bigint,                      -- 연결된 세금계산서
  receipt_id bigint,                      -- 연결된 현금영수증
  memo text,
  status text default 'confirmed',
  created_at timestamptz default now()
);

-- 7. API 키/토큰 관리 (서버 전용)
create table if not exists api_credentials (
  id bigint primary key generated always as identity,
  provider text not null unique,          -- nts/nh/openbanking/popbill
  display_name text,
  credentials jsonb not null default '{}', -- 암호화된 키/토큰
  is_active boolean default true,
  expires_at timestamptz,
  updated_at timestamptz default now()
);

-- 시드: API 설정 템플릿
insert into api_credentials (provider, display_name, credentials) values
('nts', '국세청 공공데이터포털', '{"service_key":"","base_url":"https://api.odcloud.kr/api/nts-businessman/v1"}'),
('nh', 'NH오픈플랫폼', '{"access_token":"","iscd":"","base_url":"https://developers.nonghyup.com"}'),
('openbanking', '금융결제원 오픈뱅킹', '{"access_token":"","client_id":"","client_secret":"","base_url":"https://openapi.openbanking.or.kr"}'),
('popbill', '팝빌 (세금계산서/현금영수증)', '{"link_id":"","secret_key":"","corp_num":"","base_url":"https://popbill.linkhub.co.kr"}')
on conflict (provider) do nothing;

-- 시드: 잠사플레이팜 농협 계좌
insert into bank_accounts (bank_code, bank_name, account_no, account_name, purpose, is_primary) values
('011', 'NH농협은행', '', '한국잠사플레이팜', '운영', true)
on conflict do nothing;

-- RLS
alter table business_partners enable row level security;
alter table tax_invoices enable row level security;
alter table cash_receipts enable row level security;
alter table bank_accounts enable row level security;
alter table bank_transactions enable row level security;
alter table reservations enable row level security;
alter table api_credentials enable row level security;

create policy "finance_manager" on business_partners for all using (true);
create policy "finance_invoices" on tax_invoices for all using (true);
create policy "finance_receipts" on cash_receipts for all using (true);
create policy "finance_accounts" on bank_accounts for all using (true);
create policy "finance_trans" on bank_transactions for all using (true);
create policy "finance_reserv" on reservations for all using (true);
create policy "finance_creds" on api_credentials for all using (true);

-- 인덱스
create index idx_partners_bizno on business_partners(biz_no);
create index idx_invoices_date on tax_invoices(issue_date);
create index idx_invoices_buyer on tax_invoices(buyer_biz_no);
create index idx_trans_date on bank_transactions(tran_date);
create index idx_trans_matched on bank_transactions(matched) where matched = false;
create index idx_reserv_date on reservations(visit_date);
create index idx_reserv_deposit on reservations(deposit_status);
