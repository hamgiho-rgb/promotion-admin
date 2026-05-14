-- ─────────────────────────────────────────────
-- 계산서에 입고내역서 연결
-- 입고 → 계산서 1클릭 발행 기능을 위한 컬럼
-- 한 번만 실행 (멱등)
-- ─────────────────────────────────────────────

alter table invoices
  add column if not exists incoming_id uuid references incoming(id) on delete set null;

create index if not exists idx_invoices_incoming on invoices(incoming_id) where incoming_id is not null;

-- 참고: 계산서 ↔ 입고는 1:N 관계 가능 (한 입고를 여러 계산서로 쪼갤 수 있음)
-- 견적서(quotation_id)와 함께 한 계산서에 둘 다 연결될 수도 있음
