import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Vendor, Product, Invoice, InvoiceItem } from '@/lib/types'
import { Button, Input, Select, Label, PageHeader, Drawer, Empty, Badge, Textarea, Checkbox, BulkBar } from '@/components/ui'
import { exportInvoiceReceipt, exportInvoiceReceiptsMulti } from '@/lib/exportXlsx'
import InvoiceImportButton from '@/components/InvoiceImportButton'
import { useBulkSelect } from '@/hooks/useBulkSelect'
import { softDelete, softDeleteMany } from '@/lib/trash'
import { todayKR } from '@/lib/datetime'

/* ──────────────────────────────────────────────────────────
 * 계산서/영수증 페이지
 * - 월별로 그룹핑해서 표시
 * - 상단 요약 카드
 * - 출력 버튼 (PDF/인쇄)
 * - 새/편집 모두 명시적 저장 (자동저장 제거)
 * ────────────────────────────────────────────────────────── */

export default function InvoicesPage() {
 const navigate = useNavigate()
 const [searchParams] = useSearchParams()
 const [vendors, setVendors] = useState<Vendor[]>([])
 const [list, setList] = useState<Invoice[]>([])
 const [loading, setLoading] = useState(true)
 const [drawerOpen, setDrawerOpen] = useState(false)
 const [editing, setEditing] = useState<Invoice | null>(null)
 // URL ?vendor=ID → 그 거래처로 자동 필터 (거래처 페이지에서 [계산서 →] 누르고 옴)
 const urlVendor = searchParams.get('vendor')
 const [vendorFilter, setVendorFilter] = useState<string>(urlVendor || 'all')
 const thisYearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
 // URL ?month=YYYY-MM 또는 ?year=YYYY 를 읽어서 초기 필터 설정 (대시보드 카드에서 넘어올 때)
 const urlMonth = searchParams.get('month')
 const urlYear = searchParams.get('year')
 // 거래처 필터 들어오면 기간은 전체로 (그 거래처의 모든 계산서 보기 위해)
 const initialMonth = urlMonth ? urlMonth : urlYear ? `year:${urlYear}` : urlVendor ? 'all' : thisYearMonth
 const [monthFilter, setMonthFilter] = useState<string>(initialMonth)
 const [search, setSearch] = useState('')
 const bulk = useBulkSelect()

 async function load() {
 setLoading(true)
 const [{ data: vData }, { data: iData }] = await Promise.all([
 supabase.from('vendors').select('*').eq('vendor_type', 'customer').order('name'),
 supabase.from('invoices').select('*').is('deleted_at', null).order('issue_date', { ascending: false }),
 ])
 setVendors(vData ?? [])
 setList(iData ?? [])
 setLoading(false)
 }

 useEffect(() => { load() }, [])

 // URL ?edit=<id> 가 들어오면 해당 계산서 자동 열기 (견적서 → 계산서 발행 직후 사용)
 useEffect(() => {
   const editId = searchParams.get('edit')
   if (!editId || list.length === 0) return
   const found = list.find(i => i.id === editId)
   if (found && !drawerOpen) {
     setEditing(found)
     setDrawerOpen(true)
   }
 }, [searchParams, list])

 function vendorName(id: string) {
 return vendors.find(v => v.id === id)?.name || '—'
 }

 async function handleDelete(i: Invoice) {
 if (!confirm(`${i.issue_date} 계산서를 휴지통으로 옮길까요?\n30일 안에 복구 가능.`)) return
 const { error } = await softDelete('invoices', i.id)
 if (error) return alert(error.message)
 load()
 }

 async function handleBulkDelete() {
   const ids = Array.from(bulk.selected)
   if (ids.length === 0) return
   if (!confirm(`선택한 ${ids.length}건의 계산서를 휴지통으로 옮길까요?\n30일 안에 복구 가능.`)) return
   const { error } = await softDeleteMany('invoices', ids)
   if (error) return alert(error.message)
   bulk.clear()
   load()
 }

 async function exportOne(inv: Invoice) {
   const { data: items } = await supabase.from('invoice_items').select('*').eq('invoice_id', inv.id).order('sort_order')
   exportInvoiceReceipt({
     vendor_name: vendorName(inv.vendor_id),
     issue_date: inv.issue_date,
     supplier_business_number: inv.supplier_business_number,
     supplier_name: inv.supplier_name,
     supplier_ceo: inv.supplier_ceo,
     supplier_address: inv.supplier_address,
     bank_info: inv.bank_info,
     notes: inv.notes,
     items: (items || []).map(it => ({
       line_date: it.line_date,
       product_name: it.product_name,
       color: it.color,
       quantity: it.quantity,
       unit_price: Number(it.unit_price),
     })),
   })
 }

 async function exportFiltered() {
   if (filtered.length === 0) return alert('내보낼 계산서가 없습니다.')
   if (filtered.length > 50 && !confirm(`${filtered.length}건을 한 파일에 내보낼까요? 시간이 좀 걸려요.`)) return
   const ids = filtered.map(i => i.id)
   const { data: allItems } = await supabase.from('invoice_items').select('*').in('invoice_id', ids).order('sort_order')
   const itemsByInv = new Map<string, any[]>()
   ;(allItems || []).forEach(it => {
     const arr = itemsByInv.get(it.invoice_id) || []
     arr.push(it)
     itemsByInv.set(it.invoice_id, arr)
   })
   const payload = filtered.map(inv => ({
     vendor_name: vendorName(inv.vendor_id),
     issue_date: inv.issue_date,
     supplier_business_number: inv.supplier_business_number,
     supplier_name: inv.supplier_name,
     supplier_ceo: inv.supplier_ceo,
     supplier_address: inv.supplier_address,
     bank_info: inv.bank_info,
     notes: inv.notes,
     items: (itemsByInv.get(inv.id) || []).map(it => ({
       line_date: it.line_date,
       product_name: it.product_name,
       color: it.color,
       quantity: it.quantity,
       unit_price: Number(it.unit_price),
     })),
   }))
   const fname = vendorFilter === 'all' ? '계산서_전체' : `계산서_${vendorName(vendorFilter)}`
   exportInvoiceReceiptsMulti(payload, fname)
 }

 // 데이터에 있는 월 목록
 const allMonths = Array.from(new Set(list.map(i => i.issue_date.slice(0, 7)))).sort((a, b) => b.localeCompare(a))

 const filtered = list.filter(i => {
   if (vendorFilter !== 'all' && i.vendor_id !== vendorFilter) return false
   if (monthFilter !== 'all') {
     if (monthFilter.startsWith('year:')) {
       const y = monthFilter.slice(5)
       if (!i.issue_date.startsWith(y + '-')) return false
     } else if (!i.issue_date.startsWith(monthFilter)) return false
   }
   if (search.trim()) {
     const s = search.trim().toLowerCase()
     const vName = vendorName(i.vendor_id).toLowerCase()
     const notes = (i.notes || '').toLowerCase()
     if (!vName.includes(s) && !notes.includes(s) && !i.issue_date.includes(s)) return false
   }
   return true
 })

 // 월별 그룹
 const groupedByMonth = filtered.reduce<Record<string, Invoice[]>>((acc, inv) => {
 const month = inv.issue_date.slice(0, 7) // YYYY-MM
 if (!acc[month]) acc[month] = []
 acc[month].push(inv)
 return acc
 }, {})
 const months = Object.keys(groupedByMonth).sort((a, b) => b.localeCompare(a))

 // 요약
 const now = new Date()
 const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
 const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
 const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`
 const thisMonthList = filtered.filter(i => i.issue_date.startsWith(thisMonth))
 const lastMonthList = filtered.filter(i => i.issue_date.startsWith(lastMonth))
 const thisMonthTotal = thisMonthList.reduce((s, i) => s + Number(i.total || 0), 0)
 const lastMonthTotal = lastMonthList.reduce((s, i) => s + Number(i.total || 0), 0)
 const allTotal = filtered.reduce((s, i) => s + Number(i.total || 0), 0)

 return (
 <div>
 <PageHeader
 title="계산서 / 영수증"
 description="거래처별 매출 계산서를 발행합니다. 입고에서 자동으로 가져오거나, 출력해서 거래처에 전달할 수 있어요."
 action={<>
   <Button variant="secondary" onClick={exportFiltered} disabled={filtered.length === 0}>📥 엑셀 내보내기 ({filtered.length})</Button>
   <InvoiceImportButton onImported={load} />
   <Button onClick={() => { setEditing(null); setDrawerOpen(true) }} disabled={vendors.length === 0}>＋ 새 계산서</Button>
 </>}
 />

 <BulkBar count={bulk.count} onClear={bulk.clear} onDelete={handleBulkDelete} label="계산서" />

 {/* 상단 요약 카드 */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
 <StatCard
   label="이번 달 매출"
   value={`₩${thisMonthTotal.toLocaleString()}`}
   hint={`${thisMonth} · ${thisMonthList.length}건`}
   onClick={() => { setMonthFilter(thisMonth); setVendorFilter('all'); setSearch('') }}
 />
 <StatCard
   label="지난 달 매출"
   value={`₩${lastMonthTotal.toLocaleString()}`}
   hint={`${lastMonth} · ${lastMonthList.length}건`}
   onClick={() => { setMonthFilter(lastMonth); setVendorFilter('all'); setSearch('') }}
 />
 <StatCard
   label="전체 매출"
   value={`₩${allTotal.toLocaleString()}`}
   hint={`${filtered.length}건 누적`}
   onClick={() => { setMonthFilter('all'); setVendorFilter('all'); setSearch('') }}
 />
 <StatCard
 label="평균 금액"
 value={filtered.length ? `₩${Math.round(allTotal / filtered.length).toLocaleString()}` : '₩0'}
 hint="건당 평균"
 />
 </div>

 {vendors.length === 0 ? (
 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <Empty icon="🏢" title="먼저 고객 거래처를 등록해주세요" />
 </div>
 ) : (
 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <div className="p-3 border-b border-zinc-100 flex items-center gap-3 flex-wrap">
 <label className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-zinc-50 cursor-pointer">
   <Checkbox
     checked={filtered.length > 0 && filtered.every(i => bulk.has(i.id))}
     indeterminate={filtered.some(i => bulk.has(i.id))}
     onChange={() => bulk.toggleAll(filtered.map(i => i.id))}
     ariaLabel="현재 필터 전체 선택"
   />
   <span className="text-[12px] text-zinc-600 select-none">전체 선택</span>
 </label>
 <div className="w-40">
 <Select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
 <option value="all">전체 기간</option>
 {Array.from(new Set([
   ...allMonths.map(m => m.slice(0, 4)),
   ...(monthFilter.startsWith('year:') ? [monthFilter.slice(5)] : []),
 ])).sort((a, b) => b.localeCompare(a)).map(y => (
   <option key={`y${y}`} value={`year:${y}`}>{y}년 전체</option>
 ))}
 {!monthFilter.startsWith('year:') && monthFilter !== 'all' && !allMonths.includes(monthFilter) && <option value={monthFilter}>{monthFilter}</option>}
 {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
 </Select>
 </div>
 <div className="w-56">
 <Select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
 <option value="all">모든 거래처</option>
 {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name ? `${v.name} (${v.company_name})` : v.name}</option>)}
 </Select>
 </div>
 <div className="flex-1 min-w-[180px]">
 <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="" />
 </div>
 <span className="text-[12px] text-zinc-500 ml-auto">
 {filtered.length}건 · 합계 <span className="font-semibold text-zinc-700 tabular-nums">₩{allTotal.toLocaleString()}</span>
 </span>
 </div>

 {loading ? (
 <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
 ) : filtered.length === 0 ? (
 <Empty icon="🧾" title="발행된 계산서가 없습니다" description="＋ 새 계산서 버튼으로 시작하세요." />
 ) : (
 <div>
 {months.map(month => {
 const monthList = groupedByMonth[month]
 const monthTotal = monthList.reduce((s, i) => s + Number(i.total || 0), 0)
 return (
 <div key={month}>
 <div className="px-4 py-2.5 bg-zinc-50 border-y border-zinc-100 flex items-center justify-between">
 <div className="flex items-center gap-2">
 <span className="text-[13px] font-bold text-zinc-900 tabular-nums">{month}</span>
 <span className="text-[11px] text-zinc-500">· {monthList.length}건</span>
 </div>
 <span className="text-[12px] font-semibold tabular-nums text-zinc-700">
 ₩{monthTotal.toLocaleString()}
 </span>
 </div>
 <table className="w-full text-[13px]">
 <thead>
 <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
 <th className="pl-4 pr-2 py-2.5 w-10">
   <Checkbox
     checked={monthList.length > 0 && monthList.every(i => bulk.has(i.id))}
     indeterminate={monthList.some(i => bulk.has(i.id))}
     onChange={() => bulk.toggleAll(monthList.map(i => i.id))}
     ariaLabel={`${month} 전체 선택`}
   />
 </th>
 <th className="px-4 py-2.5 w-28">발행일</th>
 <th className="px-4 py-2.5">거래처</th>
 <th className="px-4 py-2.5 text-right">공급가액</th>
 <th className="px-4 py-2.5 text-right">부가세</th>
 <th className="px-4 py-2.5 text-right">총 합계</th>
 <th className="px-4 py-2.5 text-right">관리</th>
 </tr>
 </thead>
 <tbody>
 {monthList.map(i => (
 <tr key={i.id} className={`border-t border-zinc-100 hover:bg-zinc-50/50 ${bulk.has(i.id) ? 'bg-zinc-50' : ''}`}>
 <td className="pl-4 pr-2 py-2.5">
   <Checkbox checked={bulk.has(i.id)} onChange={() => bulk.toggle(i.id)} ariaLabel={`${i.issue_date} 선택`} />
 </td>
 <td className="px-4 py-2.5 font-medium tabular-nums">
 <button onClick={() => { setEditing(i); setDrawerOpen(true) }} className="hover:underline">
 {i.issue_date.slice(5)}
 </button>
 </td>
 <td className="px-4 py-2.5">
   <div className="flex items-center gap-1.5 flex-wrap">
     <Badge color="green">{vendorName(i.vendor_id)}</Badge>
     {i.quotation_id && <Badge color="violet">견적서</Badge>}
     {(() => {
       if (i.paid_at) return <Badge color="green">💵 입금완료</Badge>
       // 미수 — 경과일 계산
       const issued = new Date(i.issue_date).getTime()
       const days = Math.floor((Date.now() - issued) / (24*60*60*1000))
       if (days >= 30) return <Badge color="rose">⚠ 미수 {days}일</Badge>
       if (days >= 14) return <Badge color="amber">미수 {days}일</Badge>
       return <Badge color="zinc">미수 {days}일</Badge>
     })()}
   </div>
 </td>
 <td className="px-4 py-2.5 text-right tabular-nums">₩{Number(i.subtotal).toLocaleString()}</td>
 <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">₩{Number(i.vat).toLocaleString()}</td>
 <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
   ₩{Number(i.total).toLocaleString()}
   {Number(i.deposit_amount || 0) > 0 && (
     <div className="text-[10px] text-amber-600 font-normal mt-0.5">
       선납 −₩{Number(i.deposit_amount).toLocaleString()}<br/>
       잔금 ₩{(Number(i.total) - Number(i.deposit_amount || 0)).toLocaleString()}
     </div>
   )}
 </td>
 <td className="px-4 py-2.5 text-right whitespace-nowrap">
 <Button size="sm" variant="ghost" onClick={() => navigate(`/invoices/${i.id}/print`)} title="새 탭에서 인쇄 화면 열기">🖨️ 출력</Button>
 <Button size="sm" variant="ghost" onClick={() => exportOne(i)} title="영수증 양식으로 엑셀 다운로드">📥 엑셀</Button>
 <Button size="sm" variant="ghost" onClick={() => { setEditing(i); setDrawerOpen(true) }}>수정</Button>
 <Button size="sm" variant="ghost" onClick={() => handleDelete(i)} className="text-rose-600 hover:bg-rose-50">삭제</Button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )
 })}
 </div>
 )}
 </div>
 )}

 <InvoiceDrawer
 open={drawerOpen}
 onClose={() => setDrawerOpen(false)}
 editing={editing}
 vendors={vendors}
 onSaved={() => { setDrawerOpen(false); load() }}
 />
 </div>
 )
}

function StatCard({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick?: () => void }) {
 const inner = (
 <div className={`bg-white border border-zinc-200 rounded-2xl p-4 text-left ${onClick ? 'hover:border-zinc-400 hover:bg-zinc-50/50 cursor-pointer transition-colors' : ''}`}>
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
 <p className="text-[20px] font-bold text-zinc-900 mt-1 tabular-nums">{value}</p>
 {hint && <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center justify-between"><span>{hint}</span>{onClick && <span>→</span>}</p>}
 </div>
 )
 return onClick ? <button onClick={onClick} className="block w-full">{inner}</button> : inner
}

/* ───── 입고에서 가져올 수 있는 항목 (날짜+상품 집계) ───── */
interface ImportableItem {
 product_id: string | null
 product_code: string
 product_name: string
 color: string | null
 quantity: number
 unit_price: number
}
interface DateGroup {
 date: string
 items: ImportableItem[]
 totalQty: number
}

/* ───── 로컬 라인 (저장 전에 메모리에서만 관리) ───── */
interface LocalLine {
 tempId: string
 persistedId?: string // DB id (편집 시)
 line_date: string
 product_id: string | null
 product_name: string
 color: string | null
 size: string | null
 sizes: Record<string, number> | null
 quantity: number
 unit_price: number
}

function newTempId() { return 'tmp_' + Math.random().toString(36).slice(2) }

function InvoiceDrawer({ open, onClose, editing, vendors, onSaved }: {
 open: boolean; onClose: () => void; editing: Invoice | null; vendors: Vendor[]; onSaved: () => void
}) {
 const navigate = useNavigate()
 const [form, setForm] = useState<Partial<Invoice>>({})
 const [originalIds, setOriginalIds] = useState<Set<string>>(new Set())
 const [lines, setLines] = useState<LocalLine[]>([])
 const [products, setProducts] = useState<Product[]>([])
 const [importGroups, setImportGroups] = useState<DateGroup[]>([])
 const [importedDates, setImportedDates] = useState<Set<string>>(new Set())
 const [saving, setSaving] = useState(false)
 const [error, setError] = useState<string | null>(null)
 const [dirty, setDirty] = useState(false)

 useEffect(() => {
 if (!open) return
 if (editing) {
 setForm(editing)
 loadExisting(editing)
 } else {
 setForm({
 issue_date: todayKR(),
 vendor_id: vendors[0]?.id,
 supplier_business_number: '216-21-18212',
 supplier_name: '써치(SEARCH)',
 supplier_ceo: '함기호',
 supplier_address: '서울시 동대문구 안암로 16길 4, 2층',
 bank_info: '함기호(써치) 국민은행 038737-04-002188',
 })
 setLines([])
 setOriginalIds(new Set())
 if (vendors[0]) {
 loadProducts(vendors[0].id)
 loadImportable(vendors[0].id)
 }
 }
 setError(null)
 setDirty(false)
 setImportedDates(new Set())
 }, [editing, open, vendors])

 async function loadExisting(inv: Invoice) {
 const { data } = await supabase.from('invoice_items').select('*').eq('invoice_id', inv.id).order('line_date').order('sort_order')
 const persisted: LocalLine[] = (data ?? []).map(it => ({
 tempId: newTempId(),
 persistedId: it.id,
 line_date: it.line_date || '',
 product_id: it.product_id,
 product_name: it.product_name || '',
 color: it.color,
 size: it.size || null,
 sizes: (it as any).sizes || null,
 quantity: Number(it.quantity || 0),
 unit_price: Number(it.unit_price || 0),
 }))
 setLines(persisted)
 setOriginalIds(new Set(persisted.map(l => l.persistedId!).filter(Boolean)))
 loadProducts(inv.vendor_id)
 loadImportable(inv.vendor_id)
 }

 async function loadProducts(vendorId: string) {
 const { data } = await supabase.from('products').select('*').eq('vendor_id', vendorId).order('code')
 setProducts(data ?? [])
 }

 async function loadImportable(vendorId: string) {
 const { data: incomings } = await supabase.from('incoming').select('id, period, created_at').eq('vendor_id', vendorId)
 const ids = (incomings ?? []).map(i => i.id)
 if (ids.length === 0) { setImportGroups([]); return }

 // 입고별 fallback 날짜 (라인에 delivery_date가 없으면 사용)
 const incomingDateFallback = new Map<string, string>()
 ;(incomings ?? []).forEach((inc: any) => {
   // period "2026.05" → "2026-05-01" 형태, 없으면 created_at의 날짜 부분
   let fallback = ''
   if (inc.period) {
     const m = String(inc.period).match(/(\d{4})[.\-/](\d{1,2})/)
     if (m) fallback = `${m[1]}-${m[2].padStart(2, '0')}-01`
   }
   if (!fallback && inc.created_at) fallback = String(inc.created_at).slice(0, 10)
   if (fallback) incomingDateFallback.set(inc.id, fallback)
 })

 const { data: rawItems } = await supabase
 .from('incoming_items')
 .select('*, product:products(color, selling_price)')
 .in('incoming_id', ids)

 // 거래처의 상품 카탈로그 — fallback 매칭용 (product_id가 비어있어도 코드/이름으로 단가 잡기)
 const { data: vendorProducts } = await supabase
 .from('products')
 .select('id, code, name, color, selling_price')
 .eq('vendor_id', vendorId)
 const byCode = new Map<string, any>()
 const byName = new Map<string, any>()
 ;(vendorProducts ?? []).forEach((p: any) => {
   if (p.code) byCode.set(String(p.code).trim().toLowerCase(), p)
   if (p.name) byName.set(String(p.name).trim().toLowerCase(), p)
 })

 const map = new Map<string, Map<string, ImportableItem>>()
 const summaryRe = /^(합\s*계|소\s*계|총\s*계|계|total|sum)$/i
 const noteRe = /(위\s*품목|상기\s*품목|이상.*(출고|입고).*함|위\s*내역)/i
 ;(rawItems ?? []).forEach((it: any) => {
 // 합계/소계/노트 행 안전 필터
 const code = (it.product_code || '').toString().trim()
 const name = (it.product_name || '').toString().trim()
 if (summaryRe.test(code) || summaryRe.test(name)) return
 if (noteRe.test(code) || noteRe.test(name)) return
 const itemDate = it.delivery_date || incomingDateFallback.get(it.incoming_id) || ''
 if (!itemDate) return   // 그래도 정말 아무 날짜도 없으면 스킵
 const dKey = itemDate
 const pKey = it.product_code || it.product_id || 'unknown'
 if (!map.has(dKey)) map.set(dKey, new Map())
 const dMap = map.get(dKey)!
 if (!dMap.has(pKey)) {
   // 1순위: incoming_items.product_id 로 join된 결과 (it.product)
   // 2순위: 같은 거래처 내에서 product_code 매칭
   // 3순위: 같은 거래처 내에서 product_name 매칭
   let matched = it.product
   let matchedId = it.product_id
   if (!matched || !matched.selling_price) {
     const codeKey = (it.product_code || '').toString().trim().toLowerCase()
     const nameKey = (it.product_name || '').toString().trim().toLowerCase()
     const found = (codeKey && byCode.get(codeKey)) || (nameKey && byName.get(nameKey))
     if (found) {
       matched = found
       matchedId = found.id  // product_id도 채워줌 → 계산서 라인에 정상적으로 연결
     }
   }
   dMap.set(pKey, {
     product_id: matchedId,
     product_code: it.product_code || (matched?.code ?? ''),
     product_name: it.product_name || (matched?.name ?? ''),
     color: matched?.color ?? null,
     quantity: 0,
     unit_price: Number(matched?.selling_price ?? 0),
   })
 }
 dMap.get(pKey)!.quantity += Number(it.total_quantity || 0)
 })

 const result: DateGroup[] = Array.from(map.entries())
 .map(([date, dMap]) => {
 const itemArr = Array.from(dMap.values())
 return { date, items: itemArr, totalQty: itemArr.reduce((s, x) => s + x.quantity, 0) }
 })
 .sort((a, b) => b.date.localeCompare(a.date))
 setImportGroups(result)
 }

 function update<K extends keyof Invoice>(k: K, v: Invoice[K]) {
 setForm(prev => ({ ...prev, [k]: v }))
 setDirty(true)
 if (k === 'vendor_id') {
 loadProducts(v as string)
 loadImportable(v as string)
 }
 }

 /* ───── 로컬 라인 조작 (DB 미반영) ───── */
 function addEmptyLine() {
 setLines(prev => [...prev, {
 tempId: newTempId(),
 line_date: form.issue_date || todayKR(),
 product_id: null,
 product_name: '',
 color: '',
 size: null,
 sizes: null,
 quantity: 1,
 unit_price: 0,
 }])
 setDirty(true)
 }

 function updateLine(tempId: string, patch: Partial<LocalLine>) {
 setLines(prev => prev.map(l => l.tempId === tempId ? { ...l, ...patch } : l))
 setDirty(true)
 }

 function removeLine(tempId: string) {
 setLines(prev => prev.filter(l => l.tempId !== tempId))
 setDirty(true)
 }

 function pickProductForLine(line: LocalLine, productId: string) {
 const p = products.find(x => x.id === productId)
 if (!p) {
 updateLine(line.tempId, { product_id: null })
 return
 }
 updateLine(line.tempId, {
 product_id: p.id,
 product_name: p.name,
 color: p.color,
 unit_price: p.selling_price,
 })
 }

 function importDate(g: DateGroup) {
 const existing = new Set(lines.map(l => `${l.line_date}|${l.product_id || ''}`))
 const newOnes: LocalLine[] = g.items
 .filter(it => !existing.has(`${g.date}|${it.product_id || ''}`))
 .map(it => ({
 tempId: newTempId(),
 line_date: g.date,
 product_id: it.product_id,
 product_name: it.product_name,
 color: it.color,
 quantity: it.quantity,
 unit_price: it.unit_price,
 }))
 if (newOnes.length === 0) {
 alert('이 날짜의 라인은 이미 모두 추가되어 있어요.')
 return
 }
 setLines(prev => [...prev, ...newOnes])
 setImportedDates(new Set([...importedDates, g.date]))
 setDirty(true)
 }

 function importAll() {
 if (importGroups.length === 0) return
 if (!confirm(`총 ${importGroups.length}개 날짜의 입고 내역을 모두 가져올까요?`)) return
 const existing = new Set(lines.map(l => `${l.line_date}|${l.product_id || ''}`))
 const newOnes: LocalLine[] = []
 importGroups.forEach(g => {
 g.items.forEach(it => {
 const k = `${g.date}|${it.product_id || ''}`
 if (existing.has(k)) return
 existing.add(k)
 newOnes.push({
 tempId: newTempId(),
 line_date: g.date,
 product_id: it.product_id,
 product_name: it.product_name,
 color: it.color,
 quantity: it.quantity,
 unit_price: it.unit_price,
 })
 })
 })
 if (newOnes.length === 0) { alert('새로 추가할 라인이 없어요.'); return }
 setLines(prev => [...prev, ...newOnes])
 setImportedDates(new Set(importGroups.map(g => g.date)))
 setDirty(true)
 }

 const subtotal = lines.reduce((s, l) => s + (Number(l.quantity || 0) * Number(l.unit_price || 0)), 0)
 const vat = Math.round(subtotal * 0.1)
 const total = subtotal + vat

 /* ───── 저장 (명시적 클릭만 DB 반영) ───── */
 async function handleSave(closeAfter: boolean = true) {
 if (!form.vendor_id) { setError('거래처를 선택해주세요.'); return }
 setSaving(true)
 setError(null)

 const headerPayload = {
 vendor_id: form.vendor_id,
 issue_date: form.issue_date || todayKR(),
 supplier_business_number: form.supplier_business_number || '',
 supplier_name: form.supplier_name || '',
 supplier_ceo: form.supplier_ceo || '',
 supplier_address: form.supplier_address || '',
 bank_info: form.bank_info || '',
 subtotal, vat, total,
 // 견적서 연결 + 선납액 + 입금 상태
 quotation_id: form.quotation_id || null,
 deposit_amount: Number(form.deposit_amount || 0),
 paid_at: form.paid_at || null,
 notes: form.notes?.trim() || null,
 }

 let invoiceId: string
 if (editing) {
 const { error } = await supabase.from('invoices').update(headerPayload).eq('id', editing.id)
 if (error) { setSaving(false); setError(error.message); return }
 invoiceId = editing.id
 } else {
 const { data, error } = await supabase.from('invoices').insert(headerPayload).select().single()
 if (error) { setSaving(false); setError(error.message); return }
 invoiceId = data.id
 }

 // 라인 동기화
 const currentIds = new Set(lines.filter(l => l.persistedId).map(l => l.persistedId!))
 const toDelete = Array.from(originalIds).filter(id => !currentIds.has(id))
 if (toDelete.length > 0) {
 await supabase.from('invoice_items').delete().in('id', toDelete)
 }

 for (let i = 0; i < lines.length; i++) {
 const l = lines[i]
 const payload = {
 invoice_id: invoiceId,
 line_date: l.line_date || null,
 product_id: l.product_id,
 product_name: l.product_name || null,
 color: l.color || null,
 size: l.size || null,
 sizes: (l as any).sizes || null,
 quantity: Number(l.quantity || 0),
 unit_price: Number(l.unit_price || 0),
 sort_order: i,
 }
 if (l.persistedId) {
 await supabase.from('invoice_items').update(payload).eq('id', l.persistedId)
 } else {
 await supabase.from('invoice_items').insert(payload)
 }
 }

 setSaving(false)
 setDirty(false)
 if (closeAfter) onSaved()
 else {
 // 저장 후에도 드로어 유지 (출력 등을 위해)
 // editing이 없었던 경우 새로 저장된 거니까 알려주기만
 }
 }

 function handleClose() {
 if (dirty && !confirm('저장하지 않은 변경 사항이 있어요. 정말 닫을까요?')) return
 onClose()
 }

 return (
 <Drawer
 open={open}
 onClose={handleClose}
 title={editing ? '계산서 편집' : '새 계산서'}
 width="xl"
 footer={
 <>
 {dirty && <span className="text-[11px] text-amber-600 mr-auto">● 저장 안 된 변경 사항 있음</span>}
 {!dirty && editing && <span className="text-[11px] text-emerald-600 mr-auto">✓ 저장됨</span>}
 {editing && (
 <Button variant="secondary" onClick={() => navigate(`/invoices/${editing.id}/print`)}>🖨️ 출력</Button>
 )}
 <Button variant="secondary" onClick={handleClose}>닫기</Button>
 <Button onClick={() => handleSave(true)} disabled={saving || !dirty}>
 {saving ? '저장 중...' : '저장'}
 </Button>
 </>
 }
 >
 {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">{error}</div>}

 {/* 헤더 */}
 <div className="space-y-4 pb-5 border-b border-zinc-100 mb-5">
 <div className="grid grid-cols-2 gap-3">
 <div>
 <Label required>받는 거래처</Label>
 <Select value={form.vendor_id || ''} onChange={e => update('vendor_id', e.target.value)}>
 {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name ? `${v.name} (${v.company_name})` : v.name}</option>)}
 </Select>
 </div>
 <div>
 <Label required>발행일</Label>
 <Input type="date" value={form.issue_date || ''} onChange={e => update('issue_date', e.target.value)} />
 </div>
 </div>
 <div>
 <Label>메모</Label>
 <Textarea rows={2} value={form.notes || ''} onChange={e => update('notes', e.target.value)} />
 </div>
 </div>

 {/* 입고에서 가져오기 */}
 {form.vendor_id && (
 <div className="mb-6 bg-blue-50/40 border border-blue-200 rounded-2xl p-4">
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <span className="text-lg">📥</span>
 <h3 className="text-[14px] font-semibold text-zinc-900">입고에서 가져오기</h3>
 <Badge color="blue">{importGroups.length}개 날짜</Badge>
 </div>
 {importGroups.length > 0 && (
 <Button size="sm" variant="secondary" onClick={importAll}>전체 가져오기</Button>
 )}
 </div>
 {importGroups.length === 0 ? (
 <p className="text-[12px] text-zinc-500 text-center py-4">이 거래처의 입고 내역이 아직 없어요.</p>
 ) : (
 <div className="space-y-1.5 max-h-60 overflow-y-auto">
 {importGroups.map(g => {
 const imported = importedDates.has(g.date)
 const missingPrice = g.items.filter(it => !it.unit_price || it.unit_price === 0).length
 return (
 <div key={g.date} className={`flex items-center gap-3 px-3 py-2 bg-white rounded-lg border ${imported ? 'border-emerald-200 bg-emerald-50/40' : missingPrice > 0 ? 'border-amber-300 bg-amber-50/40' : 'border-zinc-200 hover:border-zinc-300'}`}>
 <div className="flex-1 min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="text-[13px] font-semibold text-zinc-900 tabular-nums">{g.date}</span>
 <span className="text-[11px] text-zinc-500">상품 {g.items.length}개 · 총 <span className="font-semibold text-zinc-700 tabular-nums">{g.totalQty.toLocaleString()}</span>장</span>
 {imported && <Badge color="green">가져옴</Badge>}
 {missingPrice > 0 && (
   <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded" title="상품에 판매가가 없거나 매칭 실패">⚠ 단가 미매칭 {missingPrice}건</span>
 )}
 </div>
 </div>
 <Button size="sm" onClick={() => importDate(g)}>
 {imported ? '다시 가져오기' : '＋ 가져오기'}
 </Button>
 </div>
 )
 })}
 </div>
 )}
 </div>
 )}

 {/* 라인 (로컬 상태) */}
 <div>
 <div className="flex items-center justify-between mb-3">
 <div className="flex items-center gap-2">
 <h3 className="text-[14px] font-semibold text-zinc-900">거래 라인</h3>
 {lines.length > 0 && <span className="text-[11px] text-zinc-500">· {lines.length}건</span>}
 </div>
 <Button size="sm" onClick={addEmptyLine}>＋ 빈 라인 추가</Button>
 </div>

 {lines.length === 0 ? (
 <Empty
 icon="📋"
 title="라인이 없습니다"
 description="위 '입고에서 가져오기'에서 날짜를 클릭하거나 '+ 빈 라인 추가'로 직접 입력하세요."
 />
 ) : (
 <>
 <div className="border border-zinc-200 rounded-xl overflow-hidden">
 <table className="w-full text-[12px]">
 <thead className="bg-zinc-50">
 <tr>
 <th className="px-2 py-2 text-left w-28">날짜</th>
 <th className="px-2 py-2 text-left">상품</th>
 <th className="px-2 py-2 text-left w-20">컬러</th>
 <th className="px-2 py-2 text-left w-16">사이즈</th>
 <th className="px-2 py-2 text-right w-20">수량</th>
 <th className="px-2 py-2 text-right w-24">단가</th>
 <th className="px-2 py-2 text-right w-28">금액</th>
 <th className="w-8"></th>
 </tr>
 </thead>
 <tbody>
 {lines.map(l => {
 const isReturn = Number(l.quantity) < 0
 const amount = Number(l.quantity || 0) * Number(l.unit_price || 0)
 const priceMissing = !Number(l.unit_price || 0)
 return (
 <tr key={l.tempId} className={`border-t border-zinc-100 ${isReturn ? 'bg-rose-50/30' : priceMissing ? 'bg-amber-50/40' : ''}`}>
 <td className="px-2 py-1">
 <Input type="date" value={l.line_date || ''} onChange={e => updateLine(l.tempId, { line_date: e.target.value })} className="text-[11px] px-1.5 py-1" />
 </td>
 <td className="px-2 py-1">
 <Select value={l.product_id || ''} onChange={e => pickProductForLine(l, e.target.value)} className="text-[11px] px-1.5 py-1">
 <option value="">— 직접입력 —</option>
 {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
 </Select>
 {!l.product_id && (
 <Input value={l.product_name} onChange={e => updateLine(l.tempId, { product_name: e.target.value })} className="text-[11px] px-1.5 py-1 mt-1" />
 )}
 </td>
 <td className="px-2 py-1">
 <Input value={l.color || ''} onChange={e => updateLine(l.tempId, { color: e.target.value })} className="text-[11px] px-1.5 py-1" />
 </td>
 <td className="px-2 py-1">
 {l.sizes && Object.keys(l.sizes).length > 0 ? (
   // 사이즈 분포 표시 (입고에서 자동 발행된 경우)
   <div className="text-[10px] px-1 py-1 bg-blue-50 border border-blue-100 rounded text-center" title="사이즈 분포 (수량 변경하려면 입고에서 수정)">
     {Object.entries(l.sizes)
       .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
       .map(([sz, n]) => `${sz}:${n}`).join(' · ')}
   </div>
 ) : (
   <Input value={l.size || ''} onChange={e => updateLine(l.tempId, { size: e.target.value })} className="text-[11px] px-1.5 py-1 text-center" placeholder="—" />
 )}
 </td>
 <td className="px-2 py-1">
 <Input type="number" value={l.quantity} onChange={e => updateLine(l.tempId, { quantity: Number(e.target.value) })} className="text-[11px] px-1.5 py-1 text-right tabular-nums" />
 </td>
 <td className="px-2 py-1">
 <Input type="number" value={l.unit_price} onChange={e => updateLine(l.tempId, { unit_price: Number(e.target.value) })} className={`text-[11px] px-1.5 py-1 text-right tabular-nums ${priceMissing ? 'border-amber-400 bg-amber-50 text-amber-900' : ''}`} title={priceMissing ? '⚠ 판매가 미설정 — 상품 페이지에서 판매가를 입력해주세요' : ''} />
 {priceMissing && <p className="text-[9px] text-amber-700 mt-0.5 text-right">⚠ 단가 0</p>}
 </td>
 <td className={`px-2 py-1 text-right font-medium tabular-nums ${isReturn ? 'text-rose-700' : ''}`}>
 ₩{amount.toLocaleString()}
 </td>
 <td className="text-center">
 <button onClick={() => removeLine(l.tempId)} className="text-rose-500 hover:text-rose-700 text-lg">×</button>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>

 <div className="mt-3 bg-zinc-50 rounded-xl p-4 space-y-1.5 text-[13px]">
 <div className="flex justify-between"><span className="text-zinc-500">공급가액</span><span className="tabular-nums">₩{subtotal.toLocaleString()}</span></div>
 <div className="flex justify-between"><span className="text-zinc-500">부가세 (10%)</span><span className="tabular-nums">₩{vat.toLocaleString()}</span></div>
 <div className="flex justify-between pt-1.5 border-t border-zinc-200 font-bold text-[15px]">
 <span>총 합계</span><span className="tabular-nums">₩{total.toLocaleString()}</span>
 </div>
 </div>

 {/* 출처 링크 — 이 계산서가 어디서 발행됐는지 */}
 {(form.quotation_id || form.incoming_id) && (
   <div className="mt-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
     <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700 mb-1.5">🔗 발행 출처</p>
     <div className="flex items-center gap-2 flex-wrap">
       {form.quotation_id && (
         <button onClick={() => navigate('/quotations')} className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md bg-white border border-blue-300 text-blue-700 hover:bg-blue-100">
           📑 견적서에서 발행 →
         </button>
       )}
       {form.incoming_id && (
         <button onClick={() => navigate('/incoming')} className="inline-flex items-center gap-1 text-[12px] px-2.5 py-1 rounded-md bg-white border border-blue-300 text-blue-700 hover:bg-blue-100">
           📦 입고에서 발행 →
         </button>
       )}
     </div>
   </div>
 )}

 {/* 입금 상태 — 입금 받았는지 체크 (미수금 추적용) */}
 <div className="mt-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3">
   <label className="flex items-center gap-2 cursor-pointer">
     <input
       type="checkbox"
       checked={!!form.paid_at}
       onChange={e => update('paid_at', e.target.checked ? new Date().toISOString() : null)}
       className="rounded"
     />
     <span className="text-[12px] font-semibold text-emerald-800">💵 입금 받음</span>
     {form.paid_at && (
       <span className="text-[11px] text-emerald-700 ml-1">
         · {new Date(form.paid_at).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })}
       </span>
     )}
   </label>
   {!form.paid_at && (
     <p className="text-[11px] text-emerald-700 mt-1 ml-6">체크하면 미수금 알림에서 제외됩니다.</p>
   )}
 </div>

 {/* 선납액 (계약금) - 견적서에서 발행했을 때 자동 채워짐, 수정 가능 */}
 <div className="mt-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
 <div className="flex items-center justify-between mb-2">
 <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700">💰 선납 받은 계약금</p>
 {form.quotation_id && <Badge color="amber">견적서 연결됨</Badge>}
 </div>
 <div className="flex items-center gap-2">
 <Input
 type="number"
 value={Number(form.deposit_amount || 0)}
 onChange={e => update('deposit_amount', Number(e.target.value || 0))}
 placeholder="0"
 />
 <span className="text-[12px] text-zinc-500 whitespace-nowrap">원</span>
 </div>
 <div className="mt-2 pt-2 border-t border-amber-200 flex justify-between text-[12px]">
 <span className="text-zinc-600">청구 잔금 (총 합계 − 선납)</span>
 <span className={`tabular-nums font-bold ${(total - Number(form.deposit_amount || 0)) < 0 ? 'text-rose-600' : 'text-zinc-900'}`}>
 ₩{(total - Number(form.deposit_amount || 0)).toLocaleString()}
 {(total - Number(form.deposit_amount || 0)) < 0 && ' (환불)'}
 </span>
 </div>
 </div>
 <p className="text-[11px] text-zinc-400 mt-2">💡 음수 수량 = 반품(빨간색 표시). 견적서에서 받은 계약금이 있으면 위 칸에 입력하세요. 매출은 총 합계로만 잡힙니다.</p>
 </>
 )}
 </div>
 </Drawer>
 )
}
