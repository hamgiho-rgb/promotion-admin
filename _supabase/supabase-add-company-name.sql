-- =====================================================================
-- 거래처(vendors)에 회사명 필드 추가
-- 예) 회사명 "쿨파인더" + 브랜드명(name) "마크니"
--     같은 회사 산하의 다른 브랜드도 같은 company_name으로 묶임
-- =====================================================================

alter table vendors
  add column if not exists company_name text;

-- 회사명으로 필터/검색을 자주 한다면 인덱스 추가 (선택)
create index if not exists vendors_company_idx on vendors(company_name);

-- 기존 거래처의 name을 그대로 브랜드명으로 사용하고,
-- 모회사가 있는 거래처만 company_name을 채우면 됨.
-- 예: update vendors set company_name = '쿨파인더' where name = '마크니';
