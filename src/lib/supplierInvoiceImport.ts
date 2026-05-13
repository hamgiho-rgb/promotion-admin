import * as XLSX from 'xlsx'

/* ─────────────────────────────────────────────
 * 공급처 계산서 양식 파서 (두 가지 지원)
 *
 * 1. 대성식 (공임):
 *    헤더: 날짜 | 품목 | 상호 | 수량 | 단가 | 총액
 *
 * 2. 누리나염식 (간단):
 *    헤더: 날짜 | 품명 | 수량 | 단가 | 금액
 *    (상호 컬럼 없음)
 *
 * 시트명 = "26년5월", "2024-05", "5월" 등 다양 → period 추출
 * ───────────────────────────────────────────── */

export interface SupplierInvoiceLine {
  line_date: string | null
  product_name: string
  brand: string | null     // 상호 (있으면)
  quantity: number
  unit_price: number
  amount: number
}

export interface SupplierInvoiceSheet {
  sheetName: string
  period: string | null    // "2026-05" 형식
  lines: SupplierInvoiceLine[]
  subtotal: number
}

export function isSupplierInvoiceFormat(wb: XLSX.WorkBook): boolean {
  // 첫 시트에서 헤더에 (날짜+품목+수량+단가+총액) 또는 (날짜+품명+수량+단가+금액) 발견
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    for (let r = 0; r < Math.min(grid.length, 8); r++) {
      const row = (grid[r] || []).map(c => String(c ?? '').trim())
      const hasDate = row.includes('날짜') || row.includes('날 짜')
      const hasItem = row.includes('품목') || row.includes('품명') || row.includes('품 명') || row.includes('품 명 ')
      const hasQty = row.includes('수량') || row.includes('수 량')
      const hasPrice = row.includes('단가') || row.includes('단 가') || row.includes('단 가 ')
      const hasTotal = row.includes('총액') || row.includes('금액') || row.includes('금 액')
      if (hasDate && hasItem && hasQty && hasPrice && hasTotal) return true
    }
    return false
  }
  return false
}

export function parseSupplierInvoiceWorkbook(wb: XLSX.WorkBook): SupplierInvoiceSheet[] {
  const out: SupplierInvoiceSheet[] = []
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    const parsed = parseSheet(sn, grid)
    if (parsed && parsed.lines.length > 0) out.push(parsed)
  }
  return out
}

function parseSheet(sheetName: string, grid: any[][]): SupplierInvoiceSheet | null {
  // 1. 헤더 행 찾기
  let headerRow = -1
  let colDate = -1, colName = -1, colBrand = -1, colQty = -1, colPrice = -1, colAmt = -1
  for (let r = 0; r < Math.min(grid.length, 8); r++) {
    const row = (grid[r] || []).map(c => String(c ?? '').trim())
    const findCol = (...keys: string[]) => {
      for (const k of keys) {
        const i = row.indexOf(k)
        if (i >= 0) return i
      }
      return -1
    }
    const dCol = findCol('날짜', '날 짜')
    const nCol = findCol('품목', '품명', '품 명', '품 명 ')
    const qCol = findCol('수량', '수 량')
    const pCol = findCol('단가', '단 가', '단 가 ')
    const aCol = findCol('총액', '금액', '금 액')
    if (dCol >= 0 && nCol >= 0 && qCol >= 0 && pCol >= 0 && aCol >= 0) {
      headerRow = r
      colDate = dCol; colName = nCol; colQty = qCol; colPrice = pCol; colAmt = aCol
      colBrand = findCol('상호', '거래처', '브랜드')
      break
    }
  }
  if (headerRow < 0) return null

  // 2. period 추출 — "26년5월" → "2026-05", "5월" → null, "2024-05" → "2024-05"
  const period = extractPeriod(sheetName)

  // 3. 데이터 행
  const lines: SupplierInvoiceLine[] = []
  let subtotal = 0
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || []
    const name = String(row[colName] ?? '').trim()
    const qty = Number(row[colQty] || 0)
    const price = Number(row[colPrice] || 0)
    if (!name && qty === 0 && price === 0) continue
    if (!name) continue
    const amt = Number(row[colAmt] || 0) || qty * price
    const brand = colBrand >= 0 ? (String(row[colBrand] ?? '').trim() || null) : null
    let line_date: string | null = null
    const d = row[colDate]
    if (d instanceof Date) {
      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
      line_date = `${y}-${m}-${dd}`
    }
    subtotal += amt
    lines.push({
      line_date, product_name: name, brand,
      quantity: qty, unit_price: price, amount: amt,
    })
  }

  return { sheetName, period, lines, subtotal }
}

function extractPeriod(sn: string): string | null {
  // "26년5월" → 2026-05
  let m = sn.match(/(\d{2,4})\s*년\s*(\d{1,2})\s*월/)
  if (m) {
    let y = parseInt(m[1])
    if (y < 100) y += 2000
    const mo = parseInt(m[2])
    return `${y}-${String(mo).padStart(2, '0')}`
  }
  // "2024-05" or "2024.05"
  m = sn.match(/(\d{4})[-.](\d{1,2})/)
  if (m) return `${m[1]}-${String(parseInt(m[2])).padStart(2, '0')}`
  // "5월" 단독 — 연도 모름
  return null
}
