import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Product, FabricUsage } from '@/lib/types'
import { Button, Input, InlineInput, PageHeader, Empty } from '@/components/ui'

export default function Fabric() {
 const [products, setProducts] = useState<Product[]>([])
 const [selectedId, setSelectedId] = useState<string>('')
 const [items, setItems] = useState<FabricUsage[]>([])
 const [loading, setLoading] = useState(true)
 const [search, setSearch] = useState('')

 async function loadProducts() {
 setLoading(true)
 const { data } = await supabase.from('products').select('*').order('name')
 setProducts(data ?? [])
 setLoading(false)
 }

 async function loadItems(productId: string) {
 const { data } = await supabase
 .from('fabric_usage')
 .select('*')
 .eq('product_id', productId)
 .order('created_at')
 setItems(data ?? [])
 }

 useEffect(() => { loadProducts() }, [])
 useEffect(() => {
 if (selectedId) loadItems(selectedId)
 else setItems([])
 }, [selectedId])

 async function addItem() {
 if (!selectedId) return
 const { error } = await supabase.from('fabric_usage').insert({
 product_id: selectedId,
 color: '신규 컬러',
 fabric_in: 0,
 cut_quantity: 0,
 total_amount: 0,
 })
 if (error) return alert('추가 실패: ' + error.message)
 loadItems(selectedId)
 }

 async function updateItem(id: string, patch: Partial<FabricUsage>) {
 const { error } = await supabase.from('fabric_usage').update(patch).eq('id', id)
 if (error) return alert('수정 실패: ' + error.message)
 loadItems(selectedId)
 }

 async function deleteItem(id: string) {
 if (!confirm('이 행을 삭제할까요?')) return
 await supabase.from('fabric_usage').delete().eq('id', id)
 loadItems(selectedId)
 }

 const filteredProducts = products.filter(p =>
 !search ||
 p.name.toLowerCase().includes(search.toLowerCase()) ||
 p.code.toLowerCase().includes(search.toLowerCase())
 )
 const selectedProduct = products.find(p => p.id === selectedId) || null

 // 합계 계산
 const totalIn = items.reduce((s, i) => s + Number(i.fabric_in || 0), 0)
 const totalCut = items.reduce((s, i) => s + Number(i.cut_quantity || 0), 0)
 const totalAmount = items.reduce((s, i) => s + Number(i.total_amount || 0), 0)
 const avgCostPerUnit = totalCut > 0 ? totalAmount / totalCut : 0

 return (
 <div>
   {/* 그라데이션 헤더 — 원단 (인디고/시안 톤) */}
   <div className="mb-5 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 px-4 sm:px-6 pt-5 pb-6 bg-gradient-to-br from-indigo-700 via-blue-800 to-zinc-900 text-white rounded-b-3xl">
     <div className="flex items-end justify-between flex-wrap gap-3">
       <div>
         <p className="text-[11px] uppercase tracking-wider text-indigo-200 mb-1">FABRIC</p>
         <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight">🧵 실 입고 내역</h1>
         <p className="text-[12px] text-indigo-100/80 mt-1">실(원단) 입고량을 금액·재단 수량으로 환산해 벌당 단가를 자동 계산</p>
       </div>
       <div className="text-right">
         <div className="text-[10px] uppercase tracking-wider text-indigo-200 mb-1">총 입고액</div>
         <div className="text-[26px] sm:text-[32px] font-bold tabular-nums">₩{totalAmount.toLocaleString()}</div>
         {totalCut > 0 && (
           <div className="text-[12px] text-indigo-100/80 mt-0.5">벌당 평균 ₩{Math.round(avgCostPerUnit).toLocaleString()}</div>
         )}
       </div>
     </div>
   </div>

 {loading ? (
 <div className="bg-white border border-zinc-200 rounded-2xl p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
 ) : products.length === 0 ? (
 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <Empty icon="👕" title="먼저 상품을 등록해주세요" />
 </div>
 ) : (
 <div className="grid grid-cols-12 gap-4">
 <aside className="col-span-3 bg-white border border-zinc-200 rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
 <div className="p-3 border-b border-zinc-100">
 <Input value={search} onChange={e => setSearch(e.target.value)} />
 </div>
 <div className="flex-1 overflow-y-auto">
 {filteredProducts.map(p => (
 <button
 key={p.id}
 onClick={() => setSelectedId(p.id)}
 className={`w-full text-left px-4 py-2.5 border-b border-zinc-50 ${
 selectedId === p.id ? 'bg-zinc-900 text-white' : 'hover:bg-zinc-50'
 }`}
 >
 <div className="text-[12px] font-mono opacity-70">{p.code}</div>
 <div className="text-[13px] font-medium truncate">{p.name}</div>
 </button>
 ))}
 </div>
 </aside>

 <div className="col-span-9">
 {!selectedProduct ? (
 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <Empty icon="←" title="좌측에서 상품을 선택하세요" />
 </div>
 ) : (
 <>
 <div className="grid grid-cols-4 gap-3 mb-4">
 <Stat label="원단 입고 (yard)" value={totalIn.toFixed(2)} />
 <Stat label="재단 수량 (벌)" value={totalCut.toLocaleString()} />
 <Stat label="원단 총액" value={`₩${totalAmount.toLocaleString()}`} />
 <Stat label="벌당 원단 단가" value={`₩${Math.round(avgCostPerUnit).toLocaleString()}`} />
 </div>

 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <div className="p-4 border-b border-zinc-100 flex items-center justify-between">
 <h3 className="text-[14px] font-semibold text-zinc-900">컬러별 입고/재단 내역</h3>
 <Button size="sm" onClick={addItem}>＋ 컬러 추가</Button>
 </div>

 {items.length === 0 ? (
 <Empty icon="🧵" title="입력된 내역이 없습니다" />
 ) : (
 <table className="w-full text-[13px]">
 <thead>
 <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
 <th className="px-4 py-3">컬러</th>
 <th className="px-4 py-3 text-right">원단입고(yard)</th>
 <th className="px-4 py-3 text-right">재단수량(벌)</th>
 <th className="px-4 py-3 text-right">총액(원)</th>
 <th className="px-4 py-3 text-right">벌당단가</th>
 <th className="px-4 py-3 text-right">벌당요척</th>
 <th className="px-4 py-3"></th>
 </tr>
 </thead>
 <tbody>
 {items.map(it => (
 <tr key={it.id} className="border-t border-zinc-100">
 <td className="px-3 py-2">
 <InlineInput value={it.color} onCommit={v => updateItem(it.id, { color: v })} className="text-[12px]" />
 </td>
 <td className="px-3 py-2">
 <InlineInput type="number" step="0.01" value={it.fabric_in} onCommit={v => updateItem(it.id, { fabric_in: Number(v) })} className="text-[12px] text-right tabular-nums" />
 </td>
 <td className="px-3 py-2">
 <InlineInput type="number" value={it.cut_quantity} onCommit={v => updateItem(it.id, { cut_quantity: Number(v) })} className="text-[12px] text-right tabular-nums" />
 </td>
 <td className="px-3 py-2">
 <InlineInput type="number" value={it.total_amount} onCommit={v => updateItem(it.id, { total_amount: Number(v) })} className="text-[12px] text-right tabular-nums" />
 </td>
 <td className="px-4 py-2 text-right tabular-nums text-zinc-700">₩{Math.round(Number(it.cost_per_unit) || 0).toLocaleString()}</td>
 <td className="px-4 py-2 text-right tabular-nums text-zinc-700">{Number(it.yards_per_unit || 0).toFixed(3)}</td>
 <td className="px-2 py-2 text-center">
 <button onClick={() => deleteItem(it.id)} className="text-rose-500 hover:text-rose-700 text-lg">×</button>
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 )}
 </div>
 <p className="text-[11px] text-zinc-400 mt-2">벌당 단가 = 총액 ÷ 재단수량 (자동). 벌당 요척 = 원단입고 ÷ 재단수량 (자동).</p>
 </>
 )}
 </div>
 </div>
 )}
 </div>
 )
}

function Stat({ label, value }: { label: string; value: string }) {
 return (
 <div className="bg-white border border-zinc-200 rounded-2xl p-4">
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
 <p className="text-[20px] font-bold text-zinc-900 mt-1 tabular-nums">{value}</p>
 </div>
 )
}
