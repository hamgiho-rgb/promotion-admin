import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Button, Drawer, Badge, Empty } from '@/components/ui'

/* ─────────────────────────────────────────────
 * 거래처/공급처/상품 — 평탄한 표 엑셀 일괄 등록 (공용)
 *
 * 사용:
 *   <FlatImportButton entity="customers" onImported={load} />
 *   <FlatImportButton entity="suppliers" onImported={load} />
 *   <FlatImportButton entity="products"  onImported={load} />
 *
 * 양식 다운로드 + 미리보기 + 일괄 등록 한 컴포넌트에 다 있음
 * ───────────────────────────────────────────── */

export type FlatEntity = 'customers' | 'suppliers' | 'products'

interface EntitySpec {
  label: string
  description: string
  /** 첫 컬럼은 헤더 라벨, hint 는 변환 안내 */
  columns: { key: string; label: string; required?: boolean; hint?: string }[]
  templateRow: string[]   // 빈 양식의 예시 한 행
}

const SPECS: Record<FlatEntity, EntitySpec> = {
  customers: {
    label: '고객 거래처',
    description: '내가 납품하는 브랜드들. 이름·사업자번호·연락처·사이즈 체계까지 한 번에.',
    columns: [
      { key: '거래처명', label: '거래처명', required: true },
      { key: '회사명', label: '회사명 (모회사)', hint: '예: 마크니의 모회사 쿨파인더' },
      { key: '사업자번호', label: '사업자번호' },
      { key: '대표자', label: '대표자' },
      { key: '주소', label: '주소' },
      { key: '전화번호', label: '전화번호' },
      { key: '이메일', label: '이메일' },
      { key: '계좌정보', label: '계좌정보' },
      { key: '사이즈체계', label: '사이즈 체계', hint: '쉼표 구분 (110,120,130 또는 S,M,L)' },
      { key: '메모', label: '메모' },
    ],
    templateRow: ['청운상사','주식회사 청운상사','216-21-18212','함기호','경기도 성남시...','010-3026-0215','','국민은행 ...','110,120,130,140,150,160,170','아동복'],
  },
  suppliers: {
    label: '공급처',
    description: '원단·부자재·공임·포장 공급처를 일괄 등록. 분류 컬럼은 [원단]/[공임] 같은 형식으로 자동 저장.',
    columns: [
      { key: '공급처명', label: '공급처명', required: true },
      { key: '분류', label: '분류', hint: '원단/립/나염/프린트/자수/부자재/워싱/라벨/공임/포장/기타' },
      { key: '사업자번호', label: '사업자번호' },
      { key: '대표자', label: '대표자' },
      { key: '주소', label: '주소' },
      { key: '전화번호', label: '전화번호' },
      { key: '품목', label: '취급 품목', hint: '쉼표 구분 (20수싱글, P.TWILL, ...)' },
      { key: '메모', label: '메모' },
    ],
    templateRow: ['강인텍스','원단','','','','010-...','N230타스란, P.TWILL, 에스파','거래처 메모'],
  },
  products: {
    label: '상품',
    description: '거래처별 상품. 거래처는 미리 등록되어 있어야 자동 연결됨 (없으면 자동 생성).',
    columns: [
      { key: '거래처명', label: '거래처명 (브랜드)', required: true, hint: '없으면 자동 생성됨' },
      { key: '품번', label: '품번', required: true },
      { key: '품목명', label: '품목명', required: true },
      { key: '컬러', label: '컬러' },
      { key: '판매가', label: '판매가', hint: '숫자만' },
      { key: '메모', label: '메모' },
    ],
    templateRow: ['가이던스','A2SKCSTX01RD','패널팬츠','블랙','37800',''],
  },
}

export default function FlatImportButton({ entity, onImported }: {
  entity: FlatEntity
  onImported: () => void
}) {
  const spec = SPECS[entity]
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<any[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: number; fail: number; errors: string[] } | null>(null)

  function downloadTemplate() {
    const headerRow = spec.columns.map(c => c.label)
    const ws = XLSX.utils.aoa_to_sheet([headerRow, spec.templateRow])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, spec.label)
    XLSX.writeFile(wb, `${spec.label}_양식.xlsx`)
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const sheet = wb.Sheets[wb.SheetNames[0]]
        const json: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null })
        if (json.length < 2) { alert('데이터가 없어요.'); return }
        const headerRow = (json[0] as any[]).map(h => String(h ?? '').trim())
        const dataRows = json.slice(1)
          .filter(r => r.some(c => c !== null && c !== ''))
          .map(r => {
            const obj: any = {}
            headerRow.forEach((h, i) => { obj[h] = r[i] ?? null })
            return obj
          })
        setHeaders(headerRow)
        setRows(dataRows)
        setResult(null)
        setDrawerOpen(true)
      } catch (err: any) {
        alert('파일 읽기 오류: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  function clean(v: any): string | null {
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    return s || null
  }

  async function doImport() {
    if (rows.length === 0) return
    if (!confirm(`${rows.length}건을 등록할까요?`)) return
    setImporting(true)
    setResult(null)
    let ok = 0, fail = 0
    const errors: string[] = []

    try {
      if (entity === 'customers' || entity === 'suppliers') {
        const type = entity === 'customers' ? 'customer' : 'supplier'
        for (const r of rows) {
          const name = clean(r.거래처명 || r.공급처명 || r.name)
          if (!name) { fail++; errors.push('이름 누락'); continue }
          const sizeStr = String(r.사이즈체계 || r['사이즈 체계'] || '').trim()
          const sizes = sizeStr ? sizeStr.split(/[,\s]+/).map(s => s.trim()).filter(Boolean) : []
          const cat = clean(r.분류)
          const items = clean(r.품목)
          const memoBody = clean(r.메모)
          // 메모 합치기: [분류] | 품목: A,B,C | 메모본문
          const parts: string[] = []
          if (cat) parts.push(`[${cat}]`)
          if (items) parts.push(`품목: ${items}`)
          if (memoBody) parts.push(memoBody)
          const memo = parts.length ? parts.join(' | ') : null

          const payload: any = {
            name,
            vendor_type: type,
            company_name: type === 'customer' ? clean(r.회사명) : null,
            business_number: clean(r.사업자번호),
            ceo_name: clean(r.대표자),
            address: clean(r.주소),
            phone: clean(r.전화번호),
            email: type === 'customer' ? clean(r.이메일) : null,
            bank_info: type === 'customer' ? clean(r.계좌정보) : null,
            memo,
            size_system: type === 'customer' ? sizes : [],
          }
          const { error } = await supabase.from('vendors').insert(payload)
          if (error) { fail++; errors.push(`${name}: ${error.message}`) }
          else ok++
        }
      } else if (entity === 'products') {
        // 거래처 매핑
        const { data: vData } = await supabase.from('vendors').select('id, name').eq('vendor_type', 'customer')
        const vendorByName = new Map<string, string>()
        ;(vData ?? []).forEach((v: any) => vendorByName.set(v.name, v.id))

        for (const r of rows) {
          const vName = clean(r.거래처명)
          const code = clean(r.품번)
          const name = clean(r.품목명 || r.품명)
          if (!vName || !code || !name) { fail++; errors.push('거래처명/품번/품목명 누락'); continue }
          let vId = vendorByName.get(vName)
          if (!vId) {
            // 거래처 자동 생성
            const { data: newV, error: vErr } = await supabase.from('vendors').insert({
              name: vName,
              vendor_type: 'customer',
              size_system: [],
            }).select().single()
            if (vErr) { fail++; errors.push(`${vName} 자동 생성 실패: ${vErr.message}`); continue }
            vId = newV.id
            vendorByName.set(vName, newV.id)
          }
          const payload = {
            vendor_id: vId,
            code,
            name,
            color: clean(r.컬러),
            selling_price: Number(r.판매가 || 0),
            notes: clean(r.메모),
          }
          const { error } = await supabase.from('products').insert(payload)
          if (error) { fail++; errors.push(`${code}: ${error.message}`) }
          else ok++
        }
      }

      setResult({ ok, fail, errors: errors.slice(0, 10) })
      if (ok > 0) onImported()
    } catch (err: any) {
      setResult({ ok, fail: rows.length - ok, errors: [err.message] })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
      <Button variant="secondary" onClick={() => fileRef.current?.click()}>📥 엑셀 일괄 등록</Button>

      <Drawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setRows([]); setResult(null) }}
        title={`${spec.label} 일괄 등록`}
        width="xl"
        footer={
          result ? (
            <Button onClick={() => { setDrawerOpen(false); setRows([]); setResult(null) }}>닫기</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { setDrawerOpen(false); setRows([]) }}>취소</Button>
              <Button onClick={doImport} disabled={importing}>
                {importing ? '등록 중…' : `${rows.length}건 등록`}
              </Button>
            </>
          )
        }
      >
        {/* 양식 안내 */}
        <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-[12px] text-blue-900">
          <p className="font-semibold mb-2">{spec.description}</p>
          <p className="mb-2">컬럼 헤더는 다음과 정확히 일치해야 해요:</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {spec.columns.map(c => (
              <Badge key={c.key} color={c.required ? 'rose' : 'zinc'}>{c.label}{c.required && '*'}</Badge>
            ))}
          </div>
          <button onClick={downloadTemplate} className="text-blue-700 hover:underline text-[12px]">
            📥 빈 양식 다운로드
          </button>
        </div>

        {rows.length === 0 ? (
          <Empty icon="📂" title="파일을 다시 선택해주세요" />
        ) : (
          <>
            <p className="text-[13px] font-semibold mb-2">미리보기 ({rows.length}건)</p>
            <div className="border border-zinc-200 rounded-xl overflow-auto max-h-[400px]">
              <table className="w-full text-[11px]">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left w-10">#</th>
                    {headers.map(h => <th key={h} className="px-2 py-1.5 text-left whitespace-nowrap">{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i} className="border-t border-zinc-100">
                      <td className="px-2 py-1 text-zinc-400">{i + 1}</td>
                      {headers.map(h => (
                        <td key={h} className="px-2 py-1 whitespace-nowrap">
                          {r[h] ?? <span className="text-zinc-300">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 100 && (
                <div className="p-2 text-center text-zinc-500 text-[11px] border-t border-zinc-100">
                  … 외 {rows.length - 100}건
                </div>
              )}
            </div>
          </>
        )}

        {result && (
          <div className="mt-5 p-4 rounded-xl bg-zinc-50 border border-zinc-200">
            <div className="flex gap-3 mb-3">
              <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[13px]">
                ✅ 성공: <strong>{result.ok}</strong>건
              </div>
              {result.fail > 0 && (
                <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-[13px]">
                  ❌ 실패: <strong>{result.fail}</strong>건
                </div>
              )}
            </div>
            {result.errors.length > 0 && (
              <ul className="text-[11px] text-zinc-600 space-y-1 max-h-32 overflow-y-auto font-mono">
                {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            )}
          </div>
        )}
      </Drawer>
    </>
  )
}
