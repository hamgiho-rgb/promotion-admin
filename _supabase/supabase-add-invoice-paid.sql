-- ─────────────────────────────────────────────
-- 계산서 입금 추적
-- paid_at: 입금 완료 시점 (null이면 미수)
-- 미수금 ○일 경과 알림용
-- 한 번만 실행 (멱등)
-- ─────────────────────────────────────────────

alter table invoices
  add column if not exists paid_at timestamptz;

create index if not exists idx_invoices_unpaid on invoices(issue_date) where paid_at is null and deleted_at is null;
