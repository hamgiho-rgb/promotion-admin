import * as XLSX from 'xlsx'

/* ─────────────────────────────────────────────
 * AW 원본 입고내역서 양식 파서
 * 청운상사/마요네즈 등 다중시트·동적 사이즈 컬럼 자동 감지
 * ───────────────────────────────────────────── */

export interface AWIncomingItem {
  product_code: string
  product_name: string
  sizes: Record<string, number>
  total: number
  delivery_date: string | null
  carton_no: number | null
}

export interface AWReceipt {
  sheetName: string
  vendor_name: string
  period: string | null      // YYYY.MM
  sizeLabels: string[]       // ["110","120",...] or ["1","2"] or ["S","M","L"]
  items: AWIncomingItem[]
}

export function isAWIncomingFormat(wb: XLSX.WorkBook): boolean {
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    for (let r = 0; r < Math.min(grid.length, 10); r++) {
      const row = grid[r] || []
      for (const cell of row) {
        const s = String(cell ?? '')
        if (s.includes('입 고 내 역 서') || s.includes('입고내역서') || /\S+\s*귀하/.test(s)) {
          return true
        }
      }
    }
    return false
  }
  return false
}

export function parseAWWorkbook(wb: XLSX.WorkBook): AWReceipt[] {
  const receipts: AWReceipt[] = []
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    const parsed = parseAWSheet(sheetName, grid)
    if (parsed) receipts.push(parsed)
  }
  return receipts
}

function parseAWSheet(sheetName: string, grid: any[][]): AWReceipt | null {
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

  // 2. period
  let period: string | null = null
  if (/^\d{4}\.\d{2}$/.test(sheetName)) period = sheetName
  if (!period) {
    for (let r = 0; r < Math.min(grid.length, 5); r++) {
      for (const cell of grid[r] || []) {
        const s = String(cell ?? '').trim()
        if (/^\d{4}\.\d{2}$/.test(s)) { period = s; break }
      }
      if (period) break
    }
  }

  // 3. 헤더 행 — "품번", "품목", "사이즈", "합계"
  let headerRow = -1
  let colCode = -1, colName = -1, colSizeStart = -1, colTotal = -1, colDate = -1, colCarton = -1
  for (let r = 0; r < Math.min(grid.length, 20); r++) {
    const row = grid[r] || []
    const text = row.map(c => String(c ?? '').trim())
    if (text.includes('품번') && text.includes('품목') && text.includes('사이즈') && text.includes('합계')) {
      headerRow = r
      colCode = text.indexOf('품번')
      colName = text.indexOf('품목')
      colSizeStart = text.indexOf('사이즈')
      colTotal = text.indexOf('합계')
      colDate = text.indexOf('입고일')
      colCarton = text.indexOf('C/T')
      if (colCarton < 0) colCarton = text.indexOf('CT')
      break
    }
  }
  if (headerRow < 0) return null

  // 4. 사이즈 라벨
  const sizeLabels: string[] = []
  const sizeCols: number[] = []
  if (headerRow + 1 < grid.length) {
    const labelRow = grid[headerRow + 1] || []
    for (let c = colSizeStart; c < (colTotal > 0 ? colTotal : labelRow.length); c++) {
      const v = labelRow[c]
      if (v == null || v === '') continue
      sizeLabels.push(String(v).trim())
      sizeCols.push(c)
    }
  }
  if (sizeLabels.length === 0) return null

  // 5. 데이터
  const items: AWIncomingItem[] = []
  for (let r = headerRow + 2; r < grid.length; r++) {
    const row = grid[r] || []
    const code = String(row[colCode] ?? '').trim()
    const name = String(row[colName] ?? '').trim()
    if (!code && !name) continue
    if (code === '품번' || name === '품목') continue
    // 합계/소계 행 스킵 — 이게 입고로 잡히면 수량이 더블이 됨
    const summary = /^(합\s*계|소\s*계|총\s*계|계|total|sum)$/i
    if (summary.test(code) || summary.test(name)) continue
    if (!code && summary.test(name)) continue

    const sizes: Record<string, number> = {}
    let total = 0
    sizeLabels.forEach((label, i) => {
      const v = Number(row[sizeCols[i]] || 0)
      sizes[label] = v
      total += v
    })
    if (colTotal >= 0) {
      const sheetTotal = Number(row[colTotal] || 0)
      if (sheetTotal > 0) total = sheetTotal
    }
    if (total === 0 && !code) continue

    let delivery_date: string | null = null
    if (colDate >= 0) {
      const d = row[colDate]
      if (d instanceof Date) {
        // SheetJS의 cellDates:true는 엑셀 셀 날짜를 UTC 자정의 Date로 변환함.
        // → UTC 메서드로 꺼내야 엑셀에 적힌 그 날짜가 그대로 나옴.
        // (로컬 메서드로 꺼내면 한국시간(UTC+9) 변환 후 자정 전이라 전날로 보일 수 있음)
        const y = d.getUTCFullYear()
        const m = String(d.getUTCMonth() + 1).padStart(2, '0')
        const day = String(d.getUTCDate()).padStart(2, '0')
        delivery_date = `${y}-${m}-${day}`
      } else if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) delivery_date = d.slice(0, 10)
      else if (typeof d === 'number') {
        // 엑셀 시리얼 숫자 — XLSX.SSF로 변환 (timezone 무관)
        const parsed = XLSX.SSF.parse_date_code(d)
        if (parsed) delivery_date = `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
      }
    }

    let carton_no: number | null = null
    if (colCarton >= 0) {
      const c = Number(row[colCarton])
      if (!isNaN(c) && c > 0) carton_no = c
    }

    items.push({ product_code: code, product_name: name, sizes, total, delivery_date, carton_no })
  }

  if (items.length === 0) return null
  return { sheetName, vendor_name, period, sizeLabels, items }
}
