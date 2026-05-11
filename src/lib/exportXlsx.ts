// 엑셀 내보내기 유틸리티 (SheetJS 사용)
import * as XLSX from 'xlsx'

/* ────────────────────────────────────────────
 * 영수증/계산서 양식 (사용자가 쓰던 포맷)
 * 컬럼: A(빈) B C D E F G H I J
 * 1행: 영수증 타이틀 영역
 * 2행: 영 수 증(공급받는자용)
 * 3행: ___ 귀하
 * 4-8행: 공급자 정보 박스
 * 9행: 작성일 / 금일 금액 / 취급자 헤더
 * 10행: 날짜값 / 금일 금액값 / 취급자값
 * 11행: 날짜|품명|품목|사이즈|수량|단가|금액 헤더
 * 12-31행: 데이터 (최대 20행)
 * 32-34행: 계좌정보 / 금일 금액 / 세액 / 총 합계
 * 35행: 위 금액을 청구(영수)함
 * ──────────────────────────────────────────── */

export interface ReceiptInvoice {
  vendor_name: string
  issue_date: string
  supplier_business_number?: string | null
  supplier_name?: string | null
  supplier_ceo?: string | null
  supplier_address?: string | null
  bank_info?: string | null
  notes?: string | null
  items: {
    line_date?: string | null
    product_name?: string | null
    color?: string | null
    quantity?: number | null
    unit_price?: number | null
  }[]
}

/** 영수증 양식 한 장을 시트(AoA)로 생성 */
function buildReceiptSheet(inv: ReceiptInvoice): { aoa: any[][]; merges: XLSX.Range[]; cols: { wch: number }[] } {
  const aoa: any[][] = []
  // 헬퍼: r,c → aoa 인덱스 채우기
  function set(r: number, c: number, val: any) {
    while (aoa.length < r) aoa.push([])
    while (aoa[r - 1].length < c) aoa[r - 1].push(null)
    aoa[r - 1][c - 1] = val
  }
  // 사이즈/컬러 분리 (DB는 "블랙/S" 형태로 저장됨)
  function splitColorSize(s?: string | null): [string, string] {
    if (!s) return ['', '']
    const idx = s.lastIndexOf('/')
    if (idx > -1 && idx < s.length - 1) {
      return [s.slice(0, idx), s.slice(idx + 1)]
    }
    return [s, '']
  }

  // 1행: 빈 헤더 줄 (디자인용)
  // 2행: 영 수 증
  set(2, 2, '영 수 증(공급받는자용)')
  // 3행: ___ 귀하
  set(3, 2, `${inv.vendor_name} 귀하`)
  // 4행: 공급자 / 사업자번호 / 번호
  set(4, 2, '공급자')
  set(4, 4, '사업자번호')
  set(4, 6, inv.supplier_business_number || '')
  // 5행: 상호 / 성명
  set(5, 4, '상호')
  set(5, 6, inv.supplier_name || '')
  set(5, 9, '성명')
  set(5, 10, inv.supplier_ceo || '')
  // 7행: 사업장 소재지 / 주소
  set(7, 4, '사업장\n소재지')
  set(7, 6, inv.supplier_address || '')
  // 9행: 작성일 / 금일 금액 / 취급자
  set(9, 2, '작성일')
  set(9, 6, '금일 금액')
  set(9, 10, '취급자')
  // 10행: 날짜 / =I34 (총합) / (취급자 비워둠)
  set(10, 2, inv.issue_date)
  set(10, 6, { f: 'I34' })
  // 11행: 컬럼 헤더
  set(11, 2, '날짜')
  set(11, 4, '품명')
  set(11, 6, '품목')
  set(11, 7, '사이즈')
  set(11, 8, '수량')
  set(11, 9, '단가')
  set(11, 10, '금액')
  // 12-31행: 데이터 (최대 20행). 부족하면 빈 행, 넘치면 자르고 마지막에 표시
  const MAX_ROWS = 20
  const items = inv.items.slice(0, MAX_ROWS)
  for (let i = 0; i < MAX_ROWS; i++) {
    const r = 12 + i
    const it = items[i]
    if (it) {
      if (i === 0) set(r, 2, inv.issue_date)
      const [color, size] = splitColorSize(it.color)
      set(r, 4, it.product_name || '')
      set(r, 6, color)
      set(r, 7, size)
      set(r, 8, it.quantity ?? 0)
      set(r, 9, it.unit_price ?? 0)
      set(r, 10, { f: `I${r}*H${r}` })
    } else {
      // 빈 행 (양식 유지)
      set(r, 8, 0)
      set(r, 9, 0)
      set(r, 10, { f: `I${r}*H${r}` })
    }
  }
  // 32행: 계좌정보 / 금일 금액 / 합계 수식
  set(32, 2, inv.bank_info || '')
  set(32, 6, '금일 금액')
  set(32, 9, { f: 'SUM(J12:J31)' })
  // 33행: 세액
  set(33, 6, '세액')
  set(33, 9, { f: 'I32*0.1' })
  // 34행: 총 합계
  set(34, 6, '총 합계')
  set(34, 9, { f: 'I32+I33' })
  // 35행: 위 금액을 청구(영수)함
  set(35, 2, '위 금액을 청구(영수)함')

  // 행 길이 균일화
  const COLS = 10
  for (let i = 0; i < 35; i++) {
    while (aoa.length < i + 1) aoa.push([])
    while (aoa[i].length < COLS) aoa[i].push(null)
  }

  // 병합 (B1:J1, B4:C8 공급자세로, D7:E8 사업장소재지, B9:E9 작성일라벨, F9:I9 금일금액라벨, F32:H32, F33:H33, F34:H34, I34:J34, B32:E32 계좌)
  const range = (s: string): XLSX.Range => XLSX.utils.decode_range(s)
  const merges: XLSX.Range[] = [
    range('B1:J1'),
    range('B2:J2'),
    range('B3:J3'),
    range('B4:C8'),
    range('D4:E4'), range('F4:J4'),
    range('D5:E5'), range('F5:H5'),
    range('D6:E6'), range('F6:J6'),
    range('D7:E8'), range('F7:J8'),
    range('B9:E9'), range('F9:I9'),
    range('B10:E10'), range('F10:I10'),
    range('B32:E32'),
    range('F32:H32'), range('F33:H33'), range('F34:H34'),
    range('I32:J32'), range('I33:J33'), range('I34:J34'),
    range('B35:J35'),
  ]

  // 컬럼 너비
  const cols = [
    { wch: 2 },   // A
    { wch: 11 },  // B 날짜
    { wch: 6 },   // C
    { wch: 12 },  // D 품명
    { wch: 6 },   // E
    { wch: 14 },  // F 품목
    { wch: 8 },   // G 사이즈
    { wch: 8 },   // H 수량
    { wch: 11 },  // I 단가
    { wch: 13 },  // J 금액
  ]

  return { aoa, merges, cols }
}

/** AoA를 시트로 변환하면서 수식/병합/너비 적용 */
function aoaToSheetWithFormulas(aoa: any[][]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const numRows = aoa.length
  const numCols = aoa[0]?.length || 0
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const v = aoa[r][c]
      if (v == null || v === '') continue
      const addr = XLSX.utils.encode_cell({ r, c })
      if (typeof v === 'object' && (v as any).f) {
        ws[addr] = { t: 'n', f: (v as any).f }
      } else if (typeof v === 'number') {
        ws[addr] = { t: 'n', v, z: v >= 1000 || v <= -1000 ? '#,##0' : undefined }
      } else if (v instanceof Date) {
        ws[addr] = { t: 'd', v, z: 'yyyy-mm-dd' }
      } else {
        ws[addr] = { t: 's', v: String(v) }
      }
    }
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: numRows - 1, c: numCols - 1 } })
  return ws
}

/** 단일 영수증 다운로드 */
export function exportInvoiceReceipt(inv: ReceiptInvoice, filename?: string) {
  const { aoa, merges, cols } = buildReceiptSheet(inv)
  const ws = aoaToSheetWithFormulas(aoa)
  ws['!merges'] = merges
  ws['!cols'] = cols
  const wb = XLSX.utils.book_new()
  const sheetName = (inv.notes?.replace(/^\[[^\]]+\]\s*/, '') || inv.issue_date).slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const fname = filename || `${inv.vendor_name}_${inv.issue_date}`
  XLSX.writeFile(wb, `${fname}.xlsx`)
}

/** 여러 영수증을 한 파일에 시트별로 — 원본 일리오계산서.xlsx 형식 */
export function exportInvoiceReceiptsMulti(
  invoices: ReceiptInvoice[],
  filename: string
) {
  const wb = XLSX.utils.book_new()
  const usedNames = new Set<string>()
  for (const inv of invoices) {
    const { aoa, merges, cols } = buildReceiptSheet(inv)
    const ws = aoaToSheetWithFormulas(aoa)
    ws['!merges'] = merges
    ws['!cols'] = cols
    let sheetName = (inv.notes?.replace(/^\[[^\]]+\]\s*/, '') || inv.issue_date).slice(0, 31)
    // 중복 시트명 회피
    let n = sheetName, i = 2
    while (usedNames.has(n)) { n = `${sheetName.slice(0, 28)}_${i++}` }
    usedNames.add(n)
    XLSX.utils.book_append_sheet(wb, ws, n)
  }
  XLSX.writeFile(wb, `${filename}_${timestamp()}.xlsx`)
}

/** 날짜를 yymmdd_hhmm 형식 문자열로 */
function timestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 컬럼 너비 자동 추정 */
function autoColumnWidths(rows: any[][]): { wch: number }[] {
  if (rows.length === 0) return []
  const cols = rows[0].length
  const widths: number[] = new Array(cols).fill(8)
  for (const row of rows) {
    for (let i = 0; i < cols; i++) {
      const v = row[i]
      if (v == null) continue
      const s = String(v)
      // 한글은 2칸으로 계산
      const len = [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)
      if (len > widths[i]) widths[i] = Math.min(len, 50)
    }
  }
  return widths.map(w => ({ wch: w + 2 }))
}

/**
 * 단일 시트로 엑셀 내보내기
 * @param data  헤더 포함 2차원 배열 (rows[0] = 컬럼 헤더)
 * @param sheetName  시트명
 * @param filename  파일명 (확장자 제외)
 */
export function exportSheet(data: any[][], sheetName: string, filename: string) {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(data)
  ws['!cols'] = autoColumnWidths(data)
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))  // 시트명 31자 제한
  XLSX.writeFile(wb, `${filename}_${timestamp()}.xlsx`)
}

/**
 * 여러 시트로 엑셀 내보내기
 * @param sheets  [{ name, rows }] 형식
 * @param filename  파일명 (확장자 제외)
 */
export function exportMultiSheet(sheets: { name: string; rows: any[][] }[], filename: string) {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.rows)
    ws['!cols'] = autoColumnWidths(s.rows)
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31))
  }
  XLSX.writeFile(wb, `${filename}_${timestamp()}.xlsx`)
}

/**
 * 객체 배열을 컬럼 매핑으로 시트화
 * @param rows  데이터 객체 배열
 * @param columns  [{ key, label, format? }] 형식
 */
export function rowsToSheet<T>(
  rows: T[],
  columns: { key: keyof T | string; label: string; format?: (v: any, row: T) => any }[]
): any[][] {
  const header = columns.map(c => c.label)
  const body = rows.map(r => columns.map(c => {
    const raw = (r as any)[c.key as string]
    return c.format ? c.format(raw, r) : (raw ?? '')
  }))
  return [header, ...body]
}
