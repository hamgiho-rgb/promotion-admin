-- =====================================================================
-- 견적서 (계약금/선납 포함) 테이블 추가
-- Supabase SQL Editor 에서 한 번만 실행
-- =====================================================================

-- 견적서 헤더
create table if not exists quotations (
  id                       uuid primary key default uuid_generate_v4(),
  vendor_id                uuid not null references vendors(id) on delete restrict,
  issue_date               date not null default current_date,        -- 발행일
  validity_days            int default 30,                            -- 유효 기간(일)
  -- 공급자(나) 정보 스냅샷
  supplier_business_number text default '216-21-18212',
  supplier_name            text default '써치(SEARCH)',
  supplier_ceo             text default '함기호',
  supplier_address         text default '서울시 동대문구 안암로 16길 4, 2층',
  bank_info                text default '함기호(써치) 국민은행 038737-04-002188',
  -- 금액
  subtotal                 numeric(14,2) default 0,
  vat                      numeric(14,2) default 0,
  total                    numeric(14,2) default 0,
  -- 계약금
  deposit_rate             numeric(5,2) default 0,                    -- 0~100 (% 단위)
  deposit_amount           numeric(14,2) generated always as (total * deposit_rate / 100) stored,
  deposit_received         boolean default false,                     -- 계약금 수령 여부
  deposit_received_date    date,                                      -- 계약금 수령일
  -- 상태
  status                   text default 'draft' check (status in ('draft','sent','accepted','rejected','converted')),
  notes                    text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

create index if not exists quotations_vendor_idx on quotations(vendor_id);
create index if not exists quotations_date_idx on quotations(issue_date);
create index if not exists quotations_status_idx on quotations(status);

-- 견적서 라인
create table if not exists quotation_items (
  id           uuid primary key default uuid_generate_v4(),
  quotation_id uuid not null references quotations(id) on delete cascade,
  product_id   uuid references products(id) on delete set null,
  product_name text,
  color        text,
  size_info    text,                                                  -- 사이즈 정보 메모 (예: 110~170)
  quantity     int default 0,
  unit_price   numeric(12,2) default 0,
  amount       numeric(14,2) generated always as (quantity * unit_price) stored,
  sort_order   int default 0,
  created_at   timestamptz default now()
);

create index if not exists quotation_items_quotation_idx on quotation_items(quotation_id);

-- 자동 updated_at 트리거 (이미 있는 함수 활용)
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'quotations_updated_at') then
    create trigger quotations_updated_at before update on quotations
      for each row execute function set_updated_at();
  end if;
end $$;

-- RLS
alter table quotations enable row level security;
alter table quotation_items enable row level security;

drop policy if exists "auth_all_quotations" on quotations;
drop policy if exists "auth_all_quotation_items" on quotation_items;
drop policy if exists "anon_all_quotations" on quotations;
drop policy if exists "anon_all_quotation_items" on quotation_items;

create policy "auth_all_quotations"      on quotations      for all to authenticated using (true) with check (true);
create policy "auth_all_quotation_items" on quotation_items for all to authenticated using (true) with check (true);
create policy "anon_all_quotations"      on quotations      for all to anon          using (true) with check (true);
create policy "anon_all_quotation_items" on quotation_items for all to anon          using (true) with check (true);
