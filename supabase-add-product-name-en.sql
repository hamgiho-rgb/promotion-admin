-- ─────────────────────────────────────────────
-- products 테이블에 영문명 컬럼 추가
-- 한 번만 실행
-- ─────────────────────────────────────────────

alter table products
  add column if not exists name_en text;

comment on column products.name_en is '영문 상품명 (선택). 거래처에서 영문으로 보내는 경우 같이 저장';
