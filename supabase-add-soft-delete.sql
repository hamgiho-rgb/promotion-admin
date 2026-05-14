-- ─────────────────────────────────────────────
-- 휴지통 (soft delete) 지원
-- 각 주요 테이블에 deleted_at 컬럼 추가 → 삭제 시 진짜로 안 지우고 시점만 기록
-- /trash 페이지에서 30일 안 복구 가능, 30일 지나면 자동 영구 삭제
-- 한 번만 실행 (멱등)
-- ─────────────────────────────────────────────

alter table vendors           add column if not exists deleted_at timestamptz;
alter table products          add column if not exists deleted_at timestamptz;
alter table incoming          add column if not exists deleted_at timestamptz;
alter table invoices          add column if not exists deleted_at timestamptz;
alter table quotations        add column if not exists deleted_at timestamptz;
alter table supplier_invoices add column if not exists deleted_at timestamptz;

-- 휴지통 조회 빨리 (deleted_at IS NOT NULL 만 인덱스)
create index if not exists idx_vendors_deleted_at           on vendors(deleted_at)           where deleted_at is not null;
create index if not exists idx_products_deleted_at          on products(deleted_at)          where deleted_at is not null;
create index if not exists idx_incoming_deleted_at          on incoming(deleted_at)          where deleted_at is not null;
create index if not exists idx_invoices_deleted_at          on invoices(deleted_at)          where deleted_at is not null;
create index if not exists idx_quotations_deleted_at        on quotations(deleted_at)        where deleted_at is not null;
create index if not exists idx_supplier_invoices_deleted_at on supplier_invoices(deleted_at) where deleted_at is not null;

-- 살아있는 데이터 조회 빨리 (deleted_at IS NULL 만 인덱스)
create index if not exists idx_vendors_alive    on vendors(vendor_type) where deleted_at is null;
create index if not exists idx_products_alive   on products(vendor_id)  where deleted_at is null;
create index if not exists idx_invoices_alive   on invoices(issue_date) where deleted_at is null;
create index if not exists idx_incoming_alive   on incoming(period)     where deleted_at is null;
create index if not exists idx_quotations_alive on quotations(issue_date) where deleted_at is null;
