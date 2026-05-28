import * as XLSX from 'xlsx'

/* ─────────────────────────────────────────────
 * 원가계산서 시트별 양식 파서
 * (예: 2026SS원가계산서.xlsx — 시트마다 한 상품, NUMBER 행 + STORE/ITEM/PRICE/YARD 표)
 *
 * 자동 감지: 셀 어디든 "STORE" 와 "PRICE" 와 "YARD" 가 같은 행에 있으면 이 양식
 * ───────────────────────────────────────────── */

export interface CostSheetLine {
  store: string       // 공급처명 (예: "충남텍스")
  item_name: string   // 재료/공정명 (예: "피마60스판")
  unit_price: number
  yards: number
}

export interface CostSheet {
  sheetName: string    // 시트명 (참고용)
  product_code: string // 상품번호 (예: "AN26STS0101")
  style_name: string   // 스타일명 (예: "JEWELRY SEE-THOUGH T")
  lines: CostSheetLine[]
}

export function isCostSheetFormat(wb: XLSX.WorkBook): boolean {
  for (const sn of wb.SheetNames.slice(0, 3)) {
    const sheet = wb.Sheets[sn]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    for (let r = 0; r < Math.min(grid.length, 30); r++) {
      const row = (grid[r] || []).map(c => String(c ?? '').trim().toUpperCase())
      if (row.includes('STORE') && row.includes('PRICE') && row.includes('YARD')) {
        return true
      }
    }
  }
  return false
}

export function parseCostWorkbook(wb: XLSX.WorkBook): CostSheet[] {
  const result: CostSheet[] = []
  for (const sn of wb.SheetNames) {
    const sheet = wb.Sheets[sn]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    const parsed = parseOneSheet(sn, grid)
    if (parsed) result.push(parsed)
  }
  return result
}

function parseOneSheet(sheetName: string, grid: any[][]): CostSheet | null {
  // 1) NUMBER 행에서 상품번호 찾기 (보통 R4 근처)
  let product_code = ''
  let style_name = ''
  for (let r = 0; r < Math.min(grid.length, 10); r++) {
    const row = grid[r] || []
    for (let c = 0; c < row.length; c++) {
      const label = String(row[c] ?? '').trim().toUpperCase()
      if (label === 'NUMBER' || label === '상품번호' || label === '품번' || label === 'STYLE NUMBER') {
        // 같은 행의 오른쪽 셀에서 값 찾기
        for (let c2 = c + 1; c2 < row.length; c2++) {
          const v = String(row[c2] ?? '').trim()
          if (v) { product_code = v; break }
        }
      }
      if (label === 'STYLE NAME' || label === '스타일명' || label === '품목명' || label === 'NAME') {
        for (let c2 = c + 1; c2 < row.length; c2++) {
          const v = String(row[c2] ?? '').trim()
          if (v) { style_name = v; break }
        }
      }
    }
  }
  if (!product_code) return null

  // 2) STORE/ITEM/PRICE/YARD 헤더 행 찾기
  let headerRow = -1
  let colStore = -1, colItem = -1, colPrice = -1, colYard = -1
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const row = (grid[r] || []).map(c => String(c ?? '').trim().toUpperCase())
    const iStore = row.indexOf('STORE')
    const iPrice = row.indexOf('PRICE')
    const iYard = row.indexOf('YARD')
    if (iStore >= 0 && iPrice >= 0 && iYard >= 0) {
      headerRow = r
      colStore = iStore
      colItem = row.indexOf('ITEM')
      colPrice = iPrice
      colYard = iYard
      break
    }
  }
  if (headerRow < 0) return null

  // 3) 데이터 행 파싱
  const lines: CostSheetLine[] = []
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || []
    const store = String(row[colStore] ?? '').trim()
    const item_name = colItem >= 0 ? String(row[colItem] ?? '').trim() : ''
    const unit_price = Number(row[colPrice] ?? 0) || 0
    const yards = Number(row[colYard] ?? 0) || 0
    // 의미 있는 행만 (공급처 또는 재료명이 있고 단가>0)
    if (!store && !item_name) continue
    if (unit_price === 0 && yards === 0) continue
    lines.push({ store, item_name: item_name || store, unit_price, yards })
  }

  if (lines.length === 0) return null
  return { sheetName, product_code, style_name, lines }
}
