-- ════════════════════════════════════════════════════════════════════
-- 프로모션 어드민 — 전체 마이그레이션 통합본
-- ════════════════════════════════════════════════════════════════════
-- Supabase SQL Editor에서 이 파일 전체 복사 → New Query → 붙여넣고 → Run
--
-- 모두 IF NOT EXISTS / DROP IF EXISTS 로 멱등 처리되어 있어서
-- 이미 일부 실행했어도 안전하게 재실행 가능합니다.
-- ════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────
-- 1. 견적서 + 견적서 라인 (이미 있으면 스킵)
-- ────────────────────────────────────────
create table if not exists quotations (
  id                       uuid primary key default gen_random_uuid(),
  vendor_id                uuid not null references vendors(id) on delete restrict,
  issue_date               date not null,
  validity_days            int default 30,
  supplier_business_number text default '',
  supplier_name            text default '',
  supplier_ceo             text default '',
  supplier_address         text default '',
  bank_info                text default '',
  subtotal                 numeric default 0,
  vat                      numeric default 0,
  total                    numeric default 0,
  deposit_rate             numeric default 0,
  deposit_amount           numeric default 0,
  deposit_received         boolean default false,
  deposit_received_date    date,
  status                   text default 'draft',
  notes                    text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);
create index if not exists quotations_vendor_idx on quotations(vendor_id);

create table if not exists quotation_items (
  id            uuid primary key default gen_random_uuid(),
  quotation_id  uuid not null references quotations(id) on delete cascade,
  product_id    uuid references products(id) on delete set null,
  product_name  text,
  color         text,
  size_info     text,
  quantity      numeric default 0,
  unit_price    numeric default 0,
  amount        numeric generated always as (quantity * unit_price) stored,
  sort_order    int default 0,
  created_at    timestamptz default now()
);

alter table quotations enable row level security;
alter table quotation_items enable row level security;
drop policy if exists "anon_all_quotations" on quotations;
create policy "anon_all_quotations" on quotations for all using (true) with check (true);
drop policy if exists "anon_all_quotation_items" on quotation_items;
create policy "anon_all_quotation_items" on quotation_items for all using (true) with check (true);

-- ────────────────────────────────────────
-- 2. app_users (PIN 로그인)
-- ────────────────────────────────────────
create table if not exists app_users (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  pin         text not null,
  role        text default 'staff',
  created_at  timestamptz default now()
);
alter table app_users enable row level security;
drop policy if exists "anon_all_app_users" on app_users;
create policy "anon_all_app_users" on app_users for all using (true) with check (true);

-- ────────────────────────────────────────
-- 3. 상품에 영문명 + 브랜드 컬럼 추가
-- ────────────────────────────────────────
alter table products add column if not exists name_en text;
alter table products add column if not exists brand text;

-- ────────────────────────────────────────
-- 4. 거래처에 모회사명 (company_name) 추가
-- ────────────────────────────────────────
alter table vendors add column if not exists company_name text;

-- ────────────────────────────────────────
-- 5. 공급처 계산서 (공장에서 받은 청구서)
-- ────────────────────────────────────────
create table if not exists supplier_invoices (
  id          uuid primary key default gen_random_uuid(),
  supplier_id uuid references vendors(id) on delete cascade,
  period      text,
  issue_date  date,
  notes       text,
  subtotal    numeric default 0,
  vat         numeric default 0,
  total       numeric default 0,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);
create index if not exists idx_supplier_invoices_supplier on supplier_invoices(supplier_id);
create index if not exists idx_supplier_invoices_period on supplier_invoices(period);

create table if not exists supplier_invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid references supplier_invoices(id) on delete cascade,
  line_date   date,
  product_name text,
  brand       text,
  quantity    numeric default 0,
  unit_price  numeric default 0,
  amount      numeric generated always as (quantity * unit_price) stored,
  notes       text,
  sort_order  int default 0,
  created_at  timestamptz default now()
);
create index if not exists idx_supplier_invoice_items_invoice on supplier_invoice_items(invoice_id);
create index if not exists idx_supplier_invoice_items_brand on supplier_invoice_items(brand);

alter table supplier_invoices enable row level security;
alter table supplier_invoice_items enable row level security;
drop policy if exists "anon_all_supplier_invoices" on supplier_invoices;
create policy "anon_all_supplier_invoices" on supplier_invoices for all using (true) with check (true);
drop policy if exists "anon_all_supplier_invoice_items" on supplier_invoice_items;
create policy "anon_all_supplier_invoice_items" on supplier_invoice_items for all using (true) with check (true);

-- updated_at trigger
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'set_supplier_invoices_updated_at') then
    create trigger set_supplier_invoices_updated_at
      before update on supplier_invoices
      for each row execute function trigger_set_updated_at();
  end if;
end $$;

-- ────────────────────────────────────────
-- 6. 계산서에 견적서 연결 + 선납액
-- ────────────────────────────────────────
alter table invoices
  add column if not exists quotation_id uuid references quotations(id) on delete set null,
  add column if not exists deposit_amount numeric default 0;
create index if not exists idx_invoices_quotation on invoices(quotation_id);

-- ────────────────────────────────────────
-- 7. 계산서에 입고내역서 연결
-- ────────────────────────────────────────
alter table invoices
  add column if not exists incoming_id uuid references incoming(id) on delete set null;
create index if not exists idx_invoices_incoming on invoices(incoming_id) where incoming_id is not null;

-- ────────────────────────────────────────
-- 7-1. 계산서 라인에 size 컬럼 (사이즈별 라인 분리용 — 단일 사이즈)
--      + sizes JSON (사이즈별 분포 합계 — 입고내역서 양식처럼 컬럼 펼침용)
-- ────────────────────────────────────────
alter table invoice_items add column if not exists size text;
alter table invoice_items add column if not exists sizes jsonb;

-- ────────────────────────────────────────
-- 7-2. 계산서 입금 추적 (paid_at, null=미수)
-- ────────────────────────────────────────
alter table invoices add column if not exists paid_at timestamptz;
create index if not exists idx_invoices_unpaid on invoices(issue_date) where paid_at is null and deleted_at is null;

-- ────────────────────────────────────────
-- 8. 휴지통 (soft delete) — 모든 주요 테이블에 deleted_at
-- ────────────────────────────────────────
alter table vendors           add column if not exists deleted_at timestamptz;
alter table products          add column if not exists deleted_at timestamptz;
alter table incoming          add column if not exists deleted_at timestamptz;
alter table invoices          add column if not exists deleted_at timestamptz;
alter table quotations        add column if not exists deleted_at timestamptz;
alter table supplier_invoices add column if not exists deleted_at timestamptz;

create index if not exists idx_vendors_deleted_at           on vendors(deleted_at)           where deleted_at is not null;
create index if not exists idx_products_deleted_at          on products(deleted_at)          where deleted_at is not null;
create index if not exists idx_incoming_deleted_at          on incoming(deleted_at)          where deleted_at is not null;
create index if not exists idx_invoices_deleted_at          on invoices(deleted_at)          where deleted_at is not null;
create index if not exists idx_quotations_deleted_at        on quotations(deleted_at)        where deleted_at is not null;
create index if not exists idx_supplier_invoices_deleted_at on supplier_invoices(deleted_at) where deleted_at is not null;

create index if not exists idx_vendors_alive    on vendors(vendor_type) where deleted_at is null;
create index if not exists idx_products_alive   on products(vendor_id)  where deleted_at is null;
create index if not exists idx_invoices_alive   on invoices(issue_date) where deleted_at is null;
create index if not exists idx_incoming_alive   on incoming(period)     where deleted_at is null;
create index if not exists idx_quotations_alive on quotations(issue_date) where deleted_at is null;

-- ────────────────────────────────────────
-- 9. 변경 이력 로그 (audit log)
-- ────────────────────────────────────────
create table if not exists activity_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_name   text,
  actor_id     uuid,
  action       text not null,
  entity_type  text not null,
  entity_id    uuid,
  entity_label text,
  summary      text,
  details      jsonb,
  created_at   timestamptz default now()
);
create index if not exists idx_activity_logs_created on activity_logs(created_at desc);
create index if not exists idx_activity_logs_entity  on activity_logs(entity_type, entity_id);
create index if not exists idx_activity_logs_actor   on activity_logs(actor_id);
alter table activity_logs enable row level security;
drop policy if exists "anon_all_activity_logs" on activity_logs;
create policy "anon_all_activity_logs" on activity_logs for all using (true) with check (true);

-- ────────────────────────────────────────
-- 10. 휴지통 중복 충돌 해결 — partial unique index
--     기존 products의 UNIQUE(vendor_id, code) 는 휴지통 행도 포함해서
--     같은 품번을 다시 등록하려고 하면 충돌남.
--     → 살아있는 행 (deleted_at IS NULL) 에만 적용되는 partial unique index 로 교체.
-- ────────────────────────────────────────
do $$
begin
  -- 기존 UNIQUE 제약 이름은 보통 products_vendor_id_code_key. 있으면 제거.
  if exists (
    select 1 from pg_constraint
    where conrelid = 'products'::regclass
      and contype = 'u'
      and conname = 'products_vendor_id_code_key'
  ) then
    alter table products drop constraint products_vendor_id_code_key;
  end if;
end$$;

-- 살아있는 상품에 대해서만 (vendor_id, code) 유일성 적용
create unique index if not exists products_vendor_code_alive_uq
  on products(vendor_id, code)
  where deleted_at is null;

-- ════════════════════════════════════════════════════════════════════
-- 끝! 다 한 번에 실행됨. 다시 실행해도 안전 (멱등).
-- ════════════════════════════════════════════════════════════════════
