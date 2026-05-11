# 프로모션 어드민

써치(SEARCH) 함기호의 거래처/입고/계산서/원가/마진 관리 시스템.

> 📘 다른 PC에서 작업 시작 / 배포는 **[프로모션 어드민 핸드오버.md](./프로모션 어드민 핸드오버.md)** 참고.

## 기술 스택
React 18 + Vite + TypeScript + Tailwind + Supabase + Netlify

## 빠른 실행

### 처음 한 번 (또는 새 PC)
Windows에서 **`setup-new-pc.bat`** 더블클릭. 또는 수동:
```bash
npm install
```
프로젝트 루트에 `.env` 파일이 없다면 만들고 두 줄 입력:
```
VITE_SUPABASE_URL=https://gnjjninntiwbbzmfcnqt.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_1WFts_MStSQGujnaZfswiw_K6Ds1SKI
```

### 매번
```bash
npm run dev
```
또는 Windows에선 `run-dev.bat` 더블클릭.
→ `http://localhost:5173` 자동 오픈.

같은 와이파이의 휴대폰에서도 접속 가능 (콘솔에 뜨는 `Network: http://192.168.x.x:5173`).

## 주요 페이지
| 메뉴 | 경로 | 설명 |
|---|---|---|
| 대시보드 | `/` | 월별 매출 차트, 거래처별 요약 |
| 고객 거래처 | `/customers` | 납품 브랜드, 매출 요약, 사이즈 체계, 취급 상품 카탈로그 |
| 공급처 | `/suppliers` | 원단/부자재/공임, 취급 품목 카탈로그 |
| 상품 관리 | `/products` | 스타일별 원가/판매가, 리오더용 상세 |
| 원가계산서 | `/cost` | 재료별 원가, 마진율 자동 계산 |
| 실 입고 내역 | `/fabric` | 원단 입고/재단, 벌당 단가 |
| 입고내역서 | `/incoming` | 박스별 입고 수량 |
| 계산서/영수증 | `/invoices` | 발행·인쇄·**영수증 양식 엑셀 다운로드** |
| 견적서 | `/quotations` | 계약금 포함, 거래처 발송용 |
| 마진내역서 | `/margin` | 상품/거래처별 마진 분석 |
| 엑셀 가져오기 | `/import` | 기존 엑셀 일괄 등록 |

## 엑셀 내보내기
모든 주요 페이지 상단 **📥 엑셀 내보내기**.
계산서는 **일리오/청운상사 영수증 양식 그대로** (공급자 박스, SUM/세액/총합계 수식 포함) 다운로드.

## DB
Supabase 클라우드 — 어느 PC에서 접속해도 동일한 데이터.
새 Supabase로 옮길 때는 `supabase-schema.sql` → `supabase-add-quotations.sql` → `supabase-allow-anon.sql` 순서로 실행.

## 배포
GitHub `main` 푸시 → Netlify 자동 배포. 첫 푸시는 **`first-push.bat`** 더블클릭으로 자동화. 자세한 건 프로모션 어드민 핸드오버.md 3절.

## 자주 쓰는 명령
| 명령 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 배포용 빌드 (Netlify가 자동 실행) |
| `npm run preview` | 빌드 결과 미리보기 |
| `npm run typecheck` | TypeScript 타입 체크 (옵션) |
