import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor, Product, Incoming, IncomingItem } from '@/lib/types'
import { Button, Input, Select, Label, PageHeader, Drawer, Empty, Badge, Textarea, Checkbox, BulkBar } from '@/components/ui'
import { exportMultiSheet, rowsToSheet } from '@/lib/exportXlsx'
import { useBulkSelect } from '@/hooks/useBulkSelect'

/* ───── 입고내역서별 집계 ───── */
interface IncomingStats {
 totalQuantity: number
 cartons: number
 productCount: number
}

export default function IncomingPage() {
 const [vendors, setVendors] = useState<Vendor[]>([])
 const [list, setList] = useState<Incoming[]>([])
 const [statsMap, setStatsMap] = useState<Map<string, IncomingStats>>(new Map())
 const [loading, setLoading] = useState(true)
 const [vendorFilter, setVendorFilter] = useState<string>('all')
 const [drawerOpen, setDrawerOpen] = useState(false)
 const [editing, setEditing] = useState<Incoming | null>(null)
 const bulk = useBulkSelect()

 async function load() {
 setLoading(true)
 const [{ data: vData }, { data: iData }] = await Promise.all([
 supabase.from('vendors').select('*').eq('vendor_type', 'customer').order('name'),
 supabase.from('incoming').select('*').order('created_at', { ascending: false }),
 ])
 setVendors(vData ?? [])
 setList(iData ?? [])

 if (iData && iData.length > 0) {
 const ids = iData.map(i => i.id)
 const { data: items } = await supabase
 .from('incoming_items')
 .select('incoming_id, total_quantity, product_id')
 .in('incoming_id', ids)

 const map = new Map<string, IncomingStats & { productSet: Set<string> }>()
 ;(items ?? []).forEach(it => {
 if (!map.has(it.incoming_id)) {
 map.set(it.incoming_id, { totalQuantity: 0, cartons: 0, productCount: 0, productSet: new Set() })
 }
 const s = map.get(it.incoming_id)!
 s.totalQuantity += Number(it.total_quantity || 0)
 s.cartons += 1
 if (it.product_id) s.productSet.add(it.product_id)
 })
 const cleanMap = new Map<string, IncomingStats>()
 map.forEach((v, k) => cleanMap.set(k, {
 totalQuantity: v.totalQuantity,
 cartons: v.cartons,
 productCount: v.productSet.size,
 }))
 setStatsMap(cleanMap)
 } else {
 setStatsMap(new Map())
 }

 setLoading(false)
 }

 useEffect(() => { load() }, [])

 async function handleDelete(i: Incoming) {
 if (!confirm('이 입고내역서 전체를 삭제할까요? (하위 입고 라인도 모두 삭제됨)')) return
 const { error } = await supabase.from('incoming').delete().eq('id', i.id)
 if (error) return alert('삭제 실패: ' + error.message)
 load()
 }

 async function handleBulkDelete() {
   const ids = Array.from(bulk.selected)
   if (ids.length === 0) return
   if (!confirm(`선택한 ${ids.length}건의 입고내역서를 삭제할까요?\n(하위 입고 라인도 모두 삭제됩니다. 되돌릴 수 없어요.)`)) return
   const { error } = await supabase.from('incoming').delete().in('id', ids)
   if (error) return alert('삭제 실패: ' + error.message)
   bulk.clear()
   load()
 }

 function vendorName(id: string) {
 return vendors.find(v => v.id === id)?.name || '—'
 }

 const filtered = list.filter(i => vendorFilter === 'all' || i.vendor_id === vendorFilter)
 const totalQty = filtered.reduce((s, i) => s + (statsMap.get(i.id)?.totalQuantity || 0), 0)
 const totalCartons = filtered.reduce((s, i) => s + (statsMap.get(i.id)?.cartons || 0), 0)

 const now = new Date()
 const thisMonth = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`
 const thisMonthList = filtered.filter(i => i.period === thisMonth)
 const thisMonthQty = thisMonthList.reduce((s, i) => s + (statsMap.get(i.id)?.totalQuantity || 0), 0)

 return (
 <div>
 <PageHeader
 title="입고내역서"
 description="거래처별 입고 내역(박스 단위)을 관리합니다."
 action={<>
   <Button variant="secondary" onClick={async () => {
     if (filtered.length === 0) return alert('내보낼 입고내역이 없습니다.')
     const ids = filtered.map(i => i.id)
     const { data: itms } = await supabase.from('incoming_items').select('*').in('incoming_id', ids)
     const headerSheet = rowsToSheet(filtered as any[], [
       { key: 'issue_date', label: '입고일' },
       { key: 'vendor_id', label: '거래처', format: (id: string) => vendors.find(v => v.id === id)?.name || '—' },
       { key: 'id', label: '총 박스수', format: (id: string) => statsMap.get(id)?.boxCount || 0 },
       { key: 'id', label: '총 수량', format: (id: string) => statsMap.get(id)?.totalQuantity || 0 },
       { key: 'notes', label: '메모' },
     ])
     const itemRows: any[][] = [['입고일','거래처','상품','컬러','사이즈','박스번호','수량']]
     filtered.forEach(inc => {
       const vendor = vendors.find(v => v.id === inc.vendor_id)?.name || '—'
       const myItems = (itms || []).filter((it: any) => it.incoming_id === inc.id)
       myItems.forEach((it: any) => {
         itemRows.push([inc.issue_date, vendor, it.product_name, it.color, it.size, it.box_number, it.quantity])
       })
     })
     exportMultiSheet([
       { name: '입고내역_요약', rows: headerSheet },
       { name: '입고내역_상세', rows: itemRows },
     ], '입고내역서')
   }} disabled={filtered.length === 0}>📥 엑셀 내보내기</Button>
   <Button onClick={() => { setEditing(null); setDrawerOpen(true) }} disabled={vendors.length === 0}>＋ 새 입고내역서</Button>
 </>}
 />

 <BulkBar count={bulk.count} onClear={bulk.clear} onDelete={handleBulkDelete} label="입고내역서" />

 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
 <StatCard label="이번 달 입고" value={`${thisMonthQty.toLocaleString()}장`} hint={`${thisMonth} · ${thisMonthList.length}건`} onClick={() => setVendorFilter('all')} />
 <StatCard label="전체 입고 수량" value={`${totalQty.toLocaleString()}장`} hint={`${filtered.length}건의 입고내역서`} onClick={() => setVendorFilter('all')} />
 <StatCard label="총 박스 수" value={`${totalCartons.toLocaleString()}개`} hint="C/T 합계" />
 <StatCard
 label="등록 거래처"
 value={`${vendors.length}개`}
 hint={vendorFilter === 'all' ? '전체' : vendorName(vendorFilter)}
 onClick={() => setVendorFilter('all')}
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
 <div className="w-56">
 <Select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
 <option value="all">모든 거래처</option>
 {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
 </Select>
 </div>
 <span className="text-[12px] text-zinc-500 ml-auto">
 {filtered.length}건 · 총 <span className="font-semibold text-zinc-700 tabular-nums">{totalQty.toLocaleString()}</span>장
 </span>
 </div>

 {loading ? (
 <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
 ) : filtered.length === 0 ? (
 <Empty icon="📦" title="등록된 입고내역서가 없어요" description="＋ 새 입고내역서 버튼으로 시작하세요." />
 ) : (
 <table className="w-full text-[13px]">
 <thead>
 <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
 <th className="pl-4 pr-2 py-3 w-10">
   <Checkbox
     checked={filtered.length > 0 && filtered.every(i => bulk.has(i.id))}
     indeterminate={filtered.some(i => bulk.has(i.id))}
     onChange={() => bulk.toggleAll(filtered.map(i => i.id))}
     ariaLabel="전체 선택"
   />
 </th>
 <th className="px-4 py-3">기간</th>
 <th className="px-4 py-3">거래처</th>
 <th className="px-4 py-3 text-right">총 수량</th>
 <th className="px-4 py-3 text-right">박스</th>
 <th className="px-4 py-3 text-right">상품</th>
 <th className="px-4 py-3">브랜드</th>
 <th className="px-4 py-3 text-right">관리</th>
 </tr>
 </thead>
 <tbody>
 {filtered.map(i => {
 const stats = statsMap.get(i.id)
 return (
 <tr key={i.id} className={`border-t border-zinc-100 hover:bg-zinc-50/50 ${bulk.has(i.id) ? 'bg-zinc-50' : ''}`}>
 <td className="pl-4 pr-2 py-3">
   <Checkbox checked={bulk.has(i.id)} onChange={() => bulk.toggle(i.id)} ariaLabel={`${i.period || '입고'} 선택`} />
 </td>
 <td className="px-4 py-3 font-medium text-zinc-900">
 <button onClick={() => { setEditing(i); setDrawerOpen(true) }} className="hover:underline">
 {i.period || '—'}
 </button>
 </td>
 <td className="px-4 py-3"><Badge color="green">{vendorName(i.vendor_id)}</Badge></td>
 <td className="px-4 py-3 text-right font-semibold tabular-nums">
 {stats ? `${stats.totalQuantity.toLocaleString()}장` : '—'}
 </td>
 <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{stats?.cartons || 0}</td>
 <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{stats?.productCount || 0}</td>
 <td className="px-4 py-3 text-zinc-600">{i.brand || '—'}</td>
 <td className="px-4 py-3 text-right">
 <Button size="sm" variant="ghost" onClick={() => { setEditing(i); setDrawerOpen(true) }}>수정</Button>
 <Button size="sm" variant="ghost" onClick={() => handleDelete(i)} className="text-rose-600 hover:bg-rose-50">삭제</Button>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 )}
 </div>
 )}

 <IncomingDrawer
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

/* ───── 로컬 박스 (저장 전 메모리 상태) ───── */
interface LocalCarton {
 tempId: string
 persistedId?: string
 product_id: string | null
 product_code: string | null
 product_name: string | null
 sizes: Record<string, number>
 total_quantity: number
 carton_no: number
}

function newTempId() { return 'tmp_' + Math.random().toString(36).slice(2) }

/* ───── 입고내역서 헤더 + 라인 편집 ───── */
function IncomingDrawer({ open, onClose, editing, vendors, onSaved }: {
 open: boolean; onClose: () => void; editing: Incoming | null; vendors: Vendor[]; onSaved: () => void
}) {
 const [form, setForm] = useState<Partial<Incoming>>({})
 const [cartons, setCartons] = useState<LocalCarton[]>([])
 const [originalIds, setOriginalIds] = useState<Set<string>>(new Set())
 const [products, setProducts] = useState<Product[]>([])
 const [saving, setSaving] = useState(false)
 const [error, setError] = useState<string | null>(null)
 const [view, setView] = useState<'cartons' | 'summary'>('cartons')
 const [dirty, setDirty] = useState(false)

 useEffect(() => {
 if (!open) return
 if (editing) {
 setForm(editing)
 loadExisting(editing)
 } else {
 setForm({ producer: 'AW', vendor_id: vendors[0]?.id, period: defaultPeriod() })
 setCartons([])
 setOriginalIds(new Set())
 if (vendors[0]) loadProducts(vendors[0].id)
 }
 setError(null)
 setView('cartons')
 setDirty(false)
 }, [editing, open, vendors])

 async function loadExisting(inc: Incoming) {
 const { data } = await supabase.from('incoming_items').select('*').eq('incoming_id', inc.id).order('carton_no').order('created_at')
 const local: LocalCarton[] = (data ?? []).map(it => ({
 tempId: newTempId(),
 persistedId: it.id,
 product_id: it.product_id,
 product_code: it.product_code,
 product_name: it.product_name,
 sizes: it.sizes || {},
 total_quantity: Number(it.total_quantity || 0),
 carton_no: it.carton_no || 0,
 }))
 setCartons(local)
 setOriginalIds(new Set(local.map(c => c.persistedId!).filter(Boolean)))
 loadProducts(inc.vendor_id)
 }

 async function loadProducts(vendorId: string) {
 const { data } = await supabase.from('products').select('*').eq('vendor_id', vendorId).order('code')
 setProducts(data ?? [])
 }

 function update<K extends keyof Incoming>(k: K, v: Incoming[K]) {
 setForm(prev => ({ ...prev, [k]: v }))
 setDirty(true)
 if (k === 'vendor_id') loadProducts(v as string)
 }

 const currentVendor = vendors.find(v => v.id === form.vendor_id)
 const sizeKeys: string[] = currentVendor?.size_system && currentVendor.size_system.length > 0
 ? currentVendor.size_system
 : []

 function addCarton() {
 if (sizeKeys.length === 0) {
 alert('이 거래처의 사이즈 체계를 먼저 등록해주세요.')
 return
 }
 const sizes: Record<string, number> = {}
 sizeKeys.forEach(s => sizes[s] = 0)
 const carton_no = (Math.max(0, ...cartons.map(c => c.carton_no || 0)) || 0) + 1
 setCartons(prev => [...prev, {
 tempId: newTempId(),
 product_id: products[0]?.id || null,
 product_code: products[0]?.code || null,
 product_name: products[0]?.name || null,
 sizes,
 total_quantity: 0,
 carton_no,
 }])
 setDirty(true)
 }

 function updateCarton(tempId: string, patch: Partial<LocalCarton>) {
 setCartons(prev => prev.map(c => c.tempId === tempId ? { ...c, ...patch } : c))
 setDirty(true)
 }

 function removeCarton(tempId: string) {
 if (!confirm('이 박스를 삭제할까요?')) return
 setCartons(prev => prev.filter(c => c.tempId !== tempId))
 setDirty(true)
 }

 function changeProduct(c: LocalCarton, productId: string) {
 const p = products.find(x => x.id === productId)
 updateCarton(c.tempId, {
 product_id: productId || null,
 product_code: p?.code || null,
 product_name: p?.name || null,
 })
 }

 function changeSize(c: LocalCarton, sizeKey: string, value: number) {
 const newSizes = { ...c.sizes, [sizeKey]: value }
 const total = Object.values(newSizes).reduce((s, n) => s + Number(n || 0), 0)
 updateCarton(c.tempId, { sizes: newSizes, total_quantity: total })
 }

 // 품번 합계 뷰
 const summary = cartons.reduce<Record<string, { code: string; name: string; sizes: Record<string, number>; total: number; cartons: number }>>((acc, it) => {
 const key = it.product_code || it.product_id || 'unknown'
 if (!acc[key]) acc[key] = { code: it.product_code || '', name: it.product_name || '', sizes: {}, total: 0, cartons: 0 }
 sizeKeys.forEach(s => {
 acc[key].sizes[s] = (acc[key].sizes[s] || 0) + Number(it.sizes[s] || 0)
 })
 acc[key].total += Number(it.total_quantity || 0)
 acc[key].cartons += 1
 return acc
 }, {})

 const grandTotal = cartons.reduce((s, i) => s + Number(i.total_quantity || 0), 0)

 /* ───── 저장 ───── */
 async function handleSave(closeAfter: boolean = true) {
 if (!form.vendor_id) { setError('거래처를 선택해주세요.'); return }
 setSaving(true)
 setError(null)

 const headerPayload = {
 vendor_id: form.vendor_id,
 period: form.period?.trim() || null,
 producer: form.producer?.trim() || 'AW',
 brand: form.brand?.trim() || null,
 notes: form.notes?.trim() || null,
 }

 let incomingId: string
 if (editing) {
 const { error } = await supabase.from('incoming').update(headerPayload).eq('id', editing.id)
 if (error) { setSaving(false); setError(error.message); return }
 incomingId = editing.id
 } else {
 const { data, error } = await supabase.from('incoming').insert(headerPayload).select().single()
 if (error) { setSaving(false); setError(error.message); return }
 incomingId = data.id
 }

 // 박스 동기화
 const currentIds = new Set(cartons.filter(c => c.persistedId).map(c => c.persistedId!))
 const toDelete = Array.from(originalIds).filter(id => !currentIds.has(id))
 if (toDelete.length > 0) {
 await supabase.from('incoming_items').delete().in('id', toDelete)
 }

 for (const c of cartons) {
 const payload = {
 incoming_id: incomingId,
 product_id: c.product_id,
 product_code: c.product_code,
 product_name: c.product_name,
 sizes: c.sizes,
 total_quantity: c.total_quantity,
 carton_no: c.carton_no,
 }
 if (c.persistedId) {
 await supabase.from('incoming_items').update(payload).eq('id', c.persistedId)
 } else {
 await supabase.from('incoming_items').insert(payload)
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
 title={editing ? '입고내역서 편집' : '새 입고내역서'}
 width="lg"
 footer={
 <>
 {dirty && <span className="text-[11px] text-amber-600 mr-auto">● 저장 안 된 변경 사항 있음</span>}
 {!dirty && editing && <span className="text-[11px] text-emerald-600 mr-auto">✓ 저장됨</span>}
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
 {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
 </Select>
 <p className="text-[11px] text-zinc-400 mt-1">
 {products.length > 0
 ? `이 거래처의 등록 상품: ${products.length}개`
 : '⚠ 등록 상품 없음 (상품 관리에서 먼저 등록)'}
 </p>
 </div>
 <div>
 <Label>기간</Label>
 <Input value={form.period || ''} onChange={e => update('period', e.target.value)} />
 </div>
 <div>
 <Label>생산처</Label>
 <Input value={form.producer || 'AW'} onChange={e => update('producer', e.target.value)} />
 </div>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <Label>브랜드</Label>
 <Input value={form.brand || ''} onChange={e => update('brand', e.target.value)} />
 </div>
 <div>
 <Label>메모</Label>
 <Input value={form.notes || ''} onChange={e => update('notes', e.target.value)} />
 </div>
 </div>

 {sizeKeys.length === 0 && form.vendor_id && (
 <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px]">
 ⚠️ 이 거래처에 사이즈 체계가 등록되어 있지 않습니다. <strong>고객 거래처</strong> 메뉴에서 사이즈를 먼저 선택해주세요.
 </div>
 )}
 </div>

 {sizeKeys.length > 0 && (
 <div>
 <div className="flex items-center justify-between mb-3 gap-2">
 <div className="flex items-center gap-2">
 <h3 className="text-[14px] font-semibold text-zinc-900">입고 라인 (박스 단위)</h3>
 {cartons.length > 0 && (
 <span className="text-[11px] text-zinc-500">
 · 박스 {cartons.length}개 · 합계 {grandTotal.toLocaleString()}장
 </span>
 )}
 </div>
 <div className="flex items-center gap-2">
 <div className="flex bg-zinc-100 rounded-lg p-0.5">
 <button
 className={`px-3 py-1 text-[11px] font-medium rounded ${view === 'cartons' ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
 onClick={() => setView('cartons')}
 >박스별</button>
 <button
 className={`px-3 py-1 text-[11px] font-medium rounded ${view === 'summary' ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
 onClick={() => setView('summary')}
 >품번 합계</button>
 </div>
 <Button size="sm" onClick={addCarton}>＋ 박스 추가</Button>
 </div>
 </div>

 {cartons.length === 0 ? (
 <div className="border-2 border-dashed border-zinc-200 rounded-xl p-8 text-center">
 <p className="text-[13px] text-zinc-700 font-medium mb-2">📦 첫 박스를 추가해보세요</p>
 <p className="text-[12px] text-zinc-500 mb-4">박스 하나마다 품번과 사이즈별 수량을 입력합니다.</p>
 <Button onClick={addCarton}>＋ 첫 박스 추가하기</Button>
 {products.length === 0 && (
 <p className="text-[11px] text-amber-600 mt-3">
 ⚠️ 이 거래처에 등록된 상품이 없어요. <strong>상품 관리</strong>에서 먼저 등록하세요.
 </p>
 )}
 </div>
 ) : view === 'cartons' ? (
 <div className="space-y-2">
 {cartons.map(c => (
 <div key={c.tempId} className="border border-zinc-200 rounded-xl p-3 hover:border-zinc-300 transition-colors">
 <div className="flex items-center gap-2 mb-2">
 <Badge>C/T {c.carton_no}</Badge>
 <Select className="text-[12px] flex-1" value={c.product_id || ''} onChange={e => changeProduct(c, e.target.value)}>
 <option value="">— 상품 선택 (이 거래처 상품 {products.length}개) —</option>
 {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}{p.color ? ` (${p.color})` : ''}</option>)}
 </Select>
 <button onClick={() => removeCarton(c.tempId)} className="text-rose-500 hover:text-rose-700 text-lg w-7 h-7" title="박스 삭제">×</button>
 </div>
 <div className="grid gap-1.5 mb-1" style={{ gridTemplateColumns: `repeat(${sizeKeys.length}, minmax(0, 1fr))` }}>
 {sizeKeys.map(s => (
 <div key={s}>
 <p className="text-[10px] text-zinc-500 text-center mb-0.5">{s}</p>
 <Input
 type="number"
 value={c.sizes[s] || 0}
 onChange={e => changeSize(c, s, Number(e.target.value))}
 className="text-[12px] text-center px-1.5 py-1.5"
 />
 </div>
 ))}
 </div>
 <div className="text-right text-[11px] text-zinc-500 mt-1">
 합계: <span className="font-semibold text-zinc-900 tabular-nums">{c.total_quantity}</span>
 </div>
 </div>
 ))}
 <div className="bg-zinc-100 rounded-xl p-3 flex items-center justify-between text-[13px]">
 <span className="text-zinc-500">총 박스 {cartons.length}개</span>
 <span className="text-zinc-500">전체 합계: <span className="font-bold text-zinc-900 tabular-nums text-[15px]">{grandTotal.toLocaleString()}</span></span>
 </div>
 </div>
 ) : (
 <div className="border border-zinc-200 rounded-xl overflow-hidden">
 <table className="w-full text-[12px]">
 <thead className="bg-zinc-50">
 <tr>
 <th className="px-3 py-2 text-left">품번</th>
 <th className="px-3 py-2 text-left">품목</th>
 {sizeKeys.map(s => <th key={s} className="px-2 py-2 text-center">{s}</th>)}
 <th className="px-3 py-2 text-right">합계</th>
 <th className="px-2 py-2 text-center">박스</th>
 </tr>
 </thead>
 <tbody>
 {Object.values(summary).map(s => (
 <tr key={s.code} className="border-t border-zinc-100">
 <td className="px-3 py-2 font-mono">{s.code}</td>
 <td className="px-3 py-2 truncate max-w-[200px]">{s.name}</td>
 {sizeKeys.map(k => <td key={k} className="px-2 py-2 text-center tabular-nums">{s.sizes[k] || 0}</td>)}
 <td className="px-3 py-2 text-right font-semibold tabular-nums">{s.total}</td>
 <td className="px-2 py-2 text-center text-zinc-500">{s.cartons}</td>
 </tr>
 ))}
 <tr className="border-t-2 border-zinc-300 bg-zinc-50">
 <td colSpan={2 + sizeKeys.length} className="px-3 py-2 text-right font-semibold">전체</td>
 <td className="px-3 py-2 text-right font-bold text-[14px] tabular-nums">{grandTotal.toLocaleString()}</td>
 <td className="px-2 py-2 text-center text-zinc-500">{cartons.length}</td>
 </tr>
 </tbody>
 </table>
 </div>
 )}
 <p className="text-[11px] text-zinc-400 mt-2">💡 변경 사항은 우측 하단 <strong>저장</strong> 버튼을 눌러야 DB에 반영됩니다.</p>
 </div>
 )}
 </Drawer>
 )
}

function defaultPeriod() {
 const d = new Date()
 return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`
}
