import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Vendor, Product, Quotation, QuotationItem, QuotationStatus } from '@/lib/types'
import { Button, Input, Select, Label, PageHeader, Drawer, Empty, Badge, Textarea, Checkbox, BulkBar } from '@/components/ui'
import { exportSheet, rowsToSheet } from '@/lib/exportXlsx'
import { useBulkSelect } from '@/hooks/useBulkSelect'

const STATUS_LABEL: Record<QuotationStatus, string> = {
 draft: '작성중',
 sent: '발송',
 accepted: '수락',
 rejected: '거절',
 converted: '계산서 발행',
}
const STATUS_COLOR: Record<QuotationStatus, 'zinc' | 'blue' | 'green' | 'rose' | 'violet'> = {
 draft: 'zinc',
 sent: 'blue',
 accepted: 'green',
 rejected: 'rose',
 converted: 'violet',
}

export default function QuotationsPage() {
 const navigate = useNavigate()
 const [vendors, setVendors] = useState<Vendor[]>([])
 const [list, setList] = useState<Quotation[]>([])
 const [issuedMap, setIssuedMap] = useState<Map<string, string>>(new Map()) // quotation_id -> invoice_id (이미 발행된 견적서)
 const [loading, setLoading] = useState(true)
 const [drawerOpen, setDrawerOpen] = useState(false)
 const [editing, setEditing] = useState<Quotation | null>(null)
 const [statusFilter, setStatusFilter] = useState<string>('all')
 const thisYearMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
 const [monthFilter, setMonthFilter] = useState<string>(thisYearMonth)
 const [search, setSearch] = useState('')
 const bulk = useBulkSelect()

 async function load() {
 setLoading(true)
 const [{ data: vData }, { data: qData }, { data: invs }] = await Promise.all([
 supabase.from('vendors').select('*').eq('vendor_type', 'customer').order('name'),
 supabase.from('quotations').select('*').order('issue_date', { ascending: false }),
 supabase.from('invoices').select('id, quotation_id').not('quotation_id', 'is', null),
 ])
 setVendors(vData ?? [])
 setList(qData ?? [])
 const m = new Map<string, string>()
 ;(invs ?? []).forEach((iv: any) => { if (iv.quotation_id) m.set(iv.quotation_id, iv.id) })
 setIssuedMap(m)
 setLoading(false)
 }

 /* 견적서 → 계산서 발행: 거래처/단가/공급자정보만 복사한 빈 계산서 생성.
    수량은 실제 입고와 다를 수 있으므로 비워두고, 사용자가 [입고에서 가져오기] 또는 직접 입력. */
 async function convertToInvoice(q: Quotation) {
   if (issuedMap.has(q.id)) {
     if (!confirm('이 견적서로 이미 발행된 계산서가 있어요. 새로 또 발행할까요?')) return
   }
   // 견적 라인을 가져와서 단가만 살리고 수량은 빈 계산서 생성
   const { data: qItems } = await supabase.from('quotation_items').select('*').eq('quotation_id', q.id).order('sort_order')

   const headerPayload = {
     vendor_id: q.vendor_id,
     issue_date: new Date().toISOString().slice(0, 10),
     supplier_business_number: q.supplier_business_number || '',
     supplier_name: q.supplier_name || '',
     supplier_ceo: q.supplier_ceo || '',
     supplier_address: q.supplier_address || '',
     bank_info: q.bank_info || '',
     subtotal: 0, vat: 0, total: 0, // 라인 추가 후 다시 계산
     quotation_id: q.id,
     deposit_amount: q.deposit_received ? Number(q.deposit_amount || 0) : 0,
     notes: `견적서 ${q.issue_date}에서 발행. 실제 수량을 입고내역서에서 가져오거나 직접 입력하세요.`,
   }
   const { data: created, error } = await supabase.from('invoices').insert(headerPayload).select().single()
   if (error) { alert('계산서 생성 실패: ' + error.message); return }

   // 견적 품목을 계산서 라인으로 복사 (수량은 그대로 — 사용자가 실수량으로 수정)
   if (qItems && qItems.length > 0) {
     const itemPayload = qItems.map((qi: any, idx: number) => ({
       invoice_id: created.id,
       product_id: qi.product_id || null,
       product_name: qi.product_name || null,
       color: qi.color || null,
       quantity: Number(qi.quantity || 0),
       unit_price: Number(qi.unit_price || 0),
       sort_order: idx,
     }))
     await supabase.from('invoice_items').insert(itemPayload)
     // 합계 재계산해서 invoice 업데이트
     const subtotal = itemPayload.reduce((s, x) => s + x.quantity * x.unit_price, 0)
     const vat = Math.round(subtotal * 0.1)
     await supabase.from('invoices').update({ subtotal, vat, total: subtotal + vat }).eq('id', created.id)
   }

   // 견적서 상태도 'converted'로
   await supabase.from('quotations').update({ status: 'converted' }).eq('id', q.id)

   if (confirm('계산서가 발행됐어요! 바로 계산서 편집 화면으로 이동할까요?\n(수량을 실제 출고량으로 수정하세요)')) {
     navigate(`/invoices?edit=${created.id}`)
   } else {
     load()
   }
 }

 useEffect(() => { load() }, [])

 function vendorName(id: string) {
 return vendors.find(v => v.id === id)?.name || '—'
 }

 async function handleDelete(q: Quotation) {
 if (!confirm('이 견적서를 삭제할까요?')) return
 const { error } = await supabase.from('quotations').delete().eq('id', q.id)
 if (error) return alert(error.message)
 load()
 }

 async function handleBulkDelete() {
   const ids = Array.from(bulk.selected)
   if (ids.length === 0) return
   if (!confirm(`선택한 ${ids.length}건의 견적서를 삭제할까요?\n(라인 항목까지 함께 삭제됩니다. 되돌릴 수 없어요.)`)) return
   const { error } = await supabase.from('quotations').delete().in('id', ids)
   if (error) return alert(error.message)
   bulk.clear()
   load()
 }

 async function changeStatus(q: Quotation, status: QuotationStatus) {
 await supabase.from('quotations').update({ status }).eq('id', q.id)
 load()
 }

 const allMonths = Array.from(new Set(list.map(q => q.issue_date?.slice(0, 7)).filter(Boolean))).sort((a, b) => (b! > a! ? 1 : -1)) as string[]
 const filtered = list.filter(q => {
   if (statusFilter !== 'all' && q.status !== statusFilter) return false
   if (monthFilter !== 'all' && !q.issue_date?.startsWith(monthFilter)) return false
   if (search.trim()) {
     const s = search.trim().toLowerCase()
     const vName = vendorName(q.vendor_id).toLowerCase()
     const notes = (q.notes || '').toLowerCase()
     if (!vName.includes(s) && !notes.includes(s) && !q.issue_date?.includes(s)) return false
   }
   return true
 })

 // 통계
 const totalAmount = filtered.reduce((s, q) => s + Number(q.total || 0), 0)
 const acceptedAmount = filtered.filter(q => q.status === 'accepted' || q.status === 'converted').reduce((s, q) => s + Number(q.total || 0), 0)
 const depositPending = filtered.filter(q => q.status === 'accepted' && !q.deposit_received).reduce((s, q) => s + Number(q.deposit_amount || 0), 0)
 const depositReceived = filtered.filter(q => q.deposit_received).reduce((s, q) => s + Number(q.deposit_amount || 0), 0)

 return (
 <div>
 <PageHeader
 title="견적서"
 description="거래처에 발송할 견적서. 계약금(선납) 비율 설정 + 출력해서 보낼 수 있어요."
 action={<>
   <Button variant="secondary" onClick={() => {
     const data = rowsToSheet(filtered as any[], [
       { key: 'issue_date', label: '작성일' },
       { key: 'vendor_id', label: '거래처', format: (id: string) => vendors.find(v => v.id === id)?.name || '—' },
       { key: 'title', label: '견적 제목' },
       { key: 'subtotal', label: '공급가액' },
       { key: 'vat', label: '부가세' },
       { key: 'total', label: '총 합계' },
       { key: 'deposit_percent', label: '계약금 %' },
       { key: 'status', label: '상태' },
       { key: 'notes', label: '메모' },
     ])
     exportSheet(data, '견적서', '견적서')
   }} disabled={filtered.length === 0}>📥 엑셀 내보내기</Button>
   <Button onClick={() => { setEditing(null); setDrawerOpen(true) }} disabled={vendors.length === 0}>＋ 새 견적서</Button>
 </>}
 />

 <BulkBar count={bulk.count} onClear={bulk.clear} onDelete={handleBulkDelete} label="견적서" />

 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
 <StatCard
   label="총 견적 금액"
   value={`₩${totalAmount.toLocaleString()}`}
   hint={`${filtered.length}건`}
   onClick={() => { setStatusFilter('all'); setMonthFilter('all'); setSearch('') }}
 />
 <StatCard
   label="수락된 금액"
   value={`₩${acceptedAmount.toLocaleString()}`}
   hint="실제 계약 성사"
   onClick={() => { setStatusFilter('accepted'); setMonthFilter('all'); setSearch('') }}
 />
 <StatCard
   label="계약금 받을 것"
   value={`₩${depositPending.toLocaleString()}`}
   hint="수락됐지만 미수령"
   highlight="amber"
   onClick={() => { setStatusFilter('accepted'); setMonthFilter('all'); setSearch('') }}
 />
 <StatCard
   label="계약금 받음"
   value={`₩${depositReceived.toLocaleString()}`}
   hint="입금 확인됨"
   highlight="green"
   onClick={() => { setStatusFilter('accepted'); setMonthFilter('all'); setSearch('') }}
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
     checked={filtered.length > 0 && filtered.every(q => bulk.has(q.id))}
     indeterminate={filtered.some(q => bulk.has(q.id))}
     onChange={() => bulk.toggleAll(filtered.map(q => q.id))}
     ariaLabel="현재 필터 전체 선택"
   />
   <span className="text-[12px] text-zinc-600 select-none">전체 선택</span>
 </label>
 <div className="w-40">
 <Select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
 <option value="all">전체 기간</option>
 {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
 </Select>
 </div>
 <div className="w-40">
 <Select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
 <option value="all">모든 상태</option>
 <option value="draft">작성중</option>
 <option value="sent">발송</option>
 <option value="accepted">수락</option>
 <option value="rejected">거절</option>
 <option value="converted">계산서 발행</option>
 </Select>
 </div>
 <div className="flex-1 min-w-[180px]">
 <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="" />
 </div>
 <span className="text-[12px] text-zinc-500 ml-auto">{filtered.length}건</span>
 </div>

 {loading ? (
 <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
 ) : filtered.length === 0 ? (
 <Empty icon="📑" title="견적서가 없습니다" description="＋ 새 견적서 버튼으로 시작하세요." />
 ) : (
 <div>
 {(() => {
   // 월별 그룹화
   const grouped = filtered.reduce<Record<string, typeof filtered>>((acc, q) => {
     const k = q.issue_date?.slice(0, 7) || '미분류'
     if (!acc[k]) acc[k] = []
     acc[k].push(q)
     return acc
   }, {})
   const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
   return months.map(month => {
     const monthList = grouped[month]
     const monthTotal = monthList.reduce((s, q) => s + Number(q.total || 0), 0)
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
               <th className="pl-4 pr-2 py-2 w-10"></th>
               <th className="px-4 py-2 w-24">발행일</th>
               <th className="px-4 py-2">거래처</th>
               <th className="px-4 py-2">상태</th>
               <th className="px-4 py-2 text-right">견적 금액</th>
               <th className="px-4 py-2 text-right">계약금</th>
               <th className="px-4 py-2 text-right">관리</th>
             </tr>
           </thead>
           <tbody>
             {monthList.map(q => (
               <tr key={q.id} className={`border-t border-zinc-100 hover:bg-zinc-50/50 ${bulk.has(q.id) ? 'bg-zinc-50' : ''}`}>
                 <td className="pl-4 pr-2 py-2.5">
                   <Checkbox checked={bulk.has(q.id)} onChange={() => bulk.toggle(q.id)} ariaLabel={`${q.issue_date} 선택`} />
                 </td>
                 <td className="px-4 py-2.5 font-medium tabular-nums">
                   <button onClick={() => { setEditing(q); setDrawerOpen(true) }} className="hover:underline">
                     {q.issue_date.slice(5)}
                   </button>
                 </td>
                 <td className="px-4 py-2.5"><Badge color="green">{vendorName(q.vendor_id)}</Badge></td>
                 <td className="px-4 py-2.5">
                   <Select value={q.status} onChange={e => changeStatus(q, e.target.value as QuotationStatus)} className="text-[11px] py-0.5 w-28">
                     <option value="draft">작성중</option>
                     <option value="sent">발송</option>
                     <option value="accepted">수락</option>
                     <option value="rejected">거절</option>
                     <option value="converted">계산서 발행</option>
                   </Select>
                 </td>
                 <td className="px-4 py-2.5 text-right font-semibold tabular-nums">₩{Number(q.total).toLocaleString()}</td>
                 <td className="px-4 py-2.5 text-right tabular-nums">
                   {Number(q.deposit_rate) > 0 ? (
                     <div>
                       <div className="font-medium">₩{Number(q.deposit_amount).toLocaleString()}</div>
                       <div className="text-[10px] text-zinc-500">{q.deposit_rate}% {q.deposit_received ? '✓ 수령' : '미수령'}</div>
                     </div>
                   ) : <span className="text-zinc-300">—</span>}
                 </td>
                 <td className="px-4 py-2.5 text-right whitespace-nowrap">
                   {issuedMap.has(q.id) ? (
                     <Badge color="violet">📄 계산서 발행됨</Badge>
                   ) : (
                     <Button size="sm" variant="ghost" onClick={() => convertToInvoice(q)} title="이 견적서로 계산서 발행 (실수량은 입고에서 가져오거나 수정)" className="text-violet-600 hover:bg-violet-50">📄 계산서 발행</Button>
                   )}
                   <Button size="sm" variant="ghost" onClick={() => navigate(`/quotations/${q.id}/print`)} title="새 탭에서 인쇄">🖨️ 출력</Button>
                   <Button size="sm" variant="ghost" onClick={() => { setEditing(q); setDrawerOpen(true) }}>수정</Button>
                   <Button size="sm" variant="ghost" onClick={() => handleDelete(q)} className="text-rose-600 hover:bg-rose-50">삭제</Button>
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       </div>
     )
   })
 })()}
 </div>
 )}
 </div>
 )}

 <QuotationDrawer
 open={drawerOpen}
 onClose={() => setDrawerOpen(false)}
 editing={editing}
 vendors={vendors}
 onSaved={() => { setDrawerOpen(false); load() }}
 />
 </div>
 )
}

function StatCard({ label, value, hint, highlight = 'zinc', onClick }: {
 label: string; value: string; hint?: string; highlight?: 'zinc' | 'green' | 'amber' | 'rose'; onClick?: () => void
}) {
 const colors = { zinc: 'text-zinc-900', green: 'text-emerald-700', amber: 'text-amber-700', rose: 'text-rose-700' }
 const inner = (
 <div className={`bg-white border border-zinc-200 rounded-2xl p-4 text-left ${onClick ? 'hover:border-zinc-400 hover:bg-zinc-50/50 cursor-pointer transition-colors' : ''}`}>
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
 <p className={`text-[20px] font-bold mt-1 tabular-nums ${colors[highlight]}`}>{value}</p>
 {hint && <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center justify-between"><span>{hint}</span>{onClick && <span>→</span>}</p>}
 </div>
 )
 return onClick ? <button onClick={onClick} className="block w-full">{inner}</button> : inner
}

interface LocalItem {
 tempId: string
 persistedId?: string
 product_id: string | null
 product_name: string
 color: string | null
 size_info: string | null
 quantity: number
 unit_price: number
}
function newTempId() { return 'tmp_' + Math.random().toString(36).slice(2) }

function QuotationDrawer({ open, onClose, editing, vendors, onSaved }: {
 open: boolean; onClose: () => void; editing: Quotation | null; vendors: Vendor[]; onSaved: () => void
}) {
 const navigate = useNavigate()
 const [form, setForm] = useState<Partial<Quotation>>({})
 const [items, setItems] = useState<LocalItem[]>([])
 const [originalIds, setOriginalIds] = useState<Set<string>>(new Set())
 const [products, setProducts] = useState<Product[]>([])
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
 issue_date: new Date().toISOString().slice(0, 10),
 validity_days: 30,
 vendor_id: vendors[0]?.id,
 supplier_business_number: '216-21-18212',
 supplier_name: '써치(SEARCH)',
 supplier_ceo: '함기호',
 supplier_address: '서울시 동대문구 안암로 16길 4, 2층',
 bank_info: '함기호(써치) 국민은행 038737-04-002188',
 deposit_rate: 50,
 deposit_received: false,
 status: 'draft',
 })
 setItems([])
 setOriginalIds(new Set())
 if (vendors[0]) loadProducts(vendors[0].id)
 }
 setError(null)
 setDirty(false)
 }, [editing, open, vendors])

 async function loadExisting(q: Quotation) {
 const { data } = await supabase.from('quotation_items').select('*').eq('quotation_id', q.id).order('sort_order')
 const persisted: LocalItem[] = (data ?? []).map((it: QuotationItem) => ({
 tempId: newTempId(),
 persistedId: it.id,
 product_id: it.product_id,
 product_name: it.product_name || '',
 color: it.color,
 size_info: it.size_info,
 quantity: Number(it.quantity || 0),
 unit_price: Number(it.unit_price || 0),
 }))
 setItems(persisted)
 setOriginalIds(new Set(persisted.map(p => p.persistedId!).filter(Boolean)))
 loadProducts(q.vendor_id)
 }

 async function loadProducts(vendorId: string) {
 const { data } = await supabase.from('products').select('*').eq('vendor_id', vendorId).order('code')
 setProducts(data ?? [])
 }

 function update<K extends keyof Quotation>(k: K, v: Quotation[K]) {
 setForm(prev => ({ ...prev, [k]: v }))
 setDirty(true)
 if (k === 'vendor_id') loadProducts(v as string)
 }

 function addItem() {
 setItems(prev => [...prev, {
 tempId: newTempId(),
 product_id: null,
 product_name: '',
 color: '',
 size_info: '',
 quantity: 1,
 unit_price: 0,
 }])
 setDirty(true)
 }

 function updateItem(tempId: string, patch: Partial<LocalItem>) {
 setItems(prev => prev.map(i => i.tempId === tempId ? { ...i, ...patch } : i))
 setDirty(true)
 }

 function removeItem(tempId: string) {
 setItems(prev => prev.filter(i => i.tempId !== tempId))
 setDirty(true)
 }

 function pickProductForItem(item: LocalItem, productId: string) {
 const p = products.find(x => x.id === productId)
 if (!p) { updateItem(item.tempId, { product_id: null }); return }
 updateItem(item.tempId, {
 product_id: p.id,
 product_name: p.name,
 color: p.color,
 unit_price: p.selling_price,
 })
 }

 const subtotal = items.reduce((s, l) => s + (Number(l.quantity || 0) * Number(l.unit_price || 0)), 0)
 const vat = Math.round(subtotal * 0.1)
 const total = subtotal + vat
 const depositAmount = Math.round(total * Number(form.deposit_rate || 0) / 100)

 async function handleSave(closeAfter = true) {
 if (!form.vendor_id) { setError('거래처 선택'); return }
 setSaving(true)
 setError(null)

 const headerPayload = {
 vendor_id: form.vendor_id,
 issue_date: form.issue_date || new Date().toISOString().slice(0, 10),
 validity_days: Number(form.validity_days || 30),
 supplier_business_number: form.supplier_business_number || '',
 supplier_name: form.supplier_name || '',
 supplier_ceo: form.supplier_ceo || '',
 supplier_address: form.supplier_address || '',
 bank_info: form.bank_info || '',
 subtotal, vat, total,
 deposit_rate: Number(form.deposit_rate || 0),
 deposit_received: !!form.deposit_received,
 deposit_received_date: form.deposit_received_date || null,
 status: form.status || 'draft',
 notes: form.notes?.trim() || null,
 }

 let qId: string
 if (editing) {
 const { error } = await supabase.from('quotations').update(headerPayload).eq('id', editing.id)
 if (error) { setSaving(false); setError(error.message); return }
 qId = editing.id
 } else {
 const { data, error } = await supabase.from('quotations').insert(headerPayload).select().single()
 if (error) { setSaving(false); setError(error.message); return }
 qId = data.id
 }

 const currentIds = new Set(items.filter(i => i.persistedId).map(i => i.persistedId!))
 const toDelete = Array.from(originalIds).filter(id => !currentIds.has(id))
 if (toDelete.length > 0) {
 await supabase.from('quotation_items').delete().in('id', toDelete)
 }

 for (let i = 0; i < items.length; i++) {
 const l = items[i]
 const payload = {
 quotation_id: qId,
 product_id: l.product_id,
 product_name: l.product_name || null,
 color: l.color || null,
 size_info: l.size_info || null,
 quantity: Number(l.quantity || 0),
 unit_price: Number(l.unit_price || 0),
 sort_order: i,
 }
 if (l.persistedId) {
 await supabase.from('quotation_items').update(payload).eq('id', l.persistedId)
 } else {
 await supabase.from('quotation_items').insert(payload)
 }
 }

 setSaving(false)
 setDirty(false)
 if (closeAfter) onSaved()
 }

 function handleClose() {
 if (dirty && !confirm('저장하지 않은 변경 사항이 있어요. 정말 닫을까요?')) return
 onClose()
 }

 return (
 <Drawer
 open={open}
 onClose={handleClose}
 title={editing ? '견적서 편집' : '새 견적서'}
 width="xl"
 footer={
 <>
 {dirty && <span className="text-[11px] text-amber-600 mr-auto">● 저장 안 됨</span>}
 {!dirty && editing && <span className="text-[11px] text-emerald-600 mr-auto">✓ 저장됨</span>}
 {editing && (
 <Button variant="secondary" onClick={() => navigate(`/quotations/${editing.id}/print`)}>🖨️ 출력</Button>
 )}
 <Button variant="secondary" onClick={handleClose}>닫기</Button>
 <Button onClick={() => handleSave(true)} disabled={saving || !dirty}>
 {saving ? '저장 중...' : '저장'}
 </Button>
 </>
 }
 >
 {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">{error}</div>}

 <div className="space-y-4 pb-5 border-b border-zinc-100 mb-5">
 <div className="grid grid-cols-3 gap-3">
 <div>
 <Label required>거래처</Label>
 <Select value={form.vendor_id || ''} onChange={e => update('vendor_id', e.target.value)}>
 {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name ? `${v.name} (${v.company_name})` : v.name}</option>)}
 </Select>
 </div>
 <div>
 <Label required>발행일</Label>
 <Input type="date" value={form.issue_date || ''} onChange={e => update('issue_date', e.target.value)} />
 </div>
 <div>
 <Label>유효 기간 (일)</Label>
 <Input type="number" value={form.validity_days ?? 30} onChange={e => update('validity_days', Number(e.target.value))} />
 </div>
 </div>
 <div>
 <Label>메모</Label>
 <Textarea rows={2} value={form.notes || ''} onChange={e => update('notes', e.target.value)} />
 </div>
 </div>

 {/* 라인 */}
 <div className="mb-5">
 <div className="flex items-center justify-between mb-3">
 <h3 className="text-[14px] font-semibold text-zinc-900">견적 항목</h3>
 <Button size="sm" onClick={addItem}>＋ 항목 추가</Button>
 </div>

 {items.length === 0 ? (
 <Empty icon="📋" title="견적 항목이 없습니다" description="상품을 선택하면 판매가가 자동 입력됩니다." />
 ) : (
 <div className="border border-zinc-200 rounded-xl overflow-hidden">
 <table className="w-full text-[12px]">
 <thead className="bg-zinc-50">
 <tr>
 <th className="px-2 py-2 text-left">상품 / 품명</th>
 <th className="px-2 py-2 text-left w-20">컬러</th>
 <th className="px-2 py-2 text-left w-28">사이즈 정보</th>
 <th className="px-2 py-2 text-right w-16">수량</th>
 <th className="px-2 py-2 text-right w-24">단가</th>
 <th className="px-2 py-2 text-right w-28">금액</th>
 <th className="w-8"></th>
 </tr>
 </thead>
 <tbody>
 {items.map(it => {
 const amount = Number(it.quantity || 0) * Number(it.unit_price || 0)
 return (
 <tr key={it.tempId} className="border-t border-zinc-100">
 <td className="px-2 py-1">
 <Select value={it.product_id || ''} onChange={e => pickProductForItem(it, e.target.value)} className="text-[11px] px-1.5 py-1">
 <option value="">— 직접입력 —</option>
 {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
 </Select>
 {!it.product_id && (
 <Input value={it.product_name} onChange={e => updateItem(it.tempId, { product_name: e.target.value })} className="text-[11px] px-1.5 py-1 mt-1" />
 )}
 </td>
 <td className="px-2 py-1">
 <Input value={it.color || ''} onChange={e => updateItem(it.tempId, { color: e.target.value })} className="text-[11px] px-1.5 py-1" />
 </td>
 <td className="px-2 py-1">
 <Input value={it.size_info || ''} onChange={e => updateItem(it.tempId, { size_info: e.target.value })} className="text-[11px] px-1.5 py-1" />
 </td>
 <td className="px-2 py-1">
 <Input type="number" value={it.quantity} onChange={e => updateItem(it.tempId, { quantity: Number(e.target.value) })} className="text-[11px] px-1.5 py-1 text-right tabular-nums" />
 </td>
 <td className="px-2 py-1">
 <Input type="number" value={it.unit_price} onChange={e => updateItem(it.tempId, { unit_price: Number(e.target.value) })} className="text-[11px] px-1.5 py-1 text-right tabular-nums" />
 </td>
 <td className="px-2 py-1 text-right font-medium tabular-nums">₩{amount.toLocaleString()}</td>
 <td className="text-center">
 <button onClick={() => removeItem(it.tempId)} className="text-rose-500 hover:text-rose-700 text-lg">×</button>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 )}
 </div>

 {/* 금액 + 계약금 */}
 <div className="grid grid-cols-2 gap-4 mb-5">
 <div className="bg-zinc-50 rounded-xl p-4 space-y-1.5 text-[13px]">
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-2">견적 금액</p>
 <div className="flex justify-between"><span className="text-zinc-500">공급가액</span><span className="tabular-nums">₩{subtotal.toLocaleString()}</span></div>
 <div className="flex justify-between"><span className="text-zinc-500">부가세 (10%)</span><span className="tabular-nums">₩{vat.toLocaleString()}</span></div>
 <div className="flex justify-between pt-1.5 border-t border-zinc-200 font-bold text-[15px]">
 <span>총 합계</span><span className="tabular-nums">₩{total.toLocaleString()}</span>
 </div>
 </div>
 <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-2">
 <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 mb-1">💰 계약금 (선납)</p>
 <div className="flex items-center gap-2">
 <Input
 type="number"
 min="0"
 max="100"
 value={form.deposit_rate ?? 0}
 onChange={e => update('deposit_rate', Number(e.target.value))}
 className="w-20"
 />
 <span className="text-[13px] text-zinc-600">%</span>
 <span className="text-[12px] text-zinc-500 ml-auto">
 빠른 선택:
 <button type="button" onClick={() => update('deposit_rate', 30)} className="ml-1 px-1.5 py-0.5 bg-white rounded text-[11px] hover:bg-amber-100">30%</button>
 <button type="button" onClick={() => update('deposit_rate', 50)} className="ml-1 px-1.5 py-0.5 bg-white rounded text-[11px] hover:bg-amber-100">50%</button>
 <button type="button" onClick={() => update('deposit_rate', 70)} className="ml-1 px-1.5 py-0.5 bg-white rounded text-[11px] hover:bg-amber-100">70%</button>
 <button type="button" onClick={() => update('deposit_rate', 100)} className="ml-1 px-1.5 py-0.5 bg-white rounded text-[11px] hover:bg-amber-100">100%</button>
 </span>
 </div>
 <div className="flex justify-between text-[14px] font-bold pt-2 border-t border-amber-200">
 <span>계약금</span>
 <span className="tabular-nums">₩{depositAmount.toLocaleString()}</span>
 </div>
 <div className="flex justify-between text-[12px] text-zinc-600">
 <span>잔금</span>
 <span className="tabular-nums">₩{(total - depositAmount).toLocaleString()}</span>
 </div>
 <label className="flex items-center gap-2 pt-2 border-t border-amber-200 mt-2">
 <input
 type="checkbox"
 checked={!!form.deposit_received}
 onChange={e => update('deposit_received', e.target.checked)}
 className="w-4 h-4"
 />
 <span className="text-[12px]">계약금 수령 완료</span>
 {form.deposit_received && (
 <Input
 type="date"
 value={form.deposit_received_date || ''}
 onChange={e => update('deposit_received_date', e.target.value)}
 className="ml-auto w-36"
 />
 )}
 </label>
 </div>
 </div>

 <p className="text-[11px] text-zinc-400">💡 우측 하단 저장 버튼을 눌러야 DB에 반영됩니다. 저장 후 🖨️ 출력 버튼으로 인쇄/PDF.</p>
 </Drawer>
 )
}
