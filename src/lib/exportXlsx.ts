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
    /** 사이즈별 분포 (예: {1:56, 2:54}) — 사이즈 컬럼에 "1:56, 2:54" 로 표시됨 */
    sizes?: Record<string, number> | null
  }[]
}

/** 영수증 양식 한 장을 시트(AoA)로 생성 */
function buildReceiptSheet(inv: ReceiptInvoice): { aoa: any[][]; merges: XLSX.Range[]; cols: { wch: number }[]; rows?: { hpx: number }[] } {
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
  let runningSubtotal = 0
  for (let i = 0; i < MAX_ROWS; i++) {
    const r = 12 + i
    const it = items[i]
    if (it) {
      if (i === 0) set(r, 2, inv.issue_date)
      // 컬러 + 사이즈 결정:
      // 1) it.color 에 "컬러/사이즈" 가 있으면 분리
      // 2) it.sizes JSON 있으면 분포 문자열로 (예: "1:56 · 2:54")
      // 3) 둘 다 없으면 상품명 끝의 "(컬러)"를 컬러로 추출
      let colorVal = ''
      let sizeVal = ''
      if (it.color) {
        const [c, s] = splitColorSize(it.color)
        colorVal = c
        sizeVal = s
      }
      // 사이즈 분포가 있으면 그걸 우선 사용 (예: {1:56, 2:54} → "1:56 · 2:54")
      if (it.sizes && Object.keys(it.sizes).length > 0) {
        const parts = Object.entries(it.sizes)
          .filter(([, n]) => Number(n) > 0)
          .map(([sz, n]) => `${sz}:${n}`)
        if (parts.length > 0) sizeVal = parts.join(' · ')
      }
      // 상품명 끝에 "(컬러)" 형태로 컬러가 있고 color 필드가 비어있으면 거기서 추출
      const name = String(it.product_name || '')
      if (!colorVal) {
        const m = name.match(/\(([^()]+)\)\s*$/)
        if (m) colorVal = m[1].trim()
      }
      const qty = Number(it.quantity ?? 0)
      const price = Number(it.unit_price ?? 0)
      const amount = qty * price
      runningSubtotal += amount
      set(r, 4, name)
      set(r, 6, colorVal)
      set(r, 7, sizeVal)
      set(r, 8, qty)
      set(r, 9, price)
      // 금액 — 수식 + 미리 계산된 값 둘 다 (Excel 뷰어 호환성)
      set(r, 10, { f: `I${r}*H${r}`, v: amount })
    } else {
      // 빈 행 (양식 유지) — 금액 0으로 명시
      set(r, 8, 0)
      set(r, 9, 0)
      set(r, 10, 0)
    }
  }
  // 합계 계산
  const vatAmt = Math.round(runningSubtotal * 0.1)
  const totalAmt = runningSubtotal + vatAmt
  // 32행: 계좌정보 / 금일 금액 / 합계 (수식 + 값)
  set(32, 2, inv.bank_info || '')
  set(32, 6, '금일 금액')
  set(32, 9, { f: 'SUM(J12:J31)', v: runningSubtotal })
  // 33행: 세액
  set(33, 6, '세액')
  set(33, 9, { f: 'I32*0.1', v: vatAmt })
  // 34행: 총 합계
  set(34, 6, '총 합계')
  set(34, 9, { f: 'I32+I33', v: totalAmt })
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

  // 한글 문자는 폭이 2배 — wch 계산 시 한글은 2 카운트
  function visualWidth(s: string): number {
    return [...s].reduce((a, ch) => a + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)
  }
  // 데이터 기반 자동 너비 계산 — 컨텐츠 보고 잘리지 않게 늘림
  let maxNameLen = 8     // 품명 (D)
  let maxColorLen = 6    // 품목/컬러 (F)
  let maxSizeLen = 4     // 사이즈 (G)
  let maxQtyLen = 4      // 수량 (H)
  let maxPriceLen = 6    // 단가 (I)
  let maxAmountLen = 8   // 금액 (J)
  inv.items.forEach(it => {
    const [col, sz] = splitColorSize(it.color)
    const name = String(it.product_name || '')
    maxNameLen = Math.max(maxNameLen, visualWidth(name))
    maxColorLen = Math.max(maxColorLen, visualWidth(col))
    maxSizeLen = Math.max(maxSizeLen, visualWidth(sz))
    const qStr = String(it.quantity ?? 0)
    const pStr = (it.unit_price ?? 0).toLocaleString()
    const aStr = ((it.quantity || 0) * (it.unit_price || 0)).toLocaleString()
    maxQtyLen = Math.max(maxQtyLen, qStr.length)
    maxPriceLen = Math.max(maxPriceLen, pStr.length)
    maxAmountLen = Math.max(maxAmountLen, aStr.length)
  })
  // 공급자 주소도 봐서 D-J 라인이 충분한지 체크
  const addrLen = visualWidth(inv.supplier_address || '')
  const vendorLen = visualWidth(inv.vendor_name || '')

  // 컬럼 너비 (한글 기준 넉넉히 + 2칸 패딩)
  const cols = [
    { wch: 3 },                                          // A 좌측 여백
    { wch: 14 },                                         // B 날짜
    { wch: 6 },                                          // C 보조
    { wch: Math.max(32, maxNameLen + 2) },              // D 품명 — 컨텐츠 기반 늘어남
    { wch: 6 },                                          // E 보조
    { wch: Math.max(22, maxColorLen + 2) },             // F 품목/컬러
    { wch: Math.max(10, maxSizeLen + 2) },              // G 사이즈
    { wch: Math.max(10, maxQtyLen + 2) },               // H 수량
    { wch: Math.max(14, maxPriceLen + 2) },             // I 단가
    { wch: Math.max(16, maxAmountLen + 2) },            // J 금액
  ]
  // 공급자 영역(F4:J4 사업자번호 등) 도 너무 좁지 않게: F~J 합계가 주소/거래처명을 담을 수 있어야
  const fThruJ = cols[5].wch + cols[6].wch + cols[7].wch + cols[8].wch + cols[9].wch
  const need = Math.max(addrLen, vendorLen) + 4
  if (fThruJ < need) {
    // F 늘려서 채움
    cols[5] = { wch: cols[5].wch + (need - fThruJ) }
  }

  // 행 높이 (병합된 헤더가 잘 보이도록)
  const rows = [
    { hpx: 28 },  // 1: 타이틀 영역
    { hpx: 26 },  // 2: 영수증
    { hpx: 22 },  // 3: 귀하
    { hpx: 22 },  // 4: 공급자/사업자번호 헤더
    { hpx: 22 },  // 5: 상호/성명
    { hpx: 22 },  // 6
    { hpx: 22 },  // 7-8: 사업장소재지 (병합) — 주소가 길어서 2줄
    { hpx: 22 },  // 8
    { hpx: 22 },  // 9: 작성일/금일금액 헤더
    { hpx: 22 },  // 10: 작성일/금액 값
    { hpx: 22 },  // 11: 컬럼 헤더 (날짜 품명 품목 사이즈 ...)
  ]

  return { aoa, merges, cols, rows }
}

/** AoA를 시트로 변환하면서 수식/병합/너비 적용. 텍스트 셀에는 wrap_text 자동 부여. */
function aoaToSheetWithFormulas(aoa: any[][]): XLSX.WorkSheet {
  const ws: XLSX.WorkSheet = {}
  const numRows = aoa.length
  const numCols = aoa[0]?.length || 0
  const wrapStyle = { alignment: { wrapText: true, vertical: 'center' } }
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      const v = aoa[r][c]
      if (v == null || v === '') continue
      const addr = XLSX.utils.encode_cell({ r, c })
      if (typeof v === 'object' && (v as any).f) {
        // 수식 + 미리 계산된 값 — Excel 외 뷰어(번들/Pages/모바일)에서도 결과 보이게
        const cell: any = { t: 'n', f: (v as any).f }
        if (typeof (v as any).v === 'number') {
          cell.v = (v as any).v
          if ((v as any).v >= 1000 || (v as any).v <= -1000) cell.z = '#,##0'
        }
        ws[addr] = cell
      } else if (typeof v === 'number') {
        ws[addr] = { t: 'n', v, z: v >= 1000 || v <= -1000 ? '#,##0' : undefined }
      } else if (v instanceof Date) {
        ws[addr] = { t: 'd', v, z: 'yyyy-mm-dd' }
      } else {
        // 텍스트 셀 → 자동 줄바꿈 스타일 시도 (커뮤니티 SheetJS 일부 버전에서만 동작)
        ws[addr] = { t: 's', v: String(v), s: wrapStyle } as any
      }
    }
  }
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: numRows - 1, c: numCols - 1 } })
  return ws
}

/* ─────────────────────────────────────────────
 * 새 동적 양식 — 출력 화면과 똑같이
 * - 사이즈별 컬럼 자동 (1,2 또는 110,120,130 ...)
 * - 모든 라인 표시 (20줄 제한 없음)
 * - 합계 / 부가세 / 총합 자동
 * ───────────────────────────────────────────── */
export interface FullInvoiceLine {
  product_name?: string | null
  color?: string | null
  sizes?: Record<string, number> | null
  quantity?: number | null
  unit_price?: number | null
}
export interface FullInvoice {
  vendor_name: string
  issue_date: string
  supplier_business_number?: string | null
  supplier_name?: string | null
  supplier_ceo?: string | null
  supplier_address?: string | null
  bank_info?: string | null
  notes?: string | null
  /** 사이즈 라벨 (없으면 lines에서 자동 추출) */
  size_labels?: string[]
  lines: FullInvoiceLine[]
}

export function exportInvoiceFull(inv: FullInvoice, filename?: string) {
  // 사이즈 라벨 추출 — 명시 안 했으면 모든 라인의 sizes 키 합집합
  let sizeLabels = inv.size_labels && inv.size_labels.length > 0 ? inv.size_labels : []
  if (sizeLabels.length === 0) {
    const set = new Set<string>()
    inv.lines.forEach(l => {
      if (l.sizes) Object.keys(l.sizes).forEach(k => set.add(k))
    })
    sizeLabels = Array.from(set).sort((a, b) => {
      const na = Number(a), nb = Number(b)
      if (!isNaN(na) && !isNaN(nb)) return na - nb
      return a.localeCompare(b)
    })
  }
  const hasSizes = sizeLabels.length > 0
  const hasColor = inv.lines.some(l => l.color && l.color.trim())

  // 컬럼 구성: 품명 | [컬러] | [사이즈들...] | 수량 | 단가 | 금액
  const headerCols: string[] = ['품명']
  if (hasColor) headerCols.push('컬러')
  sizeLabels.forEach(s => headerCols.push(s))
  headerCols.push('수량', '단가', '금액')

  // 한글 시각 너비
  const vw = (s: string) => [...(s || '')].reduce((a, ch) => a + (ch.charCodeAt(0) > 127 ? 2 : 1), 0)

  // 컬럼 너비 — 컨텐츠 기반
  const colWidths: number[] = []
  // 품명 컬럼
  let maxNameW = vw('품명')
  inv.lines.forEach(l => { maxNameW = Math.max(maxNameW, vw(l.product_name || '')) })
  colWidths.push(Math.max(28, maxNameW + 2))
  // 컬러 컬럼
  if (hasColor) {
    let maxColorW = vw('컬러')
    inv.lines.forEach(l => { maxColorW = Math.max(maxColorW, vw(l.color || '')) })
    colWidths.push(Math.max(10, maxColorW + 2))
  }
  // 사이즈 컬럼들
  sizeLabels.forEach(label => {
    let maxW = vw(label) + 2
    inv.lines.forEach(l => {
      const v = String(l.sizes?.[label] ?? '')
      maxW = Math.max(maxW, v.length + 2)
    })
    colWidths.push(Math.max(7, maxW))
  })
  // 수량 / 단가 / 금액
  let maxQty = vw('수량'), maxPrice = vw('단가'), maxAmt = vw('금액')
  inv.lines.forEach(l => {
    const q = Number(l.quantity || 0)
    const p = Number(l.unit_price || 0)
    maxQty = Math.max(maxQty, String(q.toLocaleString()).length)
    maxPrice = Math.max(maxPrice, String(p.toLocaleString()).length)
    maxAmt = Math.max(maxAmt, String((q * p).toLocaleString()).length)
  })
  colWidths.push(Math.max(8, maxQty + 2))
  colWidths.push(Math.max(10, maxPrice + 2))
  colWidths.push(Math.max(12, maxAmt + 2))

  // AoA 구성
  const aoa: any[][] = []
  // 상단 헤더 정보 (5행)
  aoa.push(['영 수 증 (공급받는자용)'])
  aoa.push([`${inv.vendor_name || ''} 귀하`])
  aoa.push([`작성일: ${inv.issue_date || ''}`])
  aoa.push([`공급자: ${inv.supplier_name || ''}  사업자번호: ${inv.supplier_business_number || ''}  대표: ${inv.supplier_ceo || ''}`])
  aoa.push([`주소: ${inv.supplier_address || ''}`])
  aoa.push([])  // 빈줄
  // 컬럼 헤더
  aoa.push(headerCols)
  // 데이터 라인
  let subtotal = 0
  inv.lines.forEach(l => {
    const qty = Number(l.quantity || 0)
    const price = Number(l.unit_price || 0)
    const amount = qty * price
    subtotal += amount
    const row: any[] = [l.product_name || '']
    if (hasColor) row.push(l.color || '')
    sizeLabels.forEach(s => {
      const v = l.sizes?.[s]
      row.push(v && v > 0 ? v : '')
    })
    row.push(qty)
    row.push(price)
    row.push(amount)
    aoa.push(row)
  })
  // 합계
  const vat = Math.round(subtotal * 0.1)
  const total = subtotal + vat
  const endCol = headerCols.length
  aoa.push([])
  const padEnd = (label: string, val: number) => {
    const row = new Array(endCol).fill('')
    row[endCol - 4] = label   // 수량 칸 라벨
    row[endCol - 1] = val     // 금액 칸 값
    return row
  }
  aoa.push(padEnd('소계', subtotal))
  aoa.push(padEnd('부가세 (10%)', vat))
  aoa.push(padEnd('총 합계', total))
  aoa.push([])
  if (inv.bank_info) aoa.push([`입금 계좌: ${inv.bank_info}`])
  aoa.push(['※ 위 금액을 청구(영수)함'])

  // 시트 구성
  const ws: XLSX.WorkSheet = {}
  for (let r = 0; r < aoa.length; r++) {
    const row = aoa[r]
    for (let c = 0; c < row.length; c++) {
      const v = row[c]
      if (v == null || v === '') continue
      const addr = XLSX.utils.encode_cell({ r, c })
      if (typeof v === 'number') {
        ws[addr] = { t: 'n', v, z: v >= 1000 || v <= -1000 ? '#,##0' : undefined }
      } else {
        ws[addr] = { t: 's', v: String(v) }
      }
    }
  }
  const maxCols = Math.max(headerCols.length, ...aoa.map(r => r.length))
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: aoa.length - 1, c: maxCols - 1 } })

  // 컬럼 너비 + 상단 5줄에 대해서는 wide merges
  ws['!cols'] = colWidths.map(w => ({ wch: w }))
  const decode = (s: string) => XLSX.utils.decode_range(s)
  const lastColLetter = XLSX.utils.encode_col(endCol - 1)
  ws['!merges'] = [
    decode(`A1:${lastColLetter}1`),
    decode(`A2:${lastColLetter}2`),
    decode(`A3:${lastColLetter}3`),
    decode(`A4:${lastColLetter}4`),
    decode(`A5:${lastColLetter}5`),
  ]

  const wb = XLSX.utils.book_new()
  const sheetName = (inv.vendor_name || '계산서').slice(0, 31)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  const fname = filename || `계산서_${inv.vendor_name}_${inv.issue_date}`
  XLSX.writeFile(wb, `${fname}.xlsx`)
}

/** 단일 영수증 다운로드 */
export function exportInvoiceReceipt(inv: ReceiptInvoice, filename?: string) {
  const { aoa, merges, cols, rows } = buildReceiptSheet(inv)
  const ws = aoaToSheetWithFormulas(aoa)
  ws['!merges'] = merges
  ws['!cols'] = cols
  if (rows) ws['!rows'] = rows
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
    const { aoa, merges, cols, rows } = buildReceiptSheet(inv)
    const ws = aoaToSheetWithFormulas(aoa)
    ws['!merges'] = merges
    ws['!cols'] = cols
    if (rows) ws['!rows'] = rows
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
