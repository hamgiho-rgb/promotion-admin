import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Product, Vendor, ProductMargin } from '@/lib/types'
import { Button, Input, Select, Textarea, Label, PageHeader, Drawer, Empty, Badge } from '@/components/ui'
import CustomerPicker from '@/components/CustomerPicker'
import FlatImportButton from '@/components/FlatImportButton'

export default function Products() {
 const navigate = useNavigate()
 const [products, setProducts] = useState<Product[]>([])
 const [margins, setMargins] = useState<Map<string, ProductMargin>>(new Map())
 const [vendors, setVendors] = useState<Vendor[]>([])
 const [loading, setLoading] = useState(true)
 const [search, setSearch] = useState('')
 const [vendorFilter, setVendorFilter] = useState<string>('all')
 const [drawerOpen, setDrawerOpen] = useState(false)
 const [editing, setEditing] = useState<Product | null>(null)

 async function load() {
 setLoading(true)
 const [{ data: pData }, { data: vData }, { data: mData }] = await Promise.all([
 supabase.from('products').select('*').order('created_at', { ascending: false }),
 supabase.from('vendors').select('*').eq('vendor_type', 'customer').order('name'),
 supabase.from('product_margin').select('*'),
 ])
 setProducts(pData ?? [])
 setVendors(vData ?? [])
 const map = new Map<string, ProductMargin>()
 ;(mData ?? []).forEach((m: ProductMargin) => map.set(m.id, m))
 setMargins(map)
 setLoading(false)
 }

 useEffect(() => { load() }, [])

 function vendorName(id: string) {
 return vendors.find(v => v.id === id)?.name || '—'
 }

 async function handleDelete(p: Product) {
 if (!confirm(`'${p.code}' 상품을 삭제할까요?`)) return
 const { error } = await supabase.from('products').delete().eq('id', p.id)
 if (error) { alert('삭제 실패: ' + error.message); return }
 load()
 }

 const filtered = products.filter(p => {
 if (vendorFilter !== 'all' && p.vendor_id !== vendorFilter) return false
 if (search) {
 const s = search.toLowerCase()
 if (!p.code.toLowerCase().includes(s) && !p.name.toLowerCase().includes(s)) return false
 }
 return true
 })

 // 거래처별 그룹핑
 const grouped = filtered.reduce<Record<string, Product[]>>((acc, p) => {
 if (!acc[p.vendor_id]) acc[p.vendor_id] = []
 acc[p.vendor_id].push(p)
 return acc
 }, {})
 const groupedVendorIds = Object.keys(grouped).sort((a, b) => vendorName(a).localeCompare(vendorName(b)))

 // 요약 통계
 const totalProducts = filtered.length
 const totalValue = filtered.reduce((s, p) => s + Number(p.selling_price || 0), 0)
 const avgPrice = totalProducts ? Math.round(totalValue / totalProducts) : 0
 const withCost = filtered.filter(p => (margins.get(p.id)?.production_cost || 0) > 0).length
 const avgMargin = filtered
 .map(p => margins.get(p.id)?.margin || 0)
 .filter(m => m !== 0)
 const avgMarginValue = avgMargin.length ? Math.round(avgMargin.reduce((s, m) => s + m, 0) / avgMargin.length) : 0

 return (
 <div>
 <PageHeader
 title="상품 관리"
 description="거래처별 상품과 판매가를 관리합니다. 원가가 입력되면 자동으로 마진이 표시됩니다."
 action={<>
   <FlatImportButton entity="products" onImported={load} />
   <Button onClick={() => { setEditing(null); setDrawerOpen(true) }} disabled={vendors.length === 0}>
     ＋ 새 상품
   </Button>
 </>}
 />

 {/* 상단 요약 카드 */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
 <StatCard label="총 상품 수" value={`${totalProducts}개`} hint={`${groupedVendorIds.length}개 거래처`} />
 <StatCard label="평균 판매가" value={`₩${avgPrice.toLocaleString()}`} hint="등록 상품 평균" />
 <StatCard label="원가 입력됨" value={`${withCost}개`} hint={totalProducts ? `${Math.round(withCost/totalProducts*100)}%` : '0%'} />
 <StatCard label="평균 마진" value={`₩${avgMarginValue.toLocaleString()}`} hint="원가 입력된 상품 기준" />
 </div>

 {vendors.length === 0 ? (
 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <Empty
 icon="🏢"
 title="먼저 거래처(고객)를 등록해주세요"
 description="상품은 반드시 거래처(고객)에 속해야 합니다. 거래처 관리 메뉴에서 고객을 먼저 등록하세요."
 />
 </div>
 ) : (
 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <div className="px-4 pt-3 pb-3 flex items-center gap-3 flex-wrap border-b border-zinc-100">
 <div className="w-48">
 <Select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
 <option value="all">모든 거래처</option>
 {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
 </Select>
 </div>
 <div className="flex-1 min-w-[200px] max-w-md">
 <Input value={search} onChange={e => setSearch(e.target.value)} />
 </div>
 <span className="text-[12px] text-zinc-500 ml-auto">{filtered.length}개 상품</span>
 </div>

 {loading ? (
 <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
 ) : filtered.length === 0 ? (
 products.length === 0 ? (
 <Empty icon="👕" title="등록된 상품이 없어요" description="우측 상단 ＋ 새 상품 버튼으로 등록해보세요." />
 ) : (
 <Empty icon="🔍" title="검색 결과가 없습니다" />
 )
 ) : (
 <div>
 {groupedVendorIds.map(vId => (
 <div key={vId}>
 <div className="px-4 py-2.5 bg-zinc-50 border-y border-zinc-100 flex items-center justify-between">
 <div className="flex items-center gap-2">
 <Badge color="green">{vendorName(vId)}</Badge>
 <span className="text-[11px] text-zinc-500">{grouped[vId].length}개 상품</span>
 </div>
 <span className="text-[11px] text-zinc-500">
 매출가 합계 ₩{grouped[vId].reduce((s, p) => s + Number(p.selling_price), 0).toLocaleString()}
 </span>
 </div>
 <table className="w-full text-[13px]">
 <thead>
 <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
 <th className="px-4 py-2.5">품번</th>
 <th className="px-4 py-2.5">품목</th>
 <th className="px-4 py-2.5">컬러</th>
 <th className="px-4 py-2.5 text-right">원가</th>
 <th className="px-4 py-2.5 text-right">판매가</th>
 <th className="px-4 py-2.5 text-right">마진</th>
 <th className="px-4 py-2.5 text-right">관리</th>
 </tr>
 </thead>
 <tbody>
 {grouped[vId].map(p => {
 const m = margins.get(p.id)
 const cost = Number(m?.production_cost || 0)
 const margin = Number(m?.margin || 0)
 const rate = Number(m?.margin_rate || 0)
 return (
 <tr key={p.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
 <td className="px-4 py-2.5 font-mono text-[12px] text-zinc-700">
 <button onClick={() => navigate(`/products/${p.id}`)} className="hover:underline text-blue-700">{p.code}</button>
 </td>
 <td className="px-4 py-2.5 font-medium text-zinc-900">
 <button onClick={() => navigate(`/products/${p.id}`)} className="hover:underline text-left">{p.name}</button>
 </td>
 <td className="px-4 py-2.5 text-zinc-600">{p.color || '—'}</td>
 <td className="px-4 py-2.5 text-right tabular-nums">
 {cost > 0 ? (
 <span className="text-zinc-600">₩{cost.toLocaleString()}</span>
 ) : (
 <span className="text-zinc-300">미입력</span>
 )}
 </td>
 <td className="px-4 py-2.5 text-right font-medium tabular-nums">₩{Number(p.selling_price).toLocaleString()}</td>
 <td className="px-4 py-2.5 text-right">
 {cost > 0 ? (
 <span className={`text-[12px] font-semibold tabular-nums ${margin > 0 ? 'text-emerald-700' : margin < 0 ? 'text-rose-700' : 'text-zinc-500'}`}>
 ₩{margin.toLocaleString()}
 <span className="ml-1 text-[10px] text-zinc-500">({rate.toFixed(1)}%)</span>
 </span>
 ) : (
 <span className="text-zinc-300 text-[12px]">—</span>
 )}
 </td>
 <td className="px-4 py-2.5 text-right">
 <Button size="sm" variant="ghost" onClick={() => { setEditing(p); setDrawerOpen(true) }}>수정</Button>
 <Button size="sm" variant="ghost" onClick={() => handleDelete(p)} className="text-rose-600 hover:bg-rose-50">삭제</Button>
 </td>
 </tr>
 )
 })}
 </tbody>
 </table>
 </div>
 ))}
 </div>
 )}
 </div>
 )}

 <ProductDrawer
 open={drawerOpen}
 onClose={() => setDrawerOpen(false)}
 editing={editing}
 vendors={vendors}
 onSaved={() => { setDrawerOpen(false); load() }}
 />
 </div>
 )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
 return (
 <div className="bg-white border border-zinc-200 rounded-2xl p-4">
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
 <p className="text-[20px] font-bold text-zinc-900 mt-1 tabular-nums">{value}</p>
 {hint && <p className="text-[11px] text-zinc-400 mt-0.5">{hint}</p>}
 </div>
 )
}

function ProductDrawer({ open, onClose, editing, vendors, onSaved }: {
 open: boolean; onClose: () => void; editing: Product | null; vendors: Vendor[]; onSaved: () => void
}) {
 const [form, setForm] = useState<Partial<Product>>({})
 const [saving, setSaving] = useState(false)
 const [error, setError] = useState<string | null>(null)
 const [dirty, setDirty] = useState(false)

 useEffect(() => {
 if (editing) setForm(editing)
 else setForm({ vendor_id: vendors[0]?.id, selling_price: 0 })
 setError(null)
 setDirty(false)
 }, [editing, open, vendors])

 function update<K extends keyof Product>(k: K, v: Product[K]) {
 setForm(prev => ({ ...prev, [k]: v }))
 setDirty(true)
 }

 async function handleSave() {
 if (!form.code?.trim()) return setError('품번은 필수입니다.')
 if (!form.name?.trim()) return setError('품목명은 필수입니다.')
 if (!form.vendor_id) return setError('거래처를 선택해주세요.')

 setSaving(true)
 setError(null)
 const payload = {
 code: form.code.trim(),
 name: form.name.trim(),
 color: form.color?.trim() || null,
 vendor_id: form.vendor_id,
 selling_price: Number(form.selling_price) || 0,
 notes: form.notes?.trim() || null,
 }
 const result = editing
 ? await supabase.from('products').update(payload).eq('id', editing.id)
 : await supabase.from('products').insert(payload)
 setSaving(false)
 if (result.error) return setError(result.error.message)
 setDirty(false)
 onSaved()
 }

 function handleClose() {
 if (dirty && !confirm('저장하지 않은 변경 사항이 있어요. 정말 닫을까요?')) return
 onClose()
 }

 return (
 <Drawer
 open={open}
 onClose={handleClose}
 title={editing ? '상품 수정' : '새 상품 등록'}
 footer={
 <>
 {dirty && <span className="text-[11px] text-amber-600 mr-auto">● 변경 사항 있음</span>}
 {!dirty && editing && <span className="text-[11px] text-emerald-600 mr-auto">✓ 저장됨</span>}
 <Button variant="secondary" onClick={handleClose}>취소</Button>
 <Button onClick={handleSave} disabled={saving || !dirty}>{saving ? '저장 중...' : '저장'}</Button>
 </>
 }
 >
 {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">{error}</div>}

 <div className="space-y-4">
 <div>
 <Label required>거래처(고객)</Label>
 <CustomerPicker
   value={form.vendor_id || null}
   customers={vendors}
   onChange={(id) => update('vendor_id', id || '')}
   onCustomersChanged={load}
 />
 </div>

 <div className="grid grid-cols-2 gap-3">
 <div>
 <Label required>품번</Label>
 <Input value={form.code || ''} onChange={e => update('code', e.target.value)} />
 </div>
 <div>
 <Label>컬러</Label>
 <Input value={form.color || ''} onChange={e => update('color', e.target.value)} />
 </div>
 </div>

 <div>
 <Label required>품목명</Label>
 <Input value={form.name || ''} onChange={e => update('name', e.target.value)} />
 </div>

 <div>
 <Label>판매가 (이 거래처에 파는 단가)</Label>
 <Input
 type="number"
 value={form.selling_price ?? 0}
 onChange={e => update('selling_price', Number(e.target.value))}
 />
 <p className="text-[11px] text-zinc-500 mt-1.5">계산서 발행 시 자동으로 이 단가가 사용됩니다.</p>
 </div>
 <div>
 <Label>메모</Label>
 <Textarea rows={3} value={form.notes || ''} onChange={e => update('notes', e.target.value)} />
 </div>
 </div>
 </Drawer>
 )
}
