-- =====================================================================
-- 프로모션 어드민 - Supabase DB 스키마
-- 실행 방법: Supabase 대시보드 > SQL Editor > 이 파일 내용 복붙 > Run
-- =====================================================================

-- 확장: UUID 생성 함수
create extension if not exists "uuid-ossp";

-- =====================================================================
-- 1. 거래처 (vendors)
--    - 공급처(원단/부자재/공임): supplier
--    - 고객(브랜드): customer
--    - 둘 다 해당하는 곳: both
--    - 거래처별 사이즈 체계는 size_system 에 jsonb 배열로 저장
--      예) ["110","120","130","140","150","160","170"] (아동복)
--      예) ["1","2"] (마요네즈)
--      예) ["S","M","L"] (성인복)
-- =====================================================================
create table vendors (
  id              uuid primary key default uuid_generate_v4(),
  name            text not null,                         -- 거래처명
  vendor_type     text not null check (vendor_type in ('supplier','customer','both')),
  business_number text,                                  -- 사업자번호
  ceo_name        text,                                  -- 대표자
  address         text,
  phone           text,
  email           text,
  bank_info       text,                                  -- 계좌정보
  size_system     jsonb default '[]'::jsonb,             -- 사이즈 체계 (고객일 때 사용)
  memo            text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index vendors_type_idx on vendors(vendor_type);
create index vendors_name_idx on vendors(name);


-- =====================================================================
-- 2. 상품 (products)
--    - 품번은 수동 입력 (거래처에서 줌)
--    - 같은 거래처 내에서 품번은 유일해야 함
--    - 거래처별 판매가는 products.selling_price 에 저장
-- =====================================================================
create table products (
  id              uuid primary key default uuid_generate_v4(),
  code            text not null,                         -- 품번 (예: A2SKCSTX01RD)
  name            text not null,                         -- 품목명
  color           text,                                  -- 컬러
  vendor_id       uuid not null references vendors(id) on delete cascade,
  selling_price   numeric(12,2) default 0,               -- 거래처에 파는 단가 (판매가)
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  unique (vendor_id, code)
);

create index products_vendor_idx on products(vendor_id);
create index products_code_idx on products(code);


-- =====================================================================
-- 3. 원가 구성 (cost_items)
--    - 한 상품의 원가는 여러 재료 항목의 합
--    - 예) 챠밍(원단) + 2x1rib(원단) + 나염 + 공임 + 포장
--    - subtotal = unit_price * yards (DB에서 자동 계산)
-- =====================================================================
create table cost_items (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references products(id) on delete cascade,
  supplier_id     uuid references vendors(id) on delete set null,  -- 재료 공급처
  item_name       text not null,                         -- 재료명 (챠밍, 2x1rib, 나염, 공임 등)
  unit_price      numeric(12,2) default 0,               -- 단가
  yards           numeric(10,4) default 0,               -- 요척 (yard)
  subtotal        numeric(14,2) generated always as (unit_price * yards) stored,
  sort_order      int default 0,
  created_at      timestamptz default now()
);

create index cost_items_product_idx on cost_items(product_id);


-- =====================================================================
-- 4. 원단 사용 추적 (fabric_usage)
--    - 컬러별로 원단 입고량 vs 재단된 수량 추적
--    - 벌당 원단 단가 = 총액 / 재단수량
--    - 요척 = 원단입고량 / 재단수량 (yard 환산)
-- =====================================================================
create table fabric_usage (
  id              uuid primary key default uuid_generate_v4(),
  product_id      uuid not null references products(id) on delete cascade,
  color           text not null,                         -- 컬러
  fabric_in       numeric(12,4) default 0,               -- 원단 입고량 (yard)
  cut_quantity    int default 0,                         -- 재단된 수량 (벌)
  total_amount    numeric(14,2) default 0,               -- 총액 (원)
  cost_per_unit   numeric(12,2) generated always as (
    case when cut_quantity > 0 then total_amount / cut_quantity else 0 end
  ) stored,                                              -- 벌당 원단 단가
  yards_per_unit  numeric(10,4) generated always as (
    case when cut_quantity > 0 then fabric_in / cut_quantity else 0 end
  ) stored,                                              -- 벌당 요척
  notes           text,
  created_at      timestamptz default now()
);

create index fabric_usage_product_idx on fabric_usage(product_id);


-- =====================================================================
-- 5. 입고내역서 헤더 (incoming)
--    - 한 달치 또는 특정 거래처의 입고건들을 묶음
-- =====================================================================
create table incoming (
  id              uuid primary key default uuid_generate_v4(),
  vendor_id       uuid not null references vendors(id) on delete restrict,  -- 받는 거래처(고객)
  period          text,                                  -- 기간 (예: 2026.05)
  producer        text default 'AW',                     -- 생산처 (보통 'AW' = 본인)
  brand           text,                                  -- 브랜드
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create index incoming_vendor_idx on incoming(vendor_id);
create index incoming_period_idx on incoming(period);


-- =====================================================================
-- 6. 입고 라인 (incoming_items)
--    - 한 줄 = 한 박스 = (품번, 사이즈별 수량, 입고일, C/T번호)
--    - sizes 는 jsonb {"110": 0, "120": 0, "130": 15, ...} 또는 {"1": 56, "2": 54}
--    - 거래처마다 사이즈가 다르므로 jsonb 가 적합
-- =====================================================================
create table incoming_items (
  id              uuid primary key default uuid_generate_v4(),
  incoming_id     uuid not null references incoming(id) on delete cascade,
  product_id      uuid references products(id) on delete set null,
  product_code    text,                                  -- 품번 (상품이 삭제돼도 기록 보존)
  product_name    text,                                  -- 품목명 (스냅샷)
  sizes           jsonb default '{}'::jsonb,             -- 사이즈별 수량
  total_quantity  int default 0,                         -- 합계 (sizes 의 총합 - 앱에서 계산해서 저장)
  delivery_date   date,                                  -- 입고일
  carton_no       int,                                   -- C/T 번호
  notes           text,
  created_at      timestamptz default now()
);

create index incoming_items_incoming_idx on incoming_items(incoming_id);
create index incoming_items_product_idx on incoming_items(product_id);


-- =====================================================================
-- 7. 계산서/영수증 헤더 (invoices)
--    - 받는 거래처 + 작성일 + 총액 + 공급자(나) 정보
-- =====================================================================
create table invoices (
  id                       uuid primary key default uuid_generate_v4(),
  vendor_id                uuid not null references vendors(id) on delete restrict,  -- 받는 쪽 거래처
  issue_date               date not null default current_date,                       -- 작성일
  -- 공급자(나) 정보 (스냅샷으로 저장하면 나중에 사업자정보 변경돼도 과거 계산서는 보존됨)
  supplier_business_number text default '216-21-18212',
  supplier_name            text default '써치(SEARCH)',
  supplier_ceo             text default '함기호',
  supplier_address         text default '서울시 동대문구 안암로 16길 4, 2층',
  bank_info                text default '함기호(써치) 국민은행 038737-04-002188',
  -- 금액
  subtotal                 numeric(14,2) default 0,      -- 공급가액
  vat                      numeric(14,2) default 0,      -- 부가세
  total                    numeric(14,2) default 0,      -- 총 합계
  notes                    text,
  created_at               timestamptz default now(),
  updated_at               timestamptz default now()
);

create index invoices_vendor_idx on invoices(vendor_id);
create index invoices_date_idx on invoices(issue_date);


-- =====================================================================
-- 8. 계산서 라인 (invoice_items)
--    - 한 줄 = (날짜, 품명, 칼라, 수량, 단가, 금액)
--    - quantity 가 음수면 반품/공제
--    - amount = quantity * unit_price (DB에서 자동 계산)
-- =====================================================================
create table invoice_items (
  id              uuid primary key default uuid_generate_v4(),
  invoice_id      uuid not null references invoices(id) on delete cascade,
  line_date       date,                                  -- 거래 날짜
  product_id      uuid references products(id) on delete set null,
  product_name    text,                                  -- 품명 (스냅샷)
  color           text,                                  -- 칼라
  quantity        int default 0,                         -- 수량 (음수 = 반품)
  unit_price      numeric(12,2) default 0,               -- 단가
  amount          numeric(14,2) generated always as (quantity * unit_price) stored,
  is_return       boolean generated always as (quantity < 0) stored,
  sort_order      int default 0,
  created_at      timestamptz default now()
);

create index invoice_items_invoice_idx on invoice_items(invoice_id);


-- =====================================================================
-- 자동 updated_at 트리거
-- =====================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger vendors_updated_at  before update on vendors  for each row execute function set_updated_at();
create trigger products_updated_at before update on products for each row execute function set_updated_at();
create trigger incoming_updated_at before update on incoming for each row execute function set_updated_at();
create trigger invoices_updated_at before update on invoices for each row execute function set_updated_at();


-- =====================================================================
-- RLS (Row Level Security)
-- 일단은 인증된 사용자(로그인한 사람)는 모든 데이터 읽기/쓰기 가능
-- 나중에 거래처별 권한, 사용자별 권한 추가 가능
-- =====================================================================
alter table vendors        enable row level security;
alter table products       enable row level security;
alter table cost_items     enable row level security;
alter table fabric_usage   enable row level security;
alter table incoming       enable row level security;
alter table incoming_items enable row level security;
alter table invoices       enable row level security;
alter table invoice_items  enable row level security;

-- 인증된 사용자에게 모든 권한 부여
create policy "auth_all_vendors"        on vendors        for all to authenticated using (true) with check (true);
create policy "auth_all_products"       on products       for all to authenticated using (true) with check (true);
create policy "auth_all_cost_items"     on cost_items     for all to authenticated using (true) with check (true);
create policy "auth_all_fabric_usage"   on fabric_usage   for all to authenticated using (true) with check (true);
create policy "auth_all_incoming"       on incoming       for all to authenticated using (true) with check (true);
create policy "auth_all_incoming_items" on incoming_items for all to authenticated using (true) with check (true);
create policy "auth_all_invoices"       on invoices       for all to authenticated using (true) with check (true);
create policy "auth_all_invoice_items"  on invoice_items  for all to authenticated using (true) with check (true);


-- =====================================================================
-- 편의 뷰: 상품별 원가/마진 (자동 계산)
-- =====================================================================
create or replace view product_margin as
select
  p.id,
  p.code,
  p.name,
  p.color,
  p.vendor_id,
  v.name as vendor_name,
  p.selling_price,
  coalesce(sum(c.subtotal), 0) as production_cost,    -- 생산원가
  p.selling_price - coalesce(sum(c.subtotal), 0) as margin,
  case
    when p.selling_price > 0
    then round(((p.selling_price - coalesce(sum(c.subtotal), 0)) / p.selling_price * 100)::numeric, 2)
    else 0
  end as margin_rate                                  -- 마진율(%)
from products p
left join vendors v on p.vendor_id = v.id
left join cost_items c on c.product_id = p.id
group by p.id, v.name;


-- =====================================================================
-- 편의 뷰: 입고 합계 (같은 품번을 박스 무관하게 묶어서 보여줌)
-- =====================================================================
create or replace view incoming_summary as
select
  i.id as incoming_id,
  i.vendor_id,
  i.period,
  ii.product_id,
  coalesce(ii.product_code, p.code) as product_code,
  coalesce(ii.product_name, p.name) as product_name,
  count(*) as carton_count,                           -- 박스 수
  sum(ii.total_quantity) as total_quantity            -- 같은 품번 합계 수량
from incoming i
join incoming_items ii on ii.incoming_id = i.id
left join products p on ii.product_id = p.id
group by i.id, ii.product_id, ii.product_code, ii.product_name, p.code, p.name;
