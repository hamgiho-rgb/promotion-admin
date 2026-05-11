-- =====================================================================
-- 로그인 없이 사용 가능하게 RLS 정책 추가 (개발/내부용)
-- 이 SQL을 Supabase SQL Editor 에서 한 번만 실행하면 됨
--
-- ⚠️ 나중에 진짜 로그인 강제하려면 아래 정책들을 DROP 하면 됨:
--    drop policy "anon_all_vendors" on vendors;
--    ... (각 테이블마다)
-- =====================================================================

create policy "anon_all_vendors"        on vendors        for all to anon using (true) with check (true);
create policy "anon_all_products"       on products       for all to anon using (true) with check (true);
create policy "anon_all_cost_items"     on cost_items     for all to anon using (true) with check (true);
create policy "anon_all_fabric_usage"   on fabric_usage   for all to anon using (true) with check (true);
create policy "anon_all_incoming"       on incoming       for all to anon using (true) with check (true);
create policy "anon_all_incoming_items" on incoming_items for all to anon using (true) with check (true);
create policy "anon_all_invoices"       on invoices       for all to anon using (true) with check (true);
create policy "anon_all_invoice_items"  on invoice_items  for all to anon using (true) with check (true);
