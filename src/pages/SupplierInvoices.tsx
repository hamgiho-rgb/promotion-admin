import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import type { Vendor, SupplierInvoice, SupplierInvoiceItem } from '@/lib/types'
import { Button, Input, Select, Label, PageHeader, Drawer, Empty, Badge } from '@/components/ui'
import { isSupplierInvoiceFormat, parseSupplierInvoiceWorkbook } from '@/lib/supplierInvoiceImport'

/* ────────────────────────────────────────────────
 * 공급처 계산서 (공장에서 받은 청구서)
 * - 월별 그룹, 공급처별 필터, 검색
 * - 엑셀 일괄 등록 (대성식 / 누리나염식 자동 감지)
 * - 라인별 상세는 드로어로
 * ──────────────────────────────────────────────── */

export default function SupplierInvoices() {
  const [suppliers, setSuppliers] = useState<Vendor[]>([])
  const [invoices, setInvoices] = useState<SupplierInvoice[]>([])
  const [itemsByInvoice, setItemsByInvoice] = useState<Map<string, SupplierInvoiceItem[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [supplierFilter, setSupplierFilter] = useState<string>('all')
  const thisMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const [monthFilter, setMonthFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [detail, setDetail] = useState<SupplierInvoice | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: sData }, { data: iData }, { data: itData }] = await Promise.all([
      supabase.from('vendors').select('*').eq('vendor_type', 'supplier').order('name'),
      supabase.from('supplier_invoices').select('*').order('period', { ascending: false }).order('issue_date', { ascending: false }),
      supabase.from('supplier_invoice_items').select('*').order('sort_order'),
    ])
    setSuppliers((sData ?? []) as Vendor[])
    setInvoices((iData ?? []) as SupplierInvoice[])
    const m = new Map<string, SupplierInvoiceItem[]>()
    ;(itData ?? []).forEach((it: any) => {
      const arr = m.get(it.invoice_id) || []
      arr.push(it as SupplierInvoiceItem)
      m.set(it.invoice_id, arr)
    })
    setItemsByInvoice(m)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const supplierName = (id: string) => suppliers.find(s => s.id === id)?.name || '—'
  const supplierCategory = (id: string) => {
    const memo = suppliers.find(s => s.id === id)?.memo || ''
    const m = memo.match(/^\[([^\]]+)\]/)
    return m ? m[1] : null
  }

  const allMonths = useMemo(
    () => Array.from(new Set(invoices.map(i => i.period).filter(Boolean))).sort((a, b) => (b! > a! ? 1 : -1)) as string[],
    [invoices]
  )

  const filtered = invoices.filter(inv => {
    if (supplierFilter !== 'all' && inv.supplier_id !== supplierFilter) return false
    if (monthFilter !== 'all' && inv.period !== monthFilter) return false
    if (search.trim()) {
      const s = search.trim().toLowerCase()
      const name = supplierName(inv.supplier_id).toLowerCase()
      const notes = (inv.notes || '').toLowerCase()
      if (!name.includes(s) && !notes.includes(s)) {
        // 라인 내 품목/상호 검색
        const items = itemsByInvoice.get(inv.id) || []
        const inItems = items.some(it =>
          (it.product_name || '').toLowerCase().includes(s) ||
          (it.brand || '').toLowerCase().includes(s)
        )
        if (!inItems) return false
      }
    }
    return true
  })

  const groupedByMonth = useMemo(() => {
    const m: Record<string, SupplierInvoice[]> = {}
    filtered.forEach(inv => {
      const k = inv.period || '(기간 미정)'
      if (!m[k]) m[k] = []
      m[k].push(inv)
    })
    return m
  }, [filtered])
  const months = Object.keys(groupedByMonth).sort((a, b) => b.localeCompare(a))

  const total = filtered.reduce((s, i) => s + Number(i.total || 0), 0)
  const thisMonthTotal = invoices.filter(i => i.period === thisMonth).reduce((s, i) => s + Number(i.total || 0), 0)
  const lastMonthDate = new Date()
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1)
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`
  const lastMonthTotal = invoices.filter(i => i.period === lastMonth).reduce((s, i) => s + Number(i.total || 0), 0)

  async function handleDelete(inv: SupplierInvoice) {
    if (!confirm(`${supplierName(inv.supplier_id)} ${inv.period || ''} 계산서를 삭제할까요?`)) return
    const { error } = await supabase.from('supplier_invoices').delete().eq('id', inv.id)
    if (error) return alert('삭제 실패: ' + error.message)
    load()
  }

  return (
    <div>
      <PageHeader
        title="공급처 계산서"
        description="공장(공급처)에서 받은 청구서를 월별로 기록. 엑셀로 한꺼번에 가져올 수 있어요."
        action={<ImportButton suppliers={suppliers} onImported={load} />}
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="이번 달 청구" value={`₩${thisMonthTotal.toLocaleString()}`} hint={thisMonth} accent="amber" />
        <StatCard label="지난 달 청구" value={`₩${lastMonthTotal.toLocaleString()}`} hint={lastMonth} accent="violet" />
        <StatCard label="전체 합계" value={`₩${invoices.reduce((s, i) => s + Number(i.total || 0), 0).toLocaleString()}`} hint={`${invoices.length}건 누적`} accent="green" />
        <StatCard label="공급처" value={`${new Set(invoices.map(i => i.supplier_id)).size}곳`} hint="청구서 있는 공급처" accent="blue" />
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        <div className="p-3 border-b border-zinc-100 flex items-center gap-3 flex-wrap">
          <div className="w-40">
            <Select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
              <option value="all">전체 기간</option>
              {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
            </Select>
          </div>
          <div className="w-56">
            <Select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}>
              <option value="all">모든 공급처</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </div>
          <div className="flex-1 min-w-[180px]">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="" />
          </div>
          <span className="text-[12px] text-zinc-500 ml-auto">
            {filtered.length}건 · 합계 <span className="font-semibold text-zinc-700 tabular-nums">₩{total.toLocaleString()}</span>
          </span>
        </div>

        {loading ? (
          <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <Empty icon="🏭" title="공급처 계산서가 없어요" description="우상단 '📥 엑셀 일괄 등록'으로 시작하세요." />
        ) : (
          <div>
            {months.map(month => {
              const list = groupedByMonth[month]
              const mTotal = list.reduce((s, i) => s + Number(i.total || 0), 0)
              return (
                <div key={month}>
                  <div className="px-4 py-2.5 bg-zinc-50 border-y border-zinc-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-bold text-zinc-900 tabular-nums">{month}</span>
                      <span className="text-[11px] text-zinc-500">· {list.length}건</span>
                    </div>
                    <span className="text-[12px] font-semibold tabular-nums text-zinc-700">₩{mTotal.toLocaleString()}</span>
                  </div>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
                        <th className="px-4 py-2.5">공급처</th>
                        <th className="px-4 py-2.5">분류</th>
                        <th className="px-4 py-2.5 text-right">라인 수</th>
                        <th className="px-4 py-2.5 text-right">총액</th>
                        <th className="px-4 py-2.5">메모</th>
                        <th className="px-4 py-2.5 text-right">관리</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map(inv => {
                        const lineCount = (itemsByInvoice.get(inv.id) || []).length
                        const cat = supplierCategory(inv.supplier_id)
                        return (
                          <tr key={inv.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                            <td className="px-4 py-2.5 font-medium text-zinc-900">
                              <button onClick={() => setDetail(inv)} className="hover:underline">{supplierName(inv.supplier_id)}</button>
                            </td>
                            <td className="px-4 py-2.5">
                              {cat ? <Badge color={cat === '공임' ? 'green' : cat === '원단' ? 'blue' : cat === '나염/프린트' ? 'violet' : 'zinc'}>{cat}</Badge> : '—'}
                            </td>
                            <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{lineCount}건</td>
                            <td className="px-4 py-2.5 text-right font-semibold tabular-nums">₩{Number(inv.total).toLocaleString()}</td>
                            <td className="px-4 py-2.5 text-zinc-500 text-[11px] max-w-xs truncate">{inv.notes || '—'}</td>
                            <td className="px-4 py-2.5 text-right whitespace-nowrap">
                              <Button size="sm" variant="ghost" onClick={() => setDetail(inv)}>상세</Button>
                              <Button size="sm" variant="ghost" onClick={() => handleDelete(inv)} className="text-rose-600 hover:bg-rose-50">삭제</Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <DetailDrawer invoice={detail} items={detail ? itemsByInvoice.get(detail.id) || [] : []} supplierName={detail ? supplierName(detail.supplier_id) : ''} onClose={() => setDetail(null)} />
    </div>
  )
}

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: 'blue'|'green'|'amber'|'violet' }) {
  const palettes: Record<string, string> = {
    blue:   'from-blue-50 to-white border-blue-100',
    green:  'from-emerald-50 to-white border-emerald-100',
    amber:  'from-amber-50 to-white border-amber-100',
    violet: 'from-violet-50 to-white border-violet-100',
  }
  const bg = accent ? `bg-gradient-to-br ${palettes[accent]}` : 'bg-white border-zinc-200'
  return (
    <div className={`border rounded-2xl p-4 ${bg}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-[22px] font-bold text-zinc-900 mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-zinc-500 mt-0.5">{hint}</p>}
    </div>
  )
}

function DetailDrawer({ invoice, items, supplierName, onClose }: {
  invoice: SupplierInvoice | null
  items: SupplierInvoiceItem[]
  supplierName: string
  onClose: () => void
}) {
  if (!invoice) return null
  // 상호별 합계
  const byBrand = new Map<string, number>()
  items.forEach(it => {
    const b = it.brand || '(미지정)'
    byBrand.set(b, (byBrand.get(b) || 0) + Number(it.amount || 0))
  })
  const brands = Array.from(byBrand.entries()).sort((a, b) => b[1] - a[1])

  return (
    <Drawer open={!!invoice} onClose={onClose} title={`${supplierName} · ${invoice.period || ''} 계산서`} width="xl">
      <div className="bg-zinc-50 rounded-xl p-4 mb-5">
        <div className="text-[24px] font-bold text-zinc-900 tabular-nums">₩{Number(invoice.total).toLocaleString()}</div>
        <p className="text-[11px] text-zinc-500 mt-1">{items.length}개 라인 · {brands.length}개 상호</p>
      </div>

      {brands.length > 0 && (
        <div className="mb-4">
          <h3 className="text-[13px] font-semibold text-zinc-900 mb-2">상호별 집계</h3>
          <div className="flex flex-wrap gap-2">
            {brands.map(([name, amt]) => (
              <div key={name} className="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-[12px]">
                <span className="font-medium text-blue-900">{name}</span>
                <span className="ml-2 text-blue-700 font-semibold tabular-nums">₩{amt.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <h3 className="text-[13px] font-semibold text-zinc-900 mb-2">라인별 상세</h3>
      <div className="border border-zinc-200 rounded-xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-3 py-2 text-left">날짜</th>
              <th className="px-3 py-2 text-left">상호</th>
              <th className="px-3 py-2 text-left">품목</th>
              <th className="px-3 py-2 text-right">수량</th>
              <th className="px-3 py-2 text-right">단가</th>
              <th className="px-3 py-2 text-right">금액</th>
            </tr>
          </thead>
          <tbody>
            {items.map(it => (
              <tr key={it.id} className="border-t border-zinc-100">
                <td className="px-3 py-2 text-zinc-500 text-[11px] tabular-nums">{it.line_date || '—'}</td>
                <td className="px-3 py-2">{it.brand || '—'}</td>
                <td className="px-3 py-2">{it.product_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{it.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums">₩{Number(it.unit_price).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">₩{Number(it.amount).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Drawer>
  )
}

/* ───── 엑셀 일괄 등록 (대성식 + 누리나염식 자동 감지) ───── */
function ImportButton({ suppliers, onImported }: { suppliers: Vendor[]; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [parsed, setParsed] = useState<ReturnType<typeof parseSupplierInvoiceWorkbook>>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [fileName, setFileName] = useState('')
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: number; fail: number; errors: string[] } | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        if (!isSupplierInvoiceFormat(wb)) {
          alert('공급처 계산서 양식이 아닙니다.\n(날짜+품목+수량+단가+금액 헤더 필요)')
          return
        }
        const sheets = parseSupplierInvoiceWorkbook(wb)
        if (sheets.length === 0) {
          alert('데이터가 있는 시트를 찾지 못했어요.')
          return
        }
        setParsed(sheets)
        setResult(null)
        // 파일명에서 공급처 추측
        const baseName = file.name.replace(/\.xlsx?$/, '').replace(/계산서|거래내역서/g, '').trim()
        const guess = suppliers.find(s => baseName.includes(s.name) || s.name.includes(baseName))
        if (guess) setSupplierId(guess.id)
        setDrawerOpen(true)
      } catch (err: any) {
        alert('파일 읽기 오류: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function doImport() {
    if (!supplierId) return alert('공급처를 선택해주세요.')
    if (parsed.length === 0) return
    const total = parsed.reduce((s, p) => s + p.lines.length, 0)
    if (!confirm(`${parsed.length}개월치 / ${total}개 라인을 등록할까요?`)) return

    setImporting(true)
    setResult(null)
    let ok = 0, fail = 0
    const errors: string[] = []

    try {
      for (const sheet of parsed) {
        const { data: invData, error: invErr } = await supabase.from('supplier_invoices').insert({
          supplier_id: supplierId,
          period: sheet.period,
          subtotal: sheet.subtotal,
          vat: 0,
          total: sheet.subtotal,
          notes: `[${sheet.sheetName}]`,
        }).select().single()
        if (invErr) { fail += sheet.lines.length; errors.push(`${sheet.sheetName}: ${invErr.message}`); continue }

        const itemPayload = sheet.lines.map((l, i) => ({
          invoice_id: invData.id,
          line_date: l.line_date,
          product_name: l.product_name,
          brand: l.brand,
          quantity: l.quantity,
          unit_price: l.unit_price,
          sort_order: i,
        }))
        if (itemPayload.length > 0) {
          const { error: itErr } = await supabase.from('supplier_invoice_items').insert(itemPayload)
          if (itErr) {
            fail += itemPayload.length
            errors.push(`${sheet.sheetName}: 라인 ${itErr.message}`)
          } else {
            ok += itemPayload.length
          }
        }
      }
      setResult({ ok, fail, errors: errors.slice(0, 10) })
      if (ok > 0) onImported()
    } catch (err: any) {
      setResult({ ok, fail: total - ok, errors: [err.message] })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      <Button variant="secondary" onClick={() => fileRef.current?.click()}>📥 엑셀 일괄 등록</Button>

      <Drawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setParsed([]); setResult(null) }}
        title={`공급처 계산서 가져오기 — ${fileName}`}
        width="xl"
        footer={
          result ? (
            <Button onClick={() => { setDrawerOpen(false); setParsed([]); setResult(null) }}>닫기</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { setDrawerOpen(false); setParsed([]) }}>취소</Button>
              <Button onClick={doImport} disabled={importing || !supplierId}>
                {importing ? '등록 중…' : `${parsed.length}개월 / ${parsed.reduce((s, p) => s + p.lines.length, 0)}건 등록`}
              </Button>
            </>
          )
        }
      >
        {parsed.length === 0 ? (
          <Empty icon="🏭" title="파일 선택해주세요" />
        ) : (
          <>
            <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-800">
              <strong>🏭 공급처 계산서 양식 감지됨</strong> — {parsed.length}개 시트.
              {parsed[0].lines.some(l => l.brand) ? ' (상호 컬럼 있음 — 어느 브랜드 공임인지 추적됨)' : ' (단순 양식)'}
            </div>

            <div className="mb-4">
              <Label required>공급처 선택 — 이 파일의 모든 계산서가 이 공급처에 등록됩니다</Label>
              <Select value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">— 선택 —</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name}{s.memo?.startsWith('[') ? ` ${s.memo.match(/^\[([^\]]+)\]/)?.[0] || ''}` : ''}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              {parsed.map((sheet, idx) => (
                <details key={idx} className="border border-zinc-200 rounded-xl overflow-hidden group">
                  <summary className="px-4 py-2.5 cursor-pointer hover:bg-zinc-50 flex items-center justify-between list-none">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-zinc-400 group-open:rotate-90 transition-transform inline-block">▶</span>
                      <span className="font-semibold text-[13px] text-zinc-900">{sheet.sheetName}</span>
                      {sheet.period && <Badge color="blue">{sheet.period}</Badge>}
                      <span className="text-[11px] text-zinc-500">{sheet.lines.length}라인</span>
                    </div>
                    <span className="text-[12px] text-zinc-700 font-medium tabular-nums">₩{Math.round(sheet.subtotal).toLocaleString()}</span>
                  </summary>
                  <div className="px-3 pb-3 overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-zinc-50">
                        <tr>
                          <th className="px-2 py-1.5 text-left">날짜</th>
                          <th className="px-2 py-1.5 text-left">상호</th>
                          <th className="px-2 py-1.5 text-left">품목</th>
                          <th className="px-2 py-1.5 text-right">수량</th>
                          <th className="px-2 py-1.5 text-right">단가</th>
                          <th className="px-2 py-1.5 text-right">금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sheet.lines.slice(0, 20).map((l, i) => (
                          <tr key={i} className="border-t border-zinc-100">
                            <td className="px-2 py-1 text-zinc-500 tabular-nums">{l.line_date || '—'}</td>
                            <td className="px-2 py-1">{l.brand || '—'}</td>
                            <td className="px-2 py-1">{l.product_name}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{l.quantity}</td>
                            <td className="px-2 py-1 text-right tabular-nums">₩{l.unit_price.toLocaleString()}</td>
                            <td className="px-2 py-1 text-right tabular-nums font-medium">₩{l.amount.toLocaleString()}</td>
                          </tr>
                        ))}
                        {sheet.lines.length > 20 && (
                          <tr><td colSpan={6} className="px-2 py-2 text-center text-zinc-500 text-[11px]">… 외 {sheet.lines.length - 20}건</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>

            {result && (
              <div className="mt-5 p-4 rounded-xl bg-zinc-50 border border-zinc-200">
                <div className="flex gap-3 mb-3">
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
                  <ul className="text-[11px] text-zinc-600 space-y-1 max-h-32 overflow-y-auto font-mono">
                    {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </Drawer>
    </>
  )
}
