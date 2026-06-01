const XLSX = require('xlsx')
const fs = require('fs')
const buf = fs.readFileSync('/tmp/test.xlsx')
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })
const grid = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: null })

console.log('R65:', grid[64])
console.log('R66:', grid[65])

// 전체에서 중복 키 검사 (단순화: code + date)
const keyCount = new Map()
for (let r = 10; r < grid.length; r++) {
  const row = grid[r] || []
  const code = String(row[0] ?? '').trim()
  if (!code) continue
  const date = row[8] instanceof Date ? row[8].toISOString().slice(0,10) : String(row[8] ?? '')
  const ct = row[9]
  const k = `${date}__${code}__${ct}`
  keyCount.set(k, (keyCount.get(k) || 0) + 1)
}
console.log('\n=== 같은 (날짜, 품번, C/T) 가 2번 이상 나오는 키 ===')
for (const [k, c] of keyCount) {
  if (c > 1) console.log(`  ${k} → ${c}회`)
}
