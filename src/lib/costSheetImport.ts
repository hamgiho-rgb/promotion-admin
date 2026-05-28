import * as XLSX from 'xlsx'

/* ─────────────────────────────────────────────
 * 원가계산서 다양한 양식 파서
 *
 * 자동 감지하는 양식:
 *   1. 시트별 한 상품 (2026SS원가계산서.xlsx)
 *      - 시트마다 한 상품, NUMBER 행에 상품번호
 *      - STORE/ITEM/PRICE/YARD 표 1개
 *   2. 가로 그리드 (챕터원가계산서.xlsx, 로맨티생산단가)
 *      - 한 시트에 여러 상품을 가로로 나란히
 *      - 각 블록 위에 상품명 (한글)
 *      - STORE/ITEM/PRICE/YARD 표 여러 개
 *
 * 자동 감지: 시트 어디든 STORE/PRICE/YARD 가 같은 행에 있는 위치를 모두 찾음
 * ───────────────────────────────────────────── */

export interface CostSheetLine {
  store: string
  item_name: string
  unit_price: number
  yards: number
}

export interface CostSheet {
  sheetName: string
  product_code: string      // 양식에 NUMBER 있을 때 (없으면 빈 문자열)
  product_name: string      // 양식의 상품명 (한글 or 영문) — 매칭 fallback
  style_name: string        // 영문 이름 (양식에 STYLE NAME 있을 때)
  lines: CostSheetLine[]
}

export function isCostSheetFormat(wb: XLSX.WorkBook): boolean {
  for (const sn of wb.SheetNames.slice(0, 3)) {
    const sheet = wb.Sheets[sn]
    const grid: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
    for (let r = 0; r < Math.min(grid.length, 40); r++) {
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
    const blocks = parseAllBlocksInSheet(sn, grid)
    result.push(...blocks)
  }
  return result
}

/**
 * 한 시트에서 STORE/PRICE/YARD 헤더가 있는 모든 위치(가로/세로 어디든)를 찾아
 * 각각의 블록을 CostSheet로 변환.
 */
function parseAllBlocksInSheet(sheetName: string, grid: any[][]): CostSheet[] {
  const headerPositions: { row: number; colStore: number; colItem: number; colPrice: number; colYard: number }[] = []

  for (let r = 0; r < grid.length; r++) {
    const row = grid[r] || []
    for (let c = 0; c < row.length; c++) {
      const cellUp = String(row[c] ?? '').trim().toUpperCase()
      if (cellUp !== 'STORE') continue
      // 오른쪽 6칸 안에 PRICE 와 YARD 가 있는지 확인
      let colPrice = -1, colYard = -1, colItem = -1
      for (let c2 = c + 1; c2 < Math.min(c + 7, row.length); c2++) {
        const u = String(row[c2] ?? '').trim().toUpperCase()
        if (u === 'ITEM' && colItem < 0) colItem = c2
        if (u === 'PRICE' && colPrice < 0) colPrice = c2
        if (u === 'YARD' && colYard < 0) colYard = c2
      }
      if (colPrice >= 0 && colYard >= 0) {
        headerPositions.push({ row: r, colStore: c, colItem, colPrice, colYard })
      }
    }
  }

  const blocks: CostSheet[] = []
  for (const pos of headerPositions) {
    const block = extractBlock(sheetName, grid, pos)
    if (block && block.lines.length > 0) blocks.push(block)
  }
  return blocks
}

function extractBlock(
  sheetName: string,
  grid: any[][],
  pos: { row: number; colStore: number; colItem: number; colPrice: number; colYard: number }
): CostSheet | null {
  const { row: headerRow, colStore, colItem, colPrice, colYard } = pos
  const blockRightLimit = colYard + 2  // 같은 블록 영역 (다음 블록 침범 방지)

  // 상품번호/상품명 찾기 — 헤더 행 위쪽 5행 안에서 NUMBER / STYLE NAME / 일반 텍스트 라벨
  let product_code = ''
  let style_name = ''
  let product_name = ''
  for (let r = Math.max(0, headerRow - 6); r < headerRow; r++) {
    const row = grid[r] || []
    for (let c = Math.max(0, colStore - 1); c <= blockRightLimit && c < row.length; c++) {
      const labelRaw = String(row[c] ?? '').trim()
      const label = labelRaw.toUpperCase()
      if (label === 'NUMBER' || label === '상품번호' || label === '품번' || label === 'STYLE NUMBER') {
        for (let c2 = c + 1; c2 <= blockRightLimit && c2 < row.length; c2++) {
          const v = String(row[c2] ?? '').trim()
          if (v) { product_code = v; break }
        }
      } else if (label === 'STYLE NAME' || label === '스타일명' || label === '품목명' || label === 'NAME') {
        for (let c2 = c + 1; c2 <= blockRightLimit && c2 < row.length; c2++) {
          const v = String(row[c2] ?? '').trim()
          if (v) { style_name = v; break }
        }
      } else if (label === 'ORDER LIST') {
        // 그 위 행에서 상품명 (라벨 없는 한글)
        const aboveRow = grid[r - 1] || []
        for (let c2 = colStore; c2 <= blockRightLimit && c2 < aboveRow.length; c2++) {
          const v = String(aboveRow[c2] ?? '').trim()
          if (v) { product_name = v; break }
        }
      } else if (labelRaw && !product_name && /^[가-힣]/.test(labelRaw)) {
        // 한글로 시작하는 라벨 — 상품명일 가능성 (fallback)
        if (c === colStore || c === colStore - 1) product_name = labelRaw
      }
    }
  }

  // 매칭에 쓸 식별자가 하나라도 있어야 함
  if (!product_code && !product_name && !style_name) return null

  // 데이터 행 파싱 — 헤더 행 아래
  const lines: CostSheetLine[] = []
  for (let r = headerRow + 1; r < grid.length; r++) {
    const row = grid[r] || []
    const store = String(row[colStore] ?? '').trim()
    const item_name = colItem >= 0 ? String(row[colItem] ?? '').trim() : ''
    const priceRaw = row[colPrice]
    const yardRaw = row[colYard]
    const unit_price = Number(priceRaw ?? 0) || 0
    const yards = Number(yardRaw ?? 0) || 0

    // 빈 행 3회 연속이면 stop (블록 끝)
    if (!store && !item_name && unit_price === 0 && yards === 0) {
      // 다음 행도 빈지 확인
      let emptyCount = 1
      for (let r2 = r + 1; r2 < Math.min(r + 4, grid.length); r2++) {
        const row2 = grid[r2] || []
        const s2 = String(row2[colStore] ?? '').trim()
        const i2 = colItem >= 0 ? String(row2[colItem] ?? '').trim() : ''
        const p2 = Number(row2[colPrice] ?? 0)
        const y2 = Number(row2[colYard] ?? 0)
        if (!s2 && !i2 && !p2 && !y2) emptyCount++
        else break
      }
      if (emptyCount >= 3) break
      continue
    }

    // 합계/노트 행 스킵
    if (/^(합\s*계|소\s*계|총\s*계|계|total|sum)$/i.test(store) || /^(합\s*계|소\s*계|총\s*계|계|total|sum)$/i.test(item_name)) continue

    // 의미 없는 행 스킵
    if (unit_price === 0 && yards === 0) continue

    lines.push({ store, item_name: item_name || store, unit_price, yards })
  }

  if (lines.length === 0) return null
  return { sheetName, product_code, product_name, style_name, lines }
}
