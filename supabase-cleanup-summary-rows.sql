-- ─────────────────────────────────────────────
-- 이미 입고로 잘못 들어간 "합계 / 소계 / 총계" 행 일괄 삭제
-- 사용자가 import 했던 엑셀에 합계 행이 있어서 입고 라인으로 잡혔을 때 정리용
-- 한 번 돌리고 끝
-- ─────────────────────────────────────────────

-- 1) 먼저 어떤 라인이 삭제될지 확인 (이걸 먼저 돌려서 결과 확인)
select id, incoming_id, product_code, product_name, total_quantity
from incoming_items
where lower(trim(coalesce(product_code, ''))) in ('합계','소계','총계','계','total','sum')
   or lower(trim(coalesce(product_name, ''))) in ('합계','소계','총계','계','total','sum');

-- 2) 결과 확인 후, 위 SELECT를 아래 DELETE로 바꿔서 실행:
-- delete from incoming_items
-- where lower(trim(coalesce(product_code, ''))) in ('합계','소계','총계','계','total','sum')
--    or lower(trim(coalesce(product_name, ''))) in ('합계','소계','총계','계','total','sum');
