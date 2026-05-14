import * as XLSX from 'xlsx'

/* ─────────────────────────────────────────────
 * AW 원본 입고내역서 양식 파서
 * 청운상사/마요네즈 등 다중시트·동적 사이즈 컬럼 자동 감지
 * ───────────────────────────────────────────── */

/**
 * 엑셀 셀 값(문자열/숫자/Date) → "YYYY-MM-DD" 변환 — timezone-proof.
 *
 * SheetJS는 환경/옵션에 따라 엑셀 날짜 셀을 다르게 변환함:
 * - cellDates:true 시 Date 객체 (UTC 자정 또는 로컬 자정 — 버전마다 다름)
 * - cellDates:false 시 시리얼 숫자
 * - 사용자가 텍스트로 입력했으면 문자열
 *
 * 따라서 모든 케이스에 대응하고, Date 객체에서는 "자정인 쪽"의 날짜를 사용.
 */
export function excelCellToISODate(cell: any): string | null {
  if (cell == null) return null

  // 1) 문자열 — "2026-05-08" 형태 그대로
  if (typeof cell === 'string') {
    const m = cell.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    return null
  }

  // 2) 숫자 — 엑셀 시리얼 (1900-01-01 기준 일수)
  if (typeof cell === 'number') {
    const parsed = XLSX.SSF.parse_date_code(cell)
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`
    return null
  }

  // 3) Date 객체 — UTC 자정인지 로컬 자정인지 판별해서 그 쪽 날짜 사용
  if (cell instanceof Date) {
    const isUTCMidnight = cell.getUTCHours() === 0 && cell.getUTCMinutes() === 0
    const isLocalMidnight = cell.getHours() === 0 && cell.getMinutes() === 0
    if (isUTCMidnight) {
      // SheetJS가 UTC 자정으로 만듦 → UTC 메서드로 꺼냄
      return `${cell.getUTCFullYear()}-${String(cell.getUTCMonth() + 1).padStart(2, '0')}-${String(cell.getUTCDate()).padStart(2, '0')}`
    }
    if (isLocalMidnight) {
      // 로컬 자정 → 로컬 메서드
      return `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, '0')}-${String(cell.getDate()).padStart(2, '0')}`
    }
    // 둘 다 아니면 — 가장 가까운 자정 쪽으로
    const utcOffsetMin = cell.getTimezoneOffset()
    if (Math.abs(utcOffsetMin * 60 * 1000 - cell.getTime() % (24 * 60 * 60 * 1000)) < 12 * 60 * 60 * 1000) {
      return `${cell.getFullYear()}-${String(cell.getMonth() + 1).padStart(2, '0')}-${String(cell.getDate()).padStart(2, '0')}`
    }
    return `${cell.getUTCFullYear()}-${String(cell.getUTCMonth() + 1).padStart(2, '0')}-${String(cell.getUTCDate()).padStart(2, '0')}`
  }
  return null
}

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
      delivery_date = excelCellToISODate(row[colDate])
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
