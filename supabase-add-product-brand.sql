-- 상품에 brand 컬럼 추가 (예: 단델, AW 등 브랜드 식별자)
-- 한 번만 실행

alter table products
  add column if not exists brand text;

comment on column products.brand is '브랜드명 (선택). 예: 단델. 거래처(회사) 안의 브랜드 구분용';
