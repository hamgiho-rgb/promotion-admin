-- ─────────────────────────────────────────────
-- 계산서에 견적서 연결 + 선납액(deposit) 추가
-- 견적서에서 받은 계약금을 계산서 발행 시 차감 → 잔금만 청구
-- 한 번만 실행 (멱등)
-- ─────────────────────────────────────────────

-- 1) invoices에 quotation_id (연결된 견적서) + deposit_amount (선납 받은 금액)
alter table invoices
  add column if not exists quotation_id uuid references quotations(id) on delete set null,
  add column if not exists deposit_amount numeric default 0;

create index if not exists idx_invoices_quotation on invoices(quotation_id);

-- 참고: 청구 잔금 = total - deposit_amount  (음수면 환불)
-- 매출 합계는 여전히 invoices.total 만 사용 → 견적서/계약금과 이중 합산 절대 없음
