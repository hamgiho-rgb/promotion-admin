const XLSX = require('xlsx')
const fs = require('fs')
const buf = fs.readFileSync('/tmp/test.xlsx')
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })

function isoDate(cell) {
  if (cell == null) return null
  if (cell instanceof Date) {
    const ms = cell.getTime()
    const dayMs = 24 * 60 * 60 * 1000
    const d = new Date(Math.round(ms / dayMs) * dayMs)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
  }
  return String(cell)
}

const sn = wb.SheetNames[0]
const grid = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: null })
const headerRow = 8, colCode = 0, colName = 2, sizeCols = [4,5], colTotal = 6, colDate = 8, colCarton = 9
const sizeLabels = ['1','2']

const items = []
for (let r = headerRow + 2; r < grid.length; r++) {
  const row = grid[r] || []
  const code = String(row[colCode] ?? '').trim()
  const name = String(row[colName] ?? '').trim()
  if (!code && !name) continue
  const summary = /^(합\s*계|소\s*계|총\s*계|계|total|sum)$/i
  if (summary.test(code) || summary.test(name)) continue
  
  const sizes = {}
  let totalSum = 0
  sizeLabels.forEach((label, i) => {
    const v = Number(row[sizeCols[i]] || 0)
    sizes[label] = v
    totalSum += v
  })
  let total = totalSum
  if (colTotal >= 0) {
    const sheetTotal = Number(row[colTotal] || 0)
    if (sheetTotal > 0) total = sheetTotal
  }
  if (total === 0 && !code) continue
  
  const date = isoDate(row[colDate])
  const carton = Number(row[colCarton])
  const ct = (!isNaN(carton) && carton > 0) ? carton : null
  
  items.push({ row: r+1, code, date, ct, total, sizes })
}

// 중복 키 검사
const seen = new Map()
const dupes = []
let totalAll = 0
let totalAfterDedup = 0
for (const it of items) {
  const k = `${it.date || ''}__${it.code || ''}__${it.ct ?? ''}`
  totalAll += it.total
  if (seen.has(k)) {
    dupes.push({ key: k, first: seen.get(k), dup: it })
  } else {
    seen.set(k, it)
    totalAfterDedup += it.total
  }
}
console.log('총 라인 수:', items.length, '중복(스킵될) 라인:', dupes.length)
console.log('전체 수량 합계:', totalAll)
console.log('중복 스킵 후 등록될 수량 합계:', totalAfterDedup)
console.log()
console.log('=== 중복 라인 (현재 import 로직이 스킵하는 라인들) ===')
for (const d of dupes) {
  console.log(`키: ${d.key}`)
  console.log(`  먼저(살아남음) R${d.first.row}: code=${d.first.code} ct=${d.first.ct} total=${d.first.total} sizes=${JSON.stringify(d.first.sizes)}`)
  console.log(`  스킵됨   R${d.dup.row}: code=${d.dup.code} ct=${d.dup.ct} total=${d.dup.total} sizes=${JSON.stringify(d.dup.sizes)}`)
}
