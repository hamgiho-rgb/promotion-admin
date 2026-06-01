const XLSX = require('xlsx')
const fs = require('fs')

const buf = fs.readFileSync('/tmp/test.xlsx')
const wb = XLSX.read(buf, { type: 'buffer', cellDates: true })

for (const sn of wb.SheetNames) {
  const sheet = wb.Sheets[sn]
  const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })

  console.log('=== Sheet:', sn, '===')

  // 헤더 찾기
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
  console.log('Header row:', headerRow, 'colCode:', colCode, 'colName:', colName,
    'colSizeStart:', colSizeStart, 'colTotal:', colTotal, 'colDate:', colDate, 'colCarton:', colCarton)

  const sizeLabels = []
  const sizeCols = []
  if (headerRow + 1 < grid.length) {
    const labelRow = grid[headerRow + 1] || []
    for (let c = colSizeStart; c < (colTotal > 0 ? colTotal : labelRow.length); c++) {
      const v = labelRow[c]
      if (v == null || v === '') continue
      sizeLabels.push(String(v).trim())
      sizeCols.push(c)
    }
  }
  console.log('Size labels:', sizeLabels, 'size cols:', sizeCols)

  // 처음 30행 데이터 추출
  console.log('\nFirst 30 data rows:')
  let totalFromFile = 0
  let totalFromParser = 0
  for (let r = headerRow + 2; r < grid.length; r++) {
    const row = grid[r] || []
    const code = String(row[colCode] ?? '').trim()
    const name = String(row[colName] ?? '').trim()
    if (!code && !name) continue
    if (code === '품번' || name === '품목') continue
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

    totalFromFile += Number(row[colTotal] || 0)
    totalFromParser += total

    if (r < headerRow + 32) {
      console.log(`R${r+1}: code=${code.replace(/\n/g,'\\n')}, sizes=${JSON.stringify(sizes)}, total=${total}, sheetTotal=${Number(row[colTotal] || 0)}`)
    }
  }
  console.log(`\n[합계 비교] 파일의 합계 컬럼 총합: ${totalFromFile}, 파서가 등록할 총합: ${totalFromParser}`)
}
