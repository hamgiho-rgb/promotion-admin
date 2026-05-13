import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Button, Select, PageHeader, Empty, Badge } from '@/components/ui'

type EntityType = 'customers' | 'suppliers' | 'products' | 'incoming' | 'invoices'

const ENTITY_SPECS: Record<EntityType, {
  label: string
  description: string
  columns: { key: string; label: string; required?: boolean; hint?: string }[]
  example: string
}> = {
  customers: {
    label: '고객 거래처',
    description: '내가 납품하는 브랜드/거래처를 일괄 등록합니다.',
    columns: [
      { key: 'name', label: '거래처명', required: true },
      { key: 'business_number', label: '사업자번호' },
      { key: 'ceo_name', label: '대표자' },
      { key: 'address', label: '주소' },
      { key: 'phone', label: '전화번호' },
      { key: 'email', label: '이메일' },
      { key: 'bank_info', label: '계좌정보' },
      { key: 'size_system', label: '사이즈 체계', hint: '쉼표로 구분 (예: "110,120,130,140,150,160,170" 또는 "S,M,L")' },
      { key: 'memo', label: '메모' },
    ],
    example: '청운상사\t216-21-18212\t함기호\t경기도 성남시 중원구...\t010-3026-0215\t\t\t110,120,130,140,150,160,170\t아동복 브랜드',
  },
  suppliers: {
    label: '공급처',
    description: '원단·부자재·공임·포장 공급처를 일괄 등록합니다.',
    columns: [
      { key: 'name', label: '공급처명', required: true },
      { key: 'category', label: '분류', hint: '원단 / 나염/프린트 / 립/부자재 / 공임 / 포장 / 기타' },
      { key: 'business_number', label: '사업자번호' },
      { key: 'ceo_name', label: '대표자' },
      { key: 'address', label: '주소' },
      { key: 'phone', label: '전화번호' },
      { key: 'memo', label: '메모' },
    ],
    example: '신상텍스\t원단\t\t\t\t\t주력: 챠밍',
  },
  products: {
    label: '상품',
    description: '거래처별 상품을 일괄 등록합니다. 거래처는 먼저 등록되어 있어야 합니다.',
    columns: [
      { key: 'vendor_name', label: '거래처명', required: true, hint: '먼저 등록된 거래처명과 일치해야 함' },
      { key: 'code', label: '품번', required: true },
      { key: 'name', label: '품목명', required: true },
      { key: 'color', label: '컬러' },
      { key: 'selling_price', label: '판매가', hint: '숫자만 입력' },
      { key: 'notes', label: '메모' },
    ],
    example: '청운상사\tA2SKCSTX01RD\t엑시스웨어 베이직 17수 반팔티\t레드\t5000\t',
  },
  incoming: {
    label: '입고내역서 (단순화)',
    description: '입고 라인을 일괄 등록합니다. 사이즈 컬럼은 헤더 이름으로 자동 매칭됩니다.',
    columns: [
      { key: 'vendor_name', label: '거래처명', required: true },
      { key: 'period', label: '기간', hint: '예: 2026.05' },
      { key: 'delivery_date', label: '입고일', hint: 'YYYY-MM-DD' },
      { key: 'carton_no', label: 'C/T 번호' },
      { key: 'product_code', label: '품번' },
      { key: 'product_name', label: '품목' },
      { key: '(사이즈명)', label: '각 사이즈별 수량', hint: '예: "110", "120" 등을 컬럼 헤더로' },
    ],
    example: '청운상사\t2026.05\t2026-05-08\t1\tA2SKCSTX01RD\t엑시스웨어반팔티\t0\t0\t15\t...',
  },
  invoices: {
    label: '계산서 라인',
    description: '계산서 라인을 일괄 등록합니다. 동일 거래처+동일 발행일로 묶입니다.',
    columns: [
      { key: 'vendor_name', label: '거래처명', required: true },
      { key: 'issue_date', label: '발행일', required: true, hint: 'YYYY-MM-DD' },
      { key: 'line_date', label: '거래일', hint: 'YYYY-MM-DD' },
      { key: 'product_name', label: '품명', required: true },
      { key: 'color', label: '칼라' },
      { key: 'quantity', label: '수량', required: true, hint: '음수 = 반품' },
      { key: 'unit_price', label: '단가', required: true },
    ],
    example: '청운상사\t2026-04-30\t2026-04-01\t엑시스웨어반팔티\t17수\t217\t5000',
  },
}

type ImportResult = { ok: number; fail: number; errors: string[] }
type DetectionResult = { entity: EntityType; confidence: number; reason: string } | null

/* ───── AW 원본 입고내역서 파서 ─────
 * 청운상사/마요네즈 등의 원본 엑셀 양식 (다중시트, 동적 사이즈 컬럼) 자동 감지 + 파싱
 *
 * 양식 시그니처:
 *   - 어딘가에 "입 고 내 역 서" 또는 "입고내역서" 텍스트
 *   - "OOO 귀하" 형식의 거래처명
 *   - "품번" + "품목" + "사이즈" + "합계" 가 같은 헤더 행에 있음
 */

interface AWReceipt {
  sheetName: string
  vendor_name: string
  period: string | null     // YYYY.MM
  sizeLabels: string[]      // ["110","120",...] or ["1","2"] or ["S","M","L"]
  items: {
    product_code: string
    product_name: string
    sizes: Record<string, number>
    total: number
    delivery_date: string | null
    carton_no: number | null
  }[]
}

function parseAWWorkbook(wb: XLSX.WorkBook): AWReceipt[] {
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
  // 1. 거래처명 찾기 — "OOO 귀하" 패턴
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

  // 2. period 찾기 — 시트 이름이 YYYY.MM 형식이거나 A2 가 그 형식
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

  // 3. 헤더 행 찾기 — "품번", "품목", "사이즈", "합계" 한 행에 모두
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

  // 4. 사이즈 라벨 행 — 헤더 다음 행, 사이즈 컬럼들에서 값 가져오기
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

  // 5. 데이터 행 읽기 — headerRow + 2 부터
  const items: AWReceipt['items'] = []
  for (let r = headerRow + 2; r < grid.length; r++) {
    const row = grid[r] || []
    const code = String(row[colCode] ?? '').trim()
    const name = String(row[colName] ?? '').trim()
    if (!code && !name) continue  // 빈 행
    if (code === '품번' || name === '품목') continue  // 헤더 반복 무시

    const sizes: Record<string, number> = {}
    let total = 0
    sizeLabels.forEach((label, i) => {
      const v = Number(row[sizeCols[i]] || 0)
      sizes[label] = v
      total += v
    })
    if (colTotal >= 0) {
      const sheetTotal = Number(row[colTotal] || 0)
      if (sheetTotal > 0) total = sheetTotal  // 시트의 합계가 정확하면 사용
    }
    if (total === 0 && !code) continue  // 의미 없는 행

    let delivery_date: string | null = null
    if (colDate >= 0) {
      const d = row[colDate]
      if (d instanceof Date) delivery_date = d.toISOString().slice(0, 10)
      else if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) delivery_date = d.slice(0, 10)
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

function isAWFormat(wb: XLSX.WorkBook): boolean {
  // 첫 시트에서 "입 고 내 역 서" 또는 "귀하" 가 있으면 AW 양식
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
    return false  // 첫 시트만 검사
  }
  return false
}

/* ───── 헤더 자동 인식 휴리스틱 ───── */
function detectEntityType(headers: string[]): DetectionResult {
  // 정규화: 소문자 + 공백 제거
  const norm = headers.map(h => h.toLowerCase().replace(/\s+/g, '').replace(/[()_-]/g, ''))
  const setH = new Set(norm)
  const has = (...keys: string[]) => keys.some(k => setH.has(k))

  // 사이즈처럼 보이는 숫자/알파벳 헤더 수
  const sizeHeaders = headers.filter(h => {
    const t = h.trim()
    if (/^\d{2,3}$/.test(t)) return true                   // 110, 120 ...
    if (/^(xs|s|m|l|xl|xxl|3xl|free)$/i.test(t)) return true
    if (/^\d$/.test(t)) return true                        // 1, 2, 3
    return false
  })

  // 📌 계산서 시그니처: 발행일 + (공급가액 or 부가세 or 수량+단가)
  if (has('발행일', 'issuedate', 'issue_date') &&
      (has('공급가액', '부가세', 'subtotal', 'vat') ||
       (has('수량', 'quantity') && has('단가', 'unitprice', 'unit_price')))) {
    return { entity: 'invoices', confidence: 95, reason: '발행일 + 금액/수량/단가 컬럼이 보여요' }
  }

  // 📌 입고내역서 시그니처: 사이즈 컬럼 2개 이상 + (품번 or 품목)
  if (sizeHeaders.length >= 2 && (has('품번', '품목', 'productcode', 'productname'))) {
    return { entity: 'incoming', confidence: 90, reason: `사이즈 컬럼 ${sizeHeaders.length}개(${sizeHeaders.slice(0, 4).join(', ')}${sizeHeaders.length > 4 ? '...' : ''}) + 품번/품목 있음` }
  }

  // 📌 입고내역서 (C/T 키워드)
  if (has('ct', 'cartonno', 'carton_no', '박스번호') && has('품번', '품목')) {
    return { entity: 'incoming', confidence: 88, reason: 'C/T(박스번호) + 품번 컬럼이 보여요' }
  }

  // 📌 원가계산서: 재료/요척/공임 키워드
  if (has('요척', 'yard') && has('단가', 'price', 'unitprice')) {
    return { entity: 'products', confidence: 75, reason: '요척 + 단가 — 원가 형식인 것 같아요 (상품 양식으로 가져오기 권장)' }
  }

  // 📌 상품: 품번 + 판매가
  if ((has('품번', 'code', 'productcode')) && (has('판매가', 'price', 'sellingprice'))) {
    return { entity: 'products', confidence: 90, reason: '품번 + 판매가 컬럼' }
  }

  // 📌 상품: 품번 + 품목 (판매가 없어도)
  if (has('품번', 'code') && has('품목', 'name', 'productname')) {
    return { entity: 'products', confidence: 80, reason: '품번 + 품목명' }
  }

  // 📌 공급처
  if (has('공급처명') || (has('분류', 'category') && has('이름', 'name'))) {
    return { entity: 'suppliers', confidence: 85, reason: '공급처명 또는 분류 컬럼' }
  }

  // 📌 거래처: 거래처명 + 사이즈체계/사업자
  if (has('거래처명') && (has('사이즈체계', 'sizesystem') || has('사업자번호', 'businessnumber'))) {
    return { entity: 'customers', confidence: 88, reason: '거래처명 + 사이즈/사업자 정보' }
  }

  // 📌 거래처: 거래처명 + 대표자
  if (has('거래처명') && has('대표자', 'ceo')) {
    return { entity: 'customers', confidence: 75, reason: '거래처명 + 대표자 컬럼' }
  }

  // 거래처명만 있고 다른 단서가 없으면 거래처로 추측
  if (has('거래처명')) {
    return { entity: 'customers', confidence: 50, reason: '거래처명만 있음 (추측 낮음)' }
  }

  return null
}

export default function DataImport() {
  const [entity, setEntity] = useState<EntityType>('customers')
  const [rows, setRows] = useState<any[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [detection, setDetection] = useState<DetectionResult>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [importing, setImporting] = useState(false)
  const [awReceipts, setAWReceipts] = useState<AWReceipt[]>([])  // AW 원본 양식 미리보기
  const fileRef = useRef<HTMLInputElement>(null)

  const spec = ENTITY_SPECS[entity]

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })

        // 1) AW 원본 입고내역서 양식 우선 감지
        if (isAWFormat(wb)) {
          const receipts = parseAWWorkbook(wb)
          if (receipts.length > 0) {
            setAWReceipts(receipts)
            setHeaders([]); setRows([]); setResult(null)
            setDetection({ entity: 'incoming', confidence: 99, reason: 'AW 원본 입고내역서 양식 감지 — 시트별 자동 분리' })
            setEntity('incoming')
            return
          }
        }

        // 2) 일반 평탄 표 양식
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
        if (json.length === 0) { alert('파일이 비어있어요.'); return }
        const headerRow = (json[0] as any[]).map(h => String(h ?? '').trim())
        const dataRows = json.slice(1).filter(row => row.some(c => c !== null && c !== ''))
        const objRows = dataRows.map(row => {
          const obj: any = {}
          headerRow.forEach((h, i) => { obj[h] = row[i] ?? null })
          return obj
        })
        setHeaders(headerRow)
        setRows(objRows)
        setAWReceipts([])
        setResult(null)

        // 자동 인식
        const detected = detectEntityType(headerRow)
        setDetection(detected)
        if (detected && detected.confidence >= 70) {
          setEntity(detected.entity)
        }
      } catch (err: any) {
        alert('파일 읽기 오류: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function clearFile() {
    setRows([])
    setHeaders([])
    setResult(null)
    setDetection(null)
    setAWReceipts([])
    if (fileRef.current) fileRef.current.value = ''
  }

  // AW 원본 양식 일괄 import
  async function handleAWImport() {
    if (awReceipts.length === 0) return
    const total = awReceipts.reduce((s, r) => s + r.items.length, 0)
    if (!confirm(`${awReceipts.length}개 시트, 총 ${total}개 라인을 가져올까요?`)) return

    setImporting(true)
    setResult(null)
    let ok = 0, fail = 0
    const errors: string[] = []

    try {
      // 거래처 매핑
      const { data: vendorsData } = await supabase.from('vendors').select('*').eq('vendor_type', 'customer')
      const vendorByName = new Map<string, any>()
      ;(vendorsData ?? []).forEach(v => vendorByName.set(v.name, v))

      // 상품 매핑 (품번 → product_id)
      const { data: productsData } = await supabase.from('products').select('id, code')
      const productByCode = new Map<string, string>()
      ;(productsData ?? []).forEach(p => { if (p.code) productByCode.set(p.code, p.id) })

      for (const receipt of awReceipts) {
        let vendor = vendorByName.get(receipt.vendor_name)
        // 없으면 자동 생성
        if (!vendor) {
          const { data: newV, error: cErr } = await supabase.from('vendors').insert({
            name: receipt.vendor_name,
            vendor_type: 'customer',
            size_system: receipt.sizeLabels,
          }).select().single()
          if (cErr) { fail += receipt.items.length; errors.push(`${receipt.vendor_name}: 거래처 자동 생성 실패 ${cErr.message}`); continue }
          vendor = newV
          vendorByName.set(receipt.vendor_name, newV)
        }
        // 거래처의 size_system 비어있으면 채워줌
        if (!vendor.size_system || vendor.size_system.length === 0) {
          await supabase.from('vendors').update({ size_system: receipt.sizeLabels }).eq('id', vendor.id)
          vendor.size_system = receipt.sizeLabels
        }

        // incoming 생성
        const { data: incData, error: incErr } = await supabase.from('incoming').insert({
          vendor_id: vendor.id,
          period: receipt.period,
          producer: 'AW',
        }).select().single()
        if (incErr) { fail += receipt.items.length; errors.push(`${receipt.vendor_name} ${receipt.sheetName}: ${incErr.message}`); continue }

        // incoming_items 일괄 insert
        const payload = receipt.items.map(it => ({
          incoming_id: incData.id,
          product_id: productByCode.get(it.product_code) || null,
          product_code: it.product_code || null,
          product_name: it.product_name || null,
          sizes: it.sizes,
          total_quantity: it.total,
          delivery_date: it.delivery_date,
          carton_no: it.carton_no,
        }))
        if (payload.length > 0) {
          const { error: itErr } = await supabase.from('incoming_items').insert(payload)
          if (itErr) {
            fail += payload.length
            errors.push(`${receipt.vendor_name} ${receipt.sheetName}: 라인 ${itErr.message}`)
          } else {
            ok += payload.length
          }
        }
      }

      setResult({ ok, fail, errors: errors.slice(0, 20) })
    } catch (err: any) {
      setResult({ ok, fail: total - ok, errors: [err.message] })
    } finally {
      setImporting(false)
    }
  }

  async function handleImport() {
    if (rows.length === 0) return
    if (!confirm(`${rows.length}건을 가져올까요? 같은 데이터가 이미 있으면 중복될 수 있어요.`)) return
    setImporting(true)
    setResult(null)

    let ok = 0, fail = 0
    const errors: string[] = []

    try {
      // 거래처 매핑 미리 로드 (vendor_name → vendor_id)
      let vendorMap = new Map<string, string>()
      if (entity === 'products' || entity === 'incoming' || entity === 'invoices' || entity === 'customers' || entity === 'suppliers') {
        const { data: vs } = await supabase.from('vendors').select('id, name')
        ;(vs ?? []).forEach((v: any) => vendorMap.set(v.name, v.id))
      }

      if (entity === 'customers' || entity === 'suppliers') {
        const type = entity === 'customers' ? 'customer' : 'supplier'
        for (const r of rows) {
          if (!r.거래처명 && !r.공급처명 && !r.name) { fail++; errors.push('이름 누락'); continue }
          const name = String(r.거래처명 || r.공급처명 || r.name).trim()
          const sizeStr = r.사이즈체계 || r['사이즈 체계'] || r.size_system || ''
          const sizes = String(sizeStr).split(/[,\s]+/).map((s: string) => s.trim()).filter(Boolean)
          const cat = String(r.분류 || r.category || '').trim()
          const memo = String(r.메모 || r.memo || '').trim()
          const fullMemo = cat ? `[${cat}] ${memo}`.trim() : (memo || null)
          const payload = {
            name,
            vendor_type: type,
            business_number: cleanStr(r.사업자번호 || r.business_number),
            ceo_name: cleanStr(r.대표자 || r.ceo_name),
            address: cleanStr(r.주소 || r.address),
            phone: cleanStr(r.전화번호 || r.phone),
            email: cleanStr(r.이메일 || r.email),
            bank_info: cleanStr(r.계좌정보 || r.bank_info),
            memo: fullMemo,
            size_system: type === 'customer' ? sizes : [],
          }
          const { error } = await supabase.from('vendors').insert(payload)
          if (error) { fail++; errors.push(`${name}: ${error.message}`) }
          else ok++
        }
      } else if (entity === 'products') {
        for (const r of rows) {
          const vName = String(r.거래처명 || r.vendor_name || '').trim()
          if (!vName) { fail++; errors.push('거래처명 누락'); continue }
          const vId = vendorMap.get(vName)
          if (!vId) { fail++; errors.push(`${vName}: 거래처를 찾을 수 없음`); continue }
          const code = String(r.품번 || r.code || '').trim()
          const name = String(r.품목명 || r.품명 || r.name || '').trim()
          if (!code || !name) { fail++; errors.push(`${vName}: 품번/품목명 누락`); continue }
          const payload = {
            vendor_id: vId,
            code,
            name,
            color: cleanStr(r.컬러 || r.color),
            selling_price: Number(r.판매가 || r.selling_price || 0),
            notes: cleanStr(r.메모 || r.notes),
          }
          const { error } = await supabase.from('products').insert(payload)
          if (error) { fail++; errors.push(`${code}: ${error.message}`) }
          else ok++
        }
      } else if (entity === 'invoices') {
        // 거래처+발행일별로 묶어서 invoice 생성, 그 안에 lines 추가
        const groups = new Map<string, any[]>()
        for (const r of rows) {
          const vName = String(r.거래처명 || r.vendor_name || '').trim()
          const issue = normalizeDate(r.발행일 || r.issue_date)
          if (!vName || !issue) { fail++; errors.push('거래처명 또는 발행일 누락'); continue }
          const k = `${vName}|${issue}`
          if (!groups.has(k)) groups.set(k, [])
          groups.get(k)!.push(r)
        }
        for (const [k, lines] of groups) {
          const [vName, issue] = k.split('|')
          const vId = vendorMap.get(vName)
          if (!vId) { fail += lines.length; errors.push(`${vName}: 거래처 없음`); continue }
          const subtotalCalc = lines.reduce((s, r) => s + (Number(r.수량 || r.quantity || 0) * Number(r.단가 || r.unit_price || 0)), 0)
          const vatCalc = Math.round(subtotalCalc * 0.1)
          const totalCalc = subtotalCalc + vatCalc
          const { data: invData, error: invErr } = await supabase.from('invoices').insert({
            vendor_id: vId,
            issue_date: issue,
            subtotal: subtotalCalc, vat: vatCalc, total: totalCalc,
            supplier_business_number: '216-21-18212',
            supplier_name: '써치(SEARCH)',
            supplier_ceo: '함기호',
            supplier_address: '서울시 동대문구 안암로 16길 4, 2층',
            bank_info: '함기호(써치) 국민은행 038737-04-002188',
          }).select().single()
          if (invErr) { fail += lines.length; errors.push(`${vName}: ${invErr.message}`); continue }
          // lines
          const itemRows = lines.map((r, i) => ({
            invoice_id: invData.id,
            line_date: normalizeDate(r.거래일 || r.line_date) || issue,
            product_name: String(r.품명 || r.product_name || '').trim() || null,
            color: cleanStr(r.칼라 || r.컬러 || r.color),
            quantity: Number(r.수량 || r.quantity || 0),
            unit_price: Number(r.단가 || r.unit_price || 0),
            sort_order: i,
          }))
          const { error: itErr } = await supabase.from('invoice_items').insert(itemRows)
          if (itErr) { fail += lines.length; errors.push(`${vName}: 라인 ${itErr.message}`) }
          else ok += lines.length
        }
      } else if (entity === 'incoming') {
        // 거래처+기간별로 incoming 생성, 그 안에 라인 추가
        // 사이즈 컬럼은 vendor.size_system 과 일치하는 헤더 사용
        const { data: vendorsData } = await supabase.from('vendors').select('*').eq('vendor_type', 'customer')
        const vendorByName = new Map<string, any>()
        ;(vendorsData ?? []).forEach(v => vendorByName.set(v.name, v))

        const groups = new Map<string, any[]>()
        for (const r of rows) {
          const vName = String(r.거래처명 || r.vendor_name || '').trim()
          const period = String(r.기간 || r.period || '').trim() || '미정'
          if (!vName) { fail++; errors.push('거래처명 누락'); continue }
          const k = `${vName}|${period}`
          if (!groups.has(k)) groups.set(k, [])
          groups.get(k)!.push(r)
        }
        for (const [k, lines] of groups) {
          const [vName, period] = k.split('|')
          const v = vendorByName.get(vName)
          if (!v) { fail += lines.length; errors.push(`${vName}: 거래처 없음`); continue }
          const sizeKeys: string[] = v.size_system || []
          const { data: incData, error: incErr } = await supabase.from('incoming').insert({
            vendor_id: v.id,
            period: period === '미정' ? null : period,
            producer: 'AW',
          }).select().single()
          if (incErr) { fail += lines.length; errors.push(`${vName}: ${incErr.message}`); continue }
          // 라인
          for (let i = 0; i < lines.length; i++) {
            const r = lines[i]
            const sizes: Record<string, number> = {}
            let total = 0
            sizeKeys.forEach(s => {
              const v = Number(r[s] || 0)
              sizes[s] = v
              total += v
            })
            const { error: itErr } = await supabase.from('incoming_items').insert({
              incoming_id: incData.id,
              product_code: cleanStr(r.품번 || r.product_code),
              product_name: cleanStr(r.품목 || r.product_name),
              sizes,
              total_quantity: total,
              delivery_date: normalizeDate(r.입고일 || r.delivery_date),
              carton_no: r['C/T'] ? Number(r['C/T']) : r.carton_no ? Number(r.carton_no) : null,
            })
            if (itErr) { fail++; errors.push(`${r.품번 || ''}: ${itErr.message}`) }
            else ok++
          }
        }
      }

      setResult({ ok, fail, errors: errors.slice(0, 20) })
    } catch (err: any) {
      setResult({ ok, fail: rows.length - ok, errors: [err.message] })
    } finally {
      setImporting(false)
    }
  }

  function downloadTemplate() {
    // 컬럼 헤더만 있는 빈 템플릿 엑셀 생성
    const cols = spec.columns
      .filter(c => c.key !== '(사이즈명)')
      .map(c => c.label)
    const ws = XLSX.utils.aoa_to_sheet([cols])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, spec.label)
    XLSX.writeFile(wb, `${spec.label}_업로드양식.xlsx`)
  }

  return (
    <div>
      <PageHeader
        title="엑셀 가져오기 (구버전)"
        description="이 페이지는 통합 업로드 도구입니다. 평소엔 각 페이지의 '📥 엑셀 일괄 등록' 버튼을 쓰세요."
      />

      <div className="mb-4 p-4 rounded-xl bg-blue-50 border border-blue-200 text-[12px] text-blue-900">
        💡 <strong>각 페이지에서 바로 등록 가능</strong> — 새 방식 추천!
        <ul className="mt-2 ml-4 list-disc space-y-1">
          <li><strong>고객 거래처</strong> 페이지 → 우상단 [📥 엑셀 일괄 등록]</li>
          <li><strong>공급처</strong> 페이지 → 우상단 [📥 엑셀 일괄 등록]</li>
          <li><strong>상품 관리</strong> 페이지 → 우상단 [📥 엑셀 일괄 등록]</li>
          <li><strong>입고내역서</strong> 페이지 → 우상단 [📥 엑셀 일괄 등록] (AW 원본 양식 자동 감지)</li>
          <li><strong>계산서</strong> 페이지 → 우상단 [📥 엑셀 일괄 등록] (영수증 양식 자동 감지)</li>
        </ul>
        <p className="mt-2">이 페이지는 한꺼번에 여러 종류를 다룰 때 또는 백업용으로만 쓰세요.</p>
      </div>

      {/* 항목 선택 + 양식 다운로드 */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-5 mb-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
          <div>
            <p className="text-[12px] font-medium text-zinc-700 mb-1.5">가져올 항목</p>
            <Select value={entity} onChange={e => { setEntity(e.target.value as EntityType); clearFile() }}>
              <option value="customers">고객 거래처</option>
              <option value="suppliers">공급처</option>
              <option value="products">상품</option>
              <option value="incoming">입고내역서</option>
              <option value="invoices">계산서 라인</option>
            </Select>
          </div>
          <div className="md:col-span-2 flex items-end">
            <Button variant="secondary" onClick={downloadTemplate}>📥 빈 양식 엑셀 다운로드</Button>
          </div>
        </div>

        <div className="border-t border-zinc-100 pt-4">
          <p className="text-[13px] font-medium text-zinc-900 mb-1">{spec.label} 양식 안내</p>
          <p className="text-[12px] text-zinc-600 mb-3">{spec.description}</p>

          <div className="bg-zinc-50 rounded-lg p-3">
            <p className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider mb-2">컬럼 (헤더는 정확히 일치해야 해요)</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-1.5 text-[11px]">
              {spec.columns.map(c => (
                <div key={c.key} className="flex items-center gap-1.5">
                  <Badge color={c.required ? 'rose' : 'zinc'}>{c.label}</Badge>
                  {c.hint && <span className="text-zinc-500 truncate" title={c.hint}>{c.hint}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 파일 업로드 */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-5 mb-4">
        <p className="text-[12px] font-medium text-zinc-700 mb-2">엑셀 파일 업로드</p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileChange}
          className="block text-[13px] text-zinc-600 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-[13px] file:font-medium file:bg-zinc-100 file:text-zinc-900 hover:file:bg-zinc-200 file:cursor-pointer"
        />
        <p className="text-[11px] text-zinc-500 mt-2">.xlsx, .xls, .csv 지원. 첫 시트만 읽습니다. 헤더(첫 줄)를 보고 어떤 데이터인지 자동으로 인식해요.</p>
      </div>

      {/* 자동 인식 결과 */}
      {detection && (
        <div className={`mb-4 rounded-2xl p-4 border ${
          detection.confidence >= 85
            ? 'bg-emerald-50 border-emerald-200'
            : detection.confidence >= 70
              ? 'bg-blue-50 border-blue-200'
              : 'bg-amber-50 border-amber-200'
        }`}>
          <div className="flex items-start gap-3">
            <div className="text-2xl flex-shrink-0">
              {detection.confidence >= 85 ? '🎯' : detection.confidence >= 70 ? '🤖' : '🤔'}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[13px] font-semibold text-zinc-900">
                  자동 인식: <span className="text-zinc-700">{ENTITY_SPECS[detection.entity].label}</span> 데이터로 보입니다
                </p>
                <Badge color={detection.confidence >= 85 ? 'green' : detection.confidence >= 70 ? 'blue' : 'amber'}>
                  신뢰도 {detection.confidence}%
                </Badge>
                {entity === detection.entity ? (
                  <span className="text-[11px] text-emerald-700">✓ 자동 적용됨</span>
                ) : (
                  <button onClick={() => setEntity(detection.entity)} className="text-[11px] text-blue-700 hover:underline font-medium">
                    이걸로 변경 →
                  </button>
                )}
              </div>
              <p className="text-[11px] text-zinc-600 mt-1">📋 근거: {detection.reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* AW 원본 양식 미리보기 */}
      {awReceipts.length > 0 && (
        <div className="bg-white border border-emerald-200 rounded-2xl mb-4 overflow-hidden">
          <div className="p-4 border-b border-zinc-100 bg-emerald-50/50 flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-[13px] font-semibold text-emerald-900">📦 AW 원본 입고내역서 양식 감지 — {awReceipts.length}개 시트</p>
              <p className="text-[11px] text-emerald-700 mt-0.5">
                시트마다 자동으로 거래처·기간·사이즈를 추출했어요. 거래처가 없으면 자동 생성됩니다.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={clearFile}>다시 선택</Button>
              <Button onClick={handleAWImport} disabled={importing}>
                {importing ? '가져오는 중...' : `${awReceipts.reduce((s, r) => s + r.items.length, 0)}건 일괄 등록`}
              </Button>
            </div>
          </div>
          <div className="divide-y divide-zinc-100">
            {awReceipts.map((rec, idx) => (
              <details key={idx} className="group">
                <summary className="px-4 py-3 cursor-pointer hover:bg-zinc-50 flex items-center justify-between gap-3 list-none">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-zinc-400 group-open:rotate-90 transition-transform inline-block">▶</span>
                    <span className="font-semibold text-[13px] text-zinc-900">{rec.vendor_name}</span>
                    <Badge color="blue">{rec.period || rec.sheetName}</Badge>
                    <span className="text-[11px] text-zinc-500">사이즈: {rec.sizeLabels.join(', ')}</span>
                  </div>
                  <span className="text-[12px] text-zinc-600 font-medium tabular-nums">
                    {rec.items.length}품목 · {rec.items.reduce((s, it) => s + it.total, 0).toLocaleString()}장
                  </span>
                </summary>
                <div className="px-4 pb-4 overflow-x-auto">
                  <table className="w-full text-[11px]">
                    <thead className="bg-zinc-50">
                      <tr>
                        <th className="px-2 py-1.5 text-left">품번</th>
                        <th className="px-2 py-1.5 text-left">품목</th>
                        {rec.sizeLabels.map(s => (
                          <th key={s} className="px-2 py-1.5 text-right">{s}</th>
                        ))}
                        <th className="px-2 py-1.5 text-right">합계</th>
                        <th className="px-2 py-1.5 text-left">입고일</th>
                        <th className="px-2 py-1.5 text-right">C/T</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rec.items.slice(0, 30).map((it, i) => (
                        <tr key={i} className="border-t border-zinc-100">
                          <td className="px-2 py-1 font-mono text-[10px]">{it.product_code}</td>
                          <td className="px-2 py-1">{it.product_name}</td>
                          {rec.sizeLabels.map(s => (
                            <td key={s} className="px-2 py-1 text-right tabular-nums">{it.sizes[s] || ''}</td>
                          ))}
                          <td className="px-2 py-1 text-right tabular-nums font-medium">{it.total}</td>
                          <td className="px-2 py-1 text-[10px] text-zinc-500">{it.delivery_date || '—'}</td>
                          <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{it.carton_no ?? '—'}</td>
                        </tr>
                      ))}
                      {rec.items.length > 30 && (
                        <tr><td colSpan={4 + rec.sizeLabels.length} className="px-2 py-2 text-center text-zinc-500 text-[11px]">… 외 {rec.items.length - 30}건</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {/* 미리보기 */}
      {rows.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl mb-4 overflow-hidden">
          <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
            <div>
              <p className="text-[13px] font-semibold text-zinc-900">미리보기 ({rows.length}행)</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">아래 데이터를 가져옵니다.</p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={clearFile}>다시 선택</Button>
              <Button onClick={handleImport} disabled={importing}>
                {importing ? '가져오는 중...' : `${rows.length}건 가져오기`}
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-[11px]">
              <thead className="bg-zinc-50 sticky top-0">
                <tr>
                  <th className="px-2 py-1.5 text-left w-10 border-r border-zinc-200">#</th>
                  {headers.map(h => <th key={h} className="px-2 py-1.5 text-left border-r border-zinc-200 whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 100).map((r, i) => (
                  <tr key={i} className="border-t border-zinc-100">
                    <td className="px-2 py-1 text-zinc-400 border-r border-zinc-200">{i + 1}</td>
                    {headers.map(h => (
                      <td key={h} className="px-2 py-1 border-r border-zinc-200 whitespace-nowrap">
                        {r[h] ?? <span className="text-zinc-300">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 결과 */}
      {result && (
        <div className="bg-white border border-zinc-200 rounded-2xl p-5">
          <p className="text-[14px] font-semibold text-zinc-900 mb-3">가져오기 결과</p>
          <div className="flex gap-3 mb-4">
            <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[13px]">
              ✅ 성공: <strong className="tabular-nums">{result.ok}</strong>건
            </div>
            {result.fail > 0 && (
              <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-[13px]">
                ❌ 실패: <strong className="tabular-nums">{result.fail}</strong>건
              </div>
            )}
          </div>
          {result.errors.length > 0 && (
            <div className="bg-zinc-50 border border-zinc-200 rounded-lg p-3">
              <p className="text-[11px] font-semibold text-zinc-700 mb-2">오류</p>
              <ul className="text-[11px] text-zinc-600 space-y-1 max-h-40 overflow-y-auto">
                {result.errors.map((e, i) => <li key={i} className="font-mono">• {e}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 && awReceipts.length === 0 && !result && (
        <Empty icon="📊" title="엑셀 파일을 선택하면 미리보기가 표시됩니다" />
      )}
    </div>
  )
}

function cleanStr(v: any) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

function normalizeDate(v: any): string | null {
  if (!v) return null
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v)
    if (d) return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`
  }
  const s = String(v).trim()
  const m = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/)
  if (m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`
  return null
}
