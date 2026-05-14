-- ─────────────────────────────────────────────
-- supplier_invoices: 공급처 계산서 (공장에서 받은 청구)
-- supplier_invoice_items: 라인별 상세
-- 한 번만 실행
-- ─────────────────────────────────────────────

create table if not exists supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references vendors(id) on delete cascade,
  period text,                  -- "2026-05" 형식 (월별 그룹용)
  issue_date date,              -- 청구 시점 (선택)
  notes text,
  -- 합계는 generated column 으로 라인 합산
  subtotal numeric default 0,
  vat numeric default 0,
  total numeric default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_supplier_invoices_supplier on supplier_invoices(supplier_id);
create index if not exists idx_supplier_invoices_period on supplier_invoices(period);

create table if not exists supplier_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid references supplier_invoices(id) on delete cascade,
  line_date date,
  product_name text,            -- 품목 (예: 패널팬츠)
  brand text,                   -- 상호 (예: 마크니, 크리드 — 어느 브랜드 거에 공임 들었는지)
  quantity numeric default 0,
  unit_price numeric default 0,
  amount numeric generated always as (quantity * unit_price) stored,
  notes text,
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists idx_supplier_invoice_items_invoice on supplier_invoice_items(invoice_id);
create index if not exists idx_supplier_invoice_items_brand on supplier_invoice_items(brand);

-- RLS
alter table supplier_invoices enable row level security;
alter table supplier_invoice_items enable row level security;

drop policy if exists "anon_all_supplier_invoices" on supplier_invoices;
create policy "anon_all_supplier_invoices" on supplier_invoices
  for all using (true) with check (true);

drop policy if exists "anon_all_supplier_invoice_items" on supplier_invoice_items;
create policy "anon_all_supplier_invoice_items" on supplier_invoice_items
  for all using (true) with check (true);

-- updated_at trigger (재사용)
drop trigger if exists set_supplier_invoices_updated_at on supplier_invoices;
create trigger set_supplier_invoices_updated_at
  before update on supplier_invoices
  for each row execute function trigger_set_updated_at();
