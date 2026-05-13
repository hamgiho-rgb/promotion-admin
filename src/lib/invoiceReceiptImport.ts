import * as XLSX from 'xlsx'

/* ─────────────────────────────────────────────
 * 영수증 양식 계산서 파서 (일리오/청운상사 등)
 *
 * 시트 1개 = 계산서 1건
 * 시트명 = "5월8일", "3월26일" 등 날짜 표기
 * B2 = "영 수 증(공급받는자용)"
 * B3 = "OOO 귀하"
 * B9 작성일 / B10 날짜값
 * F9 금일 금액 / F10 합계 수식 (또는 값)
 * R11 헤더: 날짜|품명|품목|사이즈|수량|단가|금액
 * R12~ 데이터 (보통 ~R31까지)
 * ───────────────────────────────────────────── */

export interface ReceiptInvoiceLine {
  product_name: string
  color: string | null
  size: string | null
  quantity: number
  unit_price: number
}

export interface ReceiptInvoice {
  sheetName: string
  vendor_name: string
  issue_date: string         // YYYY-MM-DD
  lines: ReceiptInvoiceLine[]
  subtotal: number           // sum(qty * price)
}

export function isInvoiceReceiptFormat(wb: XLSX.WorkBook): boolean {
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    for (let r = 0; r < Math.min(grid.length, 10); r++) {
      const row = grid[r] || []
      for (const cell of row) {
        const s = String(cell ?? '')
        if (s.includes('영 수 증') || s.includes('영수증(공급받는자용)')) return true
      }
    }
    return false
  }
  return false
}

export function parseInvoiceReceiptWorkbook(wb: XLSX.WorkBook): ReceiptInvoice[] {
  const out: ReceiptInvoice[] = []
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    const parsed = parseInvoiceReceiptSheet(sn, grid)
    if (parsed) out.push(parsed)
  }
  return out
}

function parseInvoiceReceiptSheet(sheetName: string, grid: any[][]): ReceiptInvoice | null {
  // 1. 거래처명 — "OOO 귀하"
  let vendor_name = ''
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const row = grid[r] || []
    for (const cell of row) {
      const s = String(cell ?? '').trim()
      const m = s.match(/^(.+?)\s*귀하\s*$/)
      if (m) { vendor_name = m[1].trim(); break }
    }
    if (vendor_name) break
  }
  if (!vendor_name) return null

  // 2. 작성일 찾기 — "작성일" 옆 칸의 날짜값
  let issue_date: string | null = null
  for (let r = 0; r < Math.min(grid.length, 12); r++) {
    const row = grid[r] || []
    for (let c = 0; c < row.length; c++) {
      if (String(row[c] ?? '').trim() === '작성일') {
        // 같은 컬럼 다음 행
        const dv = grid[r + 1]?.[c]
        const d = parseAnyDate(dv)
        if (d) { issue_date = d; break }
      }
    }
    if (issue_date) break
  }
  // 작성일 없으면 시트 이름에서 추정 (예: "5월8일" → 추정 어려움; 일단 null)
  if (!issue_date) {
    // 시트명 패턴 "M월D일" 또는 "MM월DD일"
    const m = sheetName.match(/(\d{1,2})월\s*(\d{1,2})일?/)
    if (m) {
      const month = parseInt(m[1], 10)
      const day = parseInt(m[2], 10)
      // 연도는 헤더에서 추정 또는 현재
      const year = new Date().getFullYear()
      // 단순히 연도+월+일로 만듦
      issue_date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }
  if (!issue_date) return null

  // 3. 헤더 행 찾기 — "날짜","품명","품목","사이즈","수량","단가","금액"
  let headerRow = -1
  let colDate = -1, colName = -1, colColor = -1, colSize = -1, colQty = -1, colPrice = -1, colAmt = -1
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = grid[r] || []
    const text = row.map(c => String(c ?? '').trim())
    if (text.includes('품명') && text.includes('수량') && text.includes('단가')) {
      headerRow = r
      colDate = text.indexOf('날짜')
      colName = text.indexOf('품명')
      colColor = text.indexOf('품목')
      colSize = text.indexOf('사이즈')
      colQty = text.indexOf('수량')
      colPrice = text.indexOf('단가')
      colAmt = text.indexOf('금액')
      break
    }
  }
  if (headerRow < 0 || colName < 0 || colQty < 0 || colPrice < 0) return null

  // 4. 데이터 행 읽기 — 합계 영역까지
  const lines: ReceiptInvoiceLine[] = []
  let subtotal = 0
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || []
    // 합계 영역 만나면 stop ("금일 금액" / "세액" / "총 합계" / "위 금액을 청구")
    const text = row.map(c => String(c ?? '').trim())
    if (text.some(t => /^(금일 금액|세액|총\s*합계|위 금액)/.test(t))) break

    const name = String(row[colName] ?? '').trim()
    const qty = Number(row[colQty] || 0)
    const price = Number(row[colPrice] || 0)
    if (!name && qty === 0 && price === 0) continue
    if (!name) continue

    const color = colColor >= 0 ? (String(row[colColor] ?? '').trim() || null) : null
    const size = colSize >= 0 ? (String(row[colSize] ?? '').trim() || null) : null
    const amt = qty * price
    subtotal += amt

    lines.push({
      product_name: name,
      color,
      size,
      quantity: qty,
      unit_price: price,
    })
  }

  if (lines.length === 0) return null

  return { sheetName, vendor_name, issue_date, lines, subtotal }
}

function parseAnyDate(v: any): string | null {
  if (!v) return null
  if (v instanceof Date) {
    const y = v.getFullYear()
    const m = String(v.getMonth() + 1).padStart(2, '0')
    const d = String(v.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  if (typeof v === 'number') {
    const parsed = XLSX.SSF.parse_date_code(v)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`
  return null
}
