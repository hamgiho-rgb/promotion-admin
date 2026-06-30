import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Product, Vendor, ProductMargin } from '@/lib/types'
import { Button, Input, Textarea, Label, PageHeader, Drawer, Empty, Badge } from '@/components/ui'
import CustomerPicker from '@/components/CustomerPicker'
import VendorSearchSelect from '@/components/VendorSearchSelect'
import FlatImportButton from '@/components/FlatImportButton'
import { softDelete, softDeleteMany } from '@/lib/trash'

/* ─────────────────────────────────────────────
 * 페이지 상태(필터/검색/스크롤) — 다른 페이지 갔다가 뒤로가기 해도 그대로 유지
 * sessionStorage에 저장 (탭 닫으면 사라짐)
 * ───────────────────────────────────────────── */
const STATE_KEY = 'products_page_state'
function loadPageState() {
  try {
    const raw = sessionStorage.getItem(STATE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch { return {} }
}
function savePageState(patch: Record<string, any>) {
  try {
    const cur = loadPageState()
    sessionStorage.setItem(STATE_KEY, JSON.stringify({ ...cur, ...patch }))
  } catch {}
}

export default function Products() {
 const navigate = useNavigate()
 const [products, setProducts] = useState<Product[]>([])
 const [margins, setMargins] = useState<Map<string, ProductMargin>>(new Map())
 const [vendors, setVendors] = useState<Vendor[]>([])
 const [loading, setLoading] = useState(true)
 // 초기값은 sessionStorage 에서 복원 (뒤로가기 시 이전 검색/필터 유지)
 const _saved = loadPageState()
 const [search, setSearch] = useState<string>(_saved.search ?? '')
 const [vendorFilter, setVendorFilter] = useState<string>(_saved.vendorFilter ?? 'all')
 const [priceFilter, setPriceFilter] = useState<'all' | 'missing'>(_saved.priceFilter ?? 'all')
 const [drawerOpen, setDrawerOpen] = useState(false)
 const [editing, setEditing] = useState<Product | null>(null)

 // 상태 변경 시 sessionStorage 동기화
 useEffect(() => { savePageState({ search }) }, [search])
 useEffect(() => { savePageState({ vendorFilter }) }, [vendorFilter])
 useEffect(() => { savePageState({ priceFilter }) }, [priceFilter])

 // 스크롤 위치 — 마운트 시 복원, 언마운트 시 저장
 useEffect(() => {
   const savedScroll = loadPageState().scrollY
   if (typeof savedScroll === 'number') {
     // 데이터 로드 후 스크롤 복원 — 약간 지연 (DOM 렌더링 후)
     const t = setTimeout(() => window.scrollTo(0, savedScroll), 50)
     return () => clearTimeout(t)
   }
 }, [loading])

 useEffect(() => {
   function onScroll() { savePageState({ scrollY: window.scrollY }) }
   window.addEventListener('scroll', onScroll, { passive: true })
   return () => window.removeEventListener('scroll', onScroll)
 }, [])

 // 일괄 선택
 const [selected, setSelected] = useState<Set<string>>(new Set())
 function toggleSelect(id: string) {
   setSelected(prev => {
     const next = new Set(prev)
     if (next.has(id)) next.delete(id); else next.add(id)
     return next
   })
 }
 function toggleSelectAllInGroup(ids: string[], checked: boolean) {
   setSelected(prev => {
     const next = new Set(prev)
     if (checked) ids.forEach(id => next.add(id))
     else ids.forEach(id => next.delete(id))
     return next
   })
 }
 function clearSelection() { setSelected(new Set()) }
 async function handleBulkDelete() {
   const ids = Array.from(selected)
   if (ids.length === 0) return
   if (!confirm(`선택한 ${ids.length}개 상품을 휴지통으로 옮길까요?\n30일 안에 휴지통에서 복구 가능합니다.`)) return
   const { error } = await softDeleteMany('products', ids)
   if (error) { alert('삭제 실패: ' + error.message); return }
   clearSelection()
   load()
 }

 // 거래처별 접기 상태 (localStorage 저장)
 const COLLAPSE_KEY = 'products_collapsed_vendors'
 const [collapsed, setCollapsed] = useState<Set<string>>(() => {
   try { const raw = localStorage.getItem(COLLAPSE_KEY); return new Set(raw ? JSON.parse(raw) : []) }
   catch { return new Set() }
 })
 function toggleCollapse(key: string) {
   setCollapsed(prev => {
     const next = new Set(prev)
     if (next.has(key)) next.delete(key); else next.add(key)
     try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(next))) } catch {}
     return next
   })
 }
 function collapseAll(keys: string[]) {
   const next = new Set([...collapsed, ...keys])
   setCollapsed(next)
   try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify(Array.from(next))) } catch {}
 }
 function expandAll() {
   setCollapsed(new Set())
   try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([])) } catch {}
 }

 async function load() {
 setLoading(true)
 const [{ data: pData }, { data: vData }, { data: mData }] = await Promise.all([
 supabase.from('products').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
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
 if (!confirm(`'${p.code}' 상품을 휴지통으로 옮길까요?\n30일 안에 복구 가능.`)) return
 const { error } = await softDelete('products', p.id)
 if (error) { alert('삭제 실패: ' + error.message); return }
 load()
 }

 const filtered = products.filter(p => {
 if (vendorFilter !== 'all' && p.vendor_id !== vendorFilter) return false
 if (priceFilter === 'missing' && Number(p.selling_price || 0) > 0) return false
 if (search) {
 const s = search.toLowerCase()
 const nameKo = (p.name || '').toLowerCase()
 const nameEn = (p.name_en || '').toLowerCase()
 const code = (p.code || '').toLowerCase()
 const color = (p.color || '').toLowerCase()
 if (!code.includes(s) && !nameKo.includes(s) && !nameEn.includes(s) && !color.includes(s)) return false
 }
 return true
 })
 const missingPriceCount = products.filter(p => !Number(p.selling_price || 0)).length

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
 <StatCard label="총 상품 수" value={`${totalProducts}개`} hint={`${groupedVendorIds.length}개 거래처`} accent="blue" />
 <StatCard label="평균 판매가" value={`₩${avgPrice.toLocaleString()}`} hint="등록 상품 평균" accent="violet" />
 <StatCard label="원가 입력됨" value={`${withCost} / ${totalProducts}`} hint={totalProducts ? `${Math.round(withCost/totalProducts*100)}%  입력 완료` : '0%'} accent={withCost === totalProducts && totalProducts > 0 ? 'green' : 'amber'} />
 <StatCard label="평균 마진" value={`₩${avgMarginValue.toLocaleString()}`} hint="원가 입력된 상품 기준" accent="green" />
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
 <div className="w-56">
 <VendorSearchSelect
   value={vendorFilter}
   vendors={vendors}
   onChange={setVendorFilter}
   allLabel="모든 거래처"
   placeholder="🔍 거래처 검색"
 />
 </div>
 <div className="flex-1 min-w-[200px] max-w-md">
 <Input value={search} onChange={e => setSearch(e.target.value)} />
 </div>
 {missingPriceCount > 0 && (
   <button
     onClick={() => setPriceFilter(priceFilter === 'missing' ? 'all' : 'missing')}
     className={`text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${priceFilter === 'missing' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'}`}
     title="판매가 0원 또는 미입력 상품만 보기 (계산서에 단가 자동 매칭이 안 됩니다)"
   >
     ⚠ 판매가 미입력 {missingPriceCount}개
   </button>
 )}
 <div className="ml-auto flex items-center gap-2">
   <button
     onClick={() => collapseAll(groupedVendorIds)}
     className="text-[11px] px-2 py-1 rounded border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
     title="모든 거래처 접기"
   >▾ 전체 접기</button>
   <button
     onClick={expandAll}
     className="text-[11px] px-2 py-1 rounded border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
     title="모든 거래처 펼치기"
   >▸ 전체 펼치기</button>
   <span className="text-[12px] text-zinc-500">{filtered.length}개 상품</span>
 </div>
 </div>

 {/* 일괄 선택 액션 바 */}
 {selected.size > 0 && (
   <div className="px-4 py-2.5 bg-rose-50 border-b border-rose-200 flex items-center gap-3 flex-wrap">
     <span className="text-[13px] font-semibold text-rose-800">
       ✓ {selected.size}개 선택됨
     </span>
     <button
       onClick={() => toggleSelectAllInGroup(filtered.map(p => p.id), true)}
       className="text-[11px] px-2 py-1 rounded bg-white border border-rose-200 text-rose-700 hover:bg-rose-100"
     >
       표시된 {filtered.length}개 모두 선택
     </button>
     <button
       onClick={clearSelection}
       className="text-[11px] px-2 py-1 rounded bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
     >
       선택 해제
     </button>
     <button
       onClick={handleBulkDelete}
       className="ml-auto text-[12px] px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-medium"
     >
       🗑 휴지통으로 이동 ({selected.size})
     </button>
   </div>
 )}

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
 {groupedVendorIds.map(vId => {
 const vendor = vendors.find(v => v.id === vId)
 const brands = Array.from(new Set(grouped[vId].map(p => p.brand).filter(Boolean))) as string[]
 const withCostCount = grouped[vId].filter(p => (margins.get(p.id)?.production_cost || 0) > 0).length
 const isCollapsed = collapsed.has(vId)
 const vendorProductIds = grouped[vId].map(p => p.id)
 const allSelected = vendorProductIds.length > 0 && vendorProductIds.every(id => selected.has(id))
 const someSelected = vendorProductIds.some(id => selected.has(id))
 return (
 <div key={vId}>
 <div className="w-full px-4 py-3 bg-gradient-to-r from-zinc-900 to-zinc-800 text-white flex items-center justify-between transition-colors">
 <input
   type="checkbox"
   checked={allSelected}
   ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
   onChange={e => toggleSelectAllInGroup(vendorProductIds, e.target.checked)}
   className="w-4 h-4 rounded cursor-pointer mr-3 flex-shrink-0"
   title="이 거래처 상품 전체 선택"
 />
 <button
   onClick={() => toggleCollapse(vId)}
   className="flex-1 flex items-center justify-between text-left min-w-0 hover:opacity-90"
 >
 <div className="flex items-center gap-3 min-w-0">
 <span className={`text-white/70 text-[10px] transition-transform ${isCollapsed ? '' : 'rotate-90'}`}>▶</span>
 <div className="w-8 h-8 rounded-full bg-white/15 flex items-center justify-center text-[13px] font-bold flex-shrink-0">
 {vendorName(vId).slice(0, 1)}
 </div>
 <div className="min-w-0">
 <div className="flex items-center gap-2 flex-wrap">
 <span className="font-semibold text-[14px] truncate">{vendorName(vId)}</span>
 {vendor?.company_name && <span className="text-[10px] text-white/60">({vendor.company_name})</span>}
 {brands.map(b => (
 <span key={b} className="text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/90 font-medium">{b}</span>
 ))}
 </div>
 <div className="text-[11px] text-white/60 mt-0.5">
 {grouped[vId].length}개 상품 · 원가 {withCostCount}/{grouped[vId].length}
 </div>
 </div>
 </div>
 </button>
 </div>
 {!isCollapsed && (
 <table className="w-full text-[13px]">
 <thead>
 <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
 <th className="px-3 py-2.5 w-8"></th>
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
 const rate = Number(m?.margin_rate || 0)             // 판매가 대비 마진율 %
 const markup = cost > 0 ? (margin / cost) * 100 : 0  // 원가 대비 마크업 %
 const isSelected = selected.has(p.id)
 return (
 <tr key={p.id} className={`border-t border-zinc-100 hover:bg-zinc-50/50 ${isSelected ? 'bg-rose-50/40' : ''}`}>
 <td className="px-3 py-2.5">
   <input
     type="checkbox"
     checked={isSelected}
     onChange={() => toggleSelect(p.id)}
     className="w-4 h-4 rounded cursor-pointer"
   />
 </td>
 <td className="px-4 py-2.5 font-mono text-[12px] text-zinc-700">
 <button onClick={() => navigate(`/products/${p.id}`)} className="hover:underline text-blue-700">{p.code}</button>
 </td>
 <td className="px-4 py-2.5 font-medium text-zinc-900">
 <button onClick={() => navigate(`/products/${p.id}`)} className="hover:underline text-left">
   <div className="flex items-center gap-1.5">
     {p.brand && <Badge color="blue">{p.brand}</Badge>}
     <span>{p.name}</span>
   </div>
   {p.name_en && <div className="text-[10px] text-zinc-500 font-normal mt-0.5">{p.name_en}</div>}
 </button>
 </td>
 <td className="px-4 py-2.5 text-zinc-600">{p.color || '—'}</td>
 <td className="px-4 py-2.5 text-right tabular-nums">
 {cost > 0 ? (
 <span className="text-zinc-700 font-medium">₩{cost.toLocaleString()}</span>
 ) : (
 <button onClick={() => navigate(`/cost?product=${p.id}`)} className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100">
   원가 입력 →
 </button>
 )}
 </td>
 <td className="px-4 py-2.5 text-right tabular-nums">
   {Number(p.selling_price || 0) > 0 ? (
     <span className="font-semibold text-zinc-900">₩{Number(p.selling_price).toLocaleString()}</span>
   ) : (
     <button onClick={() => { setEditing(p); setDrawerOpen(true) }} className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100" title="판매가가 없어 계산서 단가 자동 매칭이 안 됩니다">
       ⚠ 판매가 입력 →
     </button>
   )}
 </td>
 <td className="px-4 py-2.5 text-right">
 {cost > 0 ? (
 <div className={`text-[12px] tabular-nums ${margin > 0 ? 'text-emerald-700' : margin < 0 ? 'text-rose-700' : 'text-zinc-500'}`}>
 <div className="font-bold">₩{margin.toLocaleString()}</div>
 <div className="text-[10px] opacity-70" title="마진율 (판매가 대비) / 마크업 (원가 대비)">
   {rate.toFixed(1)}% <span className="text-zinc-400">·</span> ↑{markup.toFixed(0)}%
 </div>
 </div>
 ) : (
 <span className="text-zinc-300 text-[11px]">—</span>
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
 )}
 </div>
 )
 })}
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
 onVendorsReload={load}
 />
 </div>
 )
}

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: 'blue'|'green'|'amber'|'violet' }) {
 const colors = {
   blue: 'from-blue-50 to-white border-blue-100',
   green: 'from-emerald-50 to-white border-emerald-100',
   amber: 'from-amber-50 to-white border-amber-100',
   violet: 'from-violet-50 to-white border-violet-100',
 }
 const bg = accent ? `bg-gradient-to-br ${colors[accent]}` : 'bg-white border-zinc-200'
 return (
 <div className={`border rounded-2xl p-4 ${bg}`}>
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
 <p className="text-[22px] font-bold text-zinc-900 mt-1 tabular-nums">{value}</p>
 {hint && <p className="text-[11px] text-zinc-500 mt-0.5">{hint}</p>}
 </div>
 )
}

function ProductDrawer({ open, onClose, editing, vendors, onSaved, onVendorsReload }: {
 open: boolean; onClose: () => void; editing: Product | null; vendors: Vendor[]; onSaved: () => void; onVendorsReload: () => void
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
 name_en: form.name_en?.trim() || null,
 brand: form.brand?.trim() || null,
 color: form.color?.trim() || null,
 vendor_id: form.vendor_id,
 selling_price: Number(form.selling_price) || 0,
 notes: form.notes?.trim() || null,
 }
 const result = editing
 ? await supabase.from('products').update(payload).eq('id', editing.id)
 : await supabase.from('products').insert(payload)
 setSaving(false)
 if (result.error) {
   // 중복 키 충돌이면 휴지통에 같은 품번이 있는지 확인 → 복구 옵션 제공
   const msg = result.error.message.toLowerCase()
   if (!editing && (msg.includes('duplicate') || msg.includes('unique'))) {
     const { data: trashed } = await supabase
       .from('products')
       .select('id, code, name')
       .eq('vendor_id', payload.vendor_id!)
       .eq('code', payload.code!)
       .not('deleted_at', 'is', null)
       .maybeSingle()
     if (trashed) {
       if (confirm(`품번 '${payload.code}' 가 휴지통에 있습니다.\n('${trashed.name}')\n\n휴지통에서 복구할까요?\n[취소] 누르면 다른 품번으로 등록`)) {
         await supabase.from('products').update({ deleted_at: null, ...payload }).eq('id', trashed.id)
         setDirty(false)
         onSaved()
         return
       }
       return setError(`품번 '${payload.code}' 가 휴지통에 있어요. 다른 품번을 쓰거나 휴지통에서 복구하세요.`)
     }
   }
   return setError(result.error.message)
 }
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
   onCustomersChanged={onVendorsReload}
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
 <Label required>품목명 (한글)</Label>
 <Input value={form.name || ''} onChange={e => update('name', e.target.value)} />
 </div>

 <div>
 <Label>영문 품목명 (선택)</Label>
 <Input value={form.name_en || ''} onChange={e => update('name_en', e.target.value)} />
 <p className="text-[11px] text-zinc-500 mt-1">거래처에서 영문으로 보내는 경우 같이 등록. 검색 시 둘 다 매칭됩니다.</p>
 </div>

 <div>
 <Label>브랜드 (선택)</Label>
 <Input value={form.brand || ''} onChange={e => update('brand', e.target.value)} />
 <p className="text-[11px] text-zinc-500 mt-1">예: 회사 '마요네즈' 안에 브랜드 '단델'. 상품 목록에 파란 뱃지로 표시.</p>
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
