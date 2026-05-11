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
  const fileRef = useRef<HTMLInputElement>(null)

  const spec = ENTITY_SPECS[entity]

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
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
    if (fileRef.current) fileRef.current.value = ''
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
        title="엑셀 가져오기"
        description="기존 데이터를 엑셀 파일로 일괄 등록합니다. 양식 다운로드 → 데이터 입력 → 업로드 순서로 진행하세요."
      />

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

      {rows.length === 0 && !result && (
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
