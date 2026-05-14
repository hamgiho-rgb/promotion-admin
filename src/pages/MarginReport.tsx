import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Vendor, ProductMargin } from '@/lib/types'
import { Button, Input, Select, Empty, Badge } from '@/components/ui'
import { exportSheet, rowsToSheet } from '@/lib/exportXlsx'

interface MarginLine {
 invoice_id: string
 invoice_date: string
 vendor_id: string
 vendor_name: string
 product_id: string | null
 product_name: string
 color: string | null
 quantity: number
 unit_price: number // 실제 청구한 단가
 revenue: number // = quantity * unit_price
 cost_per_unit: number // 상품의 원가 (product_margin)
 total_cost: number // = quantity * cost_per_unit
 margin: number // = revenue - total_cost
 margin_rate: number // = margin / revenue * 100
}

type Period = 'this_month' | 'last_month' | 'this_year' | 'all'

export default function MarginReport() {
 const navigate = useNavigate()
 const [vendors, setVendors] = useState<Vendor[]>([])
 const [lines, setLines] = useState<MarginLine[]>([])
 const [loading, setLoading] = useState(true)
 const [vendorFilter, setVendorFilter] = useState<string>('all')
 const [period, setPeriod] = useState<Period>('this_year')
 const [search, setSearch] = useState('')

 async function load() {
 setLoading(true)
 const [{ data: vData }, { data: invData }, { data: itemData }, { data: marginData }] = await Promise.all([
 supabase.from('vendors').select('*').eq('vendor_type', 'customer').is('deleted_at', null).order('name'),
 supabase.from('invoices').select('id, vendor_id, issue_date').is('deleted_at', null),
 supabase.from('invoice_items').select('*'),
 supabase.from('product_margin').select('*'),
 ])
 setVendors(vData ?? [])

 const invoiceById = new Map<string, { vendor_id: string; date: string }>()
 ;(invData ?? []).forEach(i => invoiceById.set(i.id, { vendor_id: i.vendor_id, date: i.issue_date }))
 const vendorNameById = new Map<string, string>()
 ;(vData ?? []).forEach(v => vendorNameById.set(v.id, v.name))
 const marginByProduct = new Map<string, ProductMargin>()
 ;(marginData ?? []).forEach((m: ProductMargin) => marginByProduct.set(m.id, m))

 const result: MarginLine[] = (itemData ?? []).map((it: any) => {
 const inv = invoiceById.get(it.invoice_id)
 const margin = it.product_id ? marginByProduct.get(it.product_id) : null
 const qty = Number(it.quantity || 0)
 const price = Number(it.unit_price || 0)
 const revenue = qty * price
 const cpu = Number(margin?.production_cost || 0)
 const totalCost = qty * cpu
 const m = revenue - totalCost
 return {
 invoice_id: it.invoice_id,
 invoice_date: inv?.date || '',
 vendor_id: inv?.vendor_id || '',
 vendor_name: vendorNameById.get(inv?.vendor_id || '') || '—',
 product_id: it.product_id,
 product_name: it.product_name || '',
 color: it.color,
 quantity: qty,
 unit_price: price,
 revenue,
 cost_per_unit: cpu,
 total_cost: totalCost,
 margin: m,
 margin_rate: revenue !== 0 ? (m / revenue) * 100 : 0,
 }
 })

 setLines(result)
 setLoading(false)
 }

 useEffect(() => { load() }, [])

 // 기간 필터링
 const now = new Date()
 const thisYear = now.getFullYear()
 const thisMonth = `${thisYear}-${String(now.getMonth() + 1).padStart(2, '0')}`
 const lastMonthDate = new Date(thisYear, now.getMonth() - 1, 1)
 const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`

 function inPeriod(date: string) {
 if (period === 'all') return true
 if (period === 'this_year') return date.startsWith(String(thisYear))
 if (period === 'this_month') return date.startsWith(thisMonth)
 if (period === 'last_month') return date.startsWith(lastMonth)
 return true
 }

 const filtered = lines.filter(l => {
 if (!inPeriod(l.invoice_date)) return false
 if (vendorFilter !== 'all' && l.vendor_id !== vendorFilter) return false
 if (search && !l.product_name.toLowerCase().includes(search.toLowerCase())) return false
 return true
 })

 // 거래처별로 그룹
 const grouped = filtered.reduce<Record<string, MarginLine[]>>((acc, l) => {
 if (!acc[l.vendor_id]) acc[l.vendor_id] = []
 acc[l.vendor_id].push(l)
 return acc
 }, {})

 // 전체 합계
 const totalQty = filtered.reduce((s, l) => s + l.quantity, 0)
 const totalRevenue = filtered.reduce((s, l) => s + l.revenue, 0)
 const totalCost = filtered.reduce((s, l) => s + l.total_cost, 0)
 const totalMargin = totalRevenue - totalCost
 const avgMarginRate = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0

 // 추가 분석 지표
 const linesWithCost = filtered.filter(l => l.cost_per_unit > 0)
 const linesWithoutCost = filtered.filter(l => l.cost_per_unit === 0 && l.product_id)
 const lossLines = linesWithCost.filter(l => l.margin < 0)
 const lossAmount = lossLines.reduce((s, l) => s + l.margin, 0)
 const noCostRevenue = linesWithoutCost.reduce((s, l) => s + l.revenue, 0)

 // 상품별 집계 → TOP/BOTTOM
 const byProduct = new Map<string, { name: string; vendor: string; qty: number; revenue: number; cost: number; margin: number; rate: number; hasCost: boolean }>()
 filtered.forEach(l => {
   const key = l.product_id || `__none__${l.product_name}`
   const e = byProduct.get(key) || { name: l.product_name, vendor: l.vendor_name, qty: 0, revenue: 0, cost: 0, margin: 0, rate: 0, hasCost: l.cost_per_unit > 0 }
   e.qty += l.quantity
   e.revenue += l.revenue
   e.cost += l.total_cost
   e.margin = e.revenue - e.cost
   e.rate = e.revenue > 0 ? (e.margin / e.revenue) * 100 : 0
   if (l.cost_per_unit > 0) e.hasCost = true
   byProduct.set(key, e)
 })
 const productList = Array.from(byProduct.values()).filter(p => p.hasCost)
 const topProfitable = [...productList].sort((a, b) => b.margin - a.margin).slice(0, 5)
 const topLossy = [...productList].sort((a, b) => a.margin - b.margin).filter(p => p.margin < 0).slice(0, 5)

 const periodLabel = period === 'this_month' ? '이번 달' : period === 'last_month' ? '지난 달' : period === 'this_year' ? `${thisYear}년` : '전체 기간'

 function exportCurrent() {
   const data = rowsToSheet(filtered as any[], [
     { key: 'invoice_date', label: '날짜' },
     { key: 'vendor_name', label: '거래처' },
     { key: 'product_name', label: '상품' },
     { key: 'color', label: '컬러/사이즈' },
     { key: 'quantity', label: '수량' },
     { key: 'unit_price', label: '판매단가' },
     { key: 'revenue', label: '매출' },
     { key: 'cost_per_unit', label: '원가단가' },
     { key: 'total_cost', label: '원가합' },
     { key: 'margin', label: '마진' },
     { key: 'margin_rate', label: '마진율%', format: (v: number) => v ? v.toFixed(1) : 0 },
   ])
   data.push(['합계','','','', totalQty, '', totalRevenue, '', totalCost, totalMargin, avgMarginRate.toFixed(1)])
   exportSheet(data, '마진내역서', '마진내역서')
 }

 return (
 <div>
 {/* 그라데이션 헤더 — 마진은 영업 분석 톤 (오렌지 → 로즈 → 검정) */}
 <div className="mb-5 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 px-4 sm:px-6 pt-5 pb-6 bg-gradient-to-br from-orange-600 via-rose-700 to-zinc-900 text-white rounded-b-3xl">
   <div className="flex items-end justify-between flex-wrap gap-3">
     <div>
       <p className="text-[11px] uppercase tracking-wider text-orange-200 mb-1">MARGIN · {periodLabel}</p>
       <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight">마진내역서</h1>
       <p className="text-[12px] text-orange-100/80 mt-1">계산서 라인을 기준으로 매출·원가·마진을 한눈에 분석</p>
     </div>
     <div className="text-right">
       <div className="text-[10px] uppercase tracking-wider text-orange-200 mb-1">{periodLabel} 마진</div>
       <div className={`text-[26px] sm:text-[32px] font-bold tabular-nums ${totalMargin >= 0 ? 'text-white' : 'text-rose-200'}`}>
         ₩{totalMargin.toLocaleString()}
       </div>
       <div className="text-[12px] text-orange-100/80 mt-0.5">평균 마진율 {avgMarginRate.toFixed(1)}%</div>
     </div>
   </div>

   <div className="mt-4 flex items-center gap-2 flex-wrap">
     {linesWithoutCost.length > 0 && (
       <button
         onClick={() => navigate('/products')}
         className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-400/20 hover:bg-amber-400/30 text-amber-100 text-[12px] border border-amber-300/30"
       >
         ⚠ 원가 미입력 라인 {linesWithoutCost.length}건 (₩{noCostRevenue.toLocaleString()} 측정 안 됨) →
       </button>
     )}
     {lossLines.length > 0 && (
       <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-400/20 text-rose-100 text-[12px] border border-rose-300/30">
         🔻 손실 라인 {lossLines.length}건 (총 ₩{Math.abs(lossAmount).toLocaleString()} 손해)
       </span>
     )}
     <Button variant="secondary" onClick={exportCurrent} disabled={filtered.length === 0} className="bg-white/10 hover:bg-white/20 text-white border-white/20 ml-auto">📥 엑셀</Button>
   </div>
 </div>

 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
 <StatCard label="매출액" value={`₩${totalRevenue.toLocaleString()}`} hint={`납품 ${totalQty.toLocaleString()}장 · ${filtered.length}건`} accent="blue" />
 <StatCard label="원가 합계" value={`₩${totalCost.toLocaleString()}`} hint={`원가 등록 ${linesWithCost.length}건 기준`} accent="amber" />
 <StatCard
 label="마진"
 value={`₩${totalMargin.toLocaleString()}`}
 hint={`평균 마진율 ${avgMarginRate.toFixed(1)}%`}
 accent={totalMargin > 0 ? 'green' : totalMargin < 0 ? 'rose' : 'zinc'}
 />
 <StatCard
   label="손실 라인"
   value={lossLines.length > 0 ? `${lossLines.length}건` : '0건'}
   hint={lossLines.length > 0 ? `총 ₩${Math.abs(lossAmount).toLocaleString()} 손해` : '🎉 손실 없음'}
   accent={lossLines.length > 0 ? 'rose' : 'green'}
 />
 </div>

 {/* 상품별 마진 TOP / BOTTOM */}
 {productList.length > 0 && (
   <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
     <div className="bg-white border border-emerald-100 rounded-2xl overflow-hidden">
       <div className="px-4 py-2.5 bg-gradient-to-r from-emerald-50 to-white border-b border-emerald-100 flex items-center justify-between">
         <h3 className="text-[13px] font-semibold text-emerald-900">🏆 마진 TOP 5 상품</h3>
         <span className="text-[10px] text-emerald-700">원가 입력된 상품 중</span>
       </div>
       {topProfitable.length === 0 ? (
         <p className="px-4 py-6 text-[12px] text-zinc-400 text-center">아직 없음</p>
       ) : (
         <table className="w-full text-[12px]">
           <tbody>
             {topProfitable.map((p, i) => (
               <tr key={i} className="border-b border-zinc-50 last:border-b-0">
                 <td className="px-4 py-2 text-zinc-400 w-6 tabular-nums">{i + 1}</td>
                 <td className="px-1 py-2">
                   <div className="font-medium text-zinc-900 text-[12px]">{p.name}</div>
                   <div className="text-[10px] text-zinc-500">{p.vendor} · {p.qty.toLocaleString()}장</div>
                 </td>
                 <td className="px-4 py-2 text-right whitespace-nowrap">
                   <div className="font-bold tabular-nums text-emerald-700">₩{p.margin.toLocaleString()}</div>
                   <div className="text-[10px] text-emerald-600">{p.rate.toFixed(1)}%</div>
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       )}
     </div>

     <div className="bg-white border border-rose-100 rounded-2xl overflow-hidden">
       <div className="px-4 py-2.5 bg-gradient-to-r from-rose-50 to-white border-b border-rose-100 flex items-center justify-between">
         <h3 className="text-[13px] font-semibold text-rose-900">⚠ 손실 상품</h3>
         <span className="text-[10px] text-rose-700">마진 &lt; 0</span>
       </div>
       {topLossy.length === 0 ? (
         <p className="px-4 py-6 text-[12px] text-emerald-600 text-center">🎉 손실 상품 없음</p>
       ) : (
         <table className="w-full text-[12px]">
           <tbody>
             {topLossy.map((p, i) => (
               <tr key={i} className="border-b border-zinc-50 last:border-b-0">
                 <td className="px-4 py-2 text-zinc-400 w-6 tabular-nums">{i + 1}</td>
                 <td className="px-1 py-2">
                   <div className="font-medium text-zinc-900 text-[12px]">{p.name}</div>
                   <div className="text-[10px] text-zinc-500">{p.vendor} · {p.qty.toLocaleString()}장</div>
                 </td>
                 <td className="px-4 py-2 text-right whitespace-nowrap">
                   <div className="font-bold tabular-nums text-rose-700">−₩{Math.abs(p.margin).toLocaleString()}</div>
                   <div className="text-[10px] text-rose-600">{p.rate.toFixed(1)}%</div>
                 </td>
               </tr>
             ))}
           </tbody>
         </table>
       )}
     </div>
   </div>
 )}

 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <div className="p-3 border-b border-zinc-100 flex items-center gap-3 flex-wrap">
 <div className="w-40">
 <Select value={period} onChange={e => setPeriod(e.target.value as Period)}>
 <option value="this_month">이번 달</option>
 <option value="last_month">지난 달</option>
 <option value="this_year">올해 전체</option>
 <option value="all">전체 기간</option>
 </Select>
 </div>
 <div className="w-48">
 <Select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
 <option value="all">모든 거래처</option>
 {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
 </Select>
 </div>
 <div className="flex-1 min-w-[200px] max-w-md">
 <Input value={search} onChange={e => setSearch(e.target.value)} />
 </div>
 </div>

 {loading ? (
 <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
 ) : filtered.length === 0 ? (
 <Empty
 icon="📊"
 title="조회된 거래가 없습니다"
 description={lines.length === 0 ? '계산서를 등록하면 여기에 마진 내역이 자동으로 집계됩니다.' : '필터 조건을 변경해보세요.'}
 />
 ) : (
 <div>
 {Object.keys(grouped).sort((a, b) => grouped[b].reduce((s, l) => s + l.revenue, 0) - grouped[a].reduce((s, l) => s + l.revenue, 0)).map(vId => {
 const vendorLines = grouped[vId]
 const vRevenue = vendorLines.reduce((s, l) => s + l.revenue, 0)
 const vCost = vendorLines.reduce((s, l) => s + l.total_cost, 0)
 const vMargin = vRevenue - vCost
 const vRate = vRevenue > 0 ? (vMargin / vRevenue) * 100 : 0
 return (
 <div key={vId}>
 <div className="px-4 py-2.5 bg-zinc-50 border-y border-zinc-100 flex items-center justify-between flex-wrap gap-2">
 <div className="flex items-center gap-2">
 <Badge color="green">{vendorLines[0].vendor_name}</Badge>
 <span className="text-[11px] text-zinc-500">{vendorLines.length}건 · {vendorLines.reduce((s, l) => s + l.quantity, 0).toLocaleString()}장</span>
 </div>
 <div className="flex items-center gap-3 text-[12px]">
 <span className="text-zinc-500">매출 <span className="font-semibold tabular-nums text-zinc-700">₩{vRevenue.toLocaleString()}</span></span>
 <span className="text-zinc-500">원가 <span className="font-semibold tabular-nums text-zinc-700">₩{vCost.toLocaleString()}</span></span>
 <span className={`font-semibold ${vMargin > 0 ? 'text-emerald-700' : vMargin < 0 ? 'text-rose-700' : 'text-zinc-500'}`}>
 마진 ₩{vMargin.toLocaleString()} ({vRate.toFixed(1)}%)
 </span>
 </div>
 </div>
 <table className="w-full text-[12px]">
 <thead>
 <tr className="text-left text-[10px] font-semibold uppercase text-zinc-500">
 <th className="px-3 py-2 w-24">날짜</th>
 <th className="px-3 py-2">상품</th>
 <th className="px-3 py-2 w-16">컬러</th>
 <th className="px-3 py-2 text-right w-16">수량</th>
 <th className="px-3 py-2 text-right w-20">단가</th>
 <th className="px-3 py-2 text-right w-24">매출</th>
 <th className="px-3 py-2 text-right w-20">원가/장</th>
 <th className="px-3 py-2 text-right w-24">원가</th>
 <th className="px-3 py-2 text-right w-24">마진</th>
 <th className="px-3 py-2 text-right w-14">%</th>
 </tr>
 </thead>
 <tbody>
 {vendorLines.map((l, i) => (
 <tr key={i} className="border-t border-zinc-100 hover:bg-zinc-50/40">
 <td className="px-3 py-1.5 tabular-nums text-zinc-600">{l.invoice_date}</td>
 <td className="px-3 py-1.5">{l.product_name}</td>
 <td className="px-3 py-1.5 text-zinc-600">{l.color || '—'}</td>
 <td className={`px-3 py-1.5 text-right tabular-nums ${l.quantity < 0 ? 'text-rose-700' : ''}`}>{l.quantity.toLocaleString()}</td>
 <td className="px-3 py-1.5 text-right tabular-nums">₩{l.unit_price.toLocaleString()}</td>
 <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${l.revenue < 0 ? 'text-rose-700' : ''}`}>₩{l.revenue.toLocaleString()}</td>
 <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">
 {l.cost_per_unit > 0 ? `₩${Math.round(l.cost_per_unit).toLocaleString()}` : <span className="text-zinc-300">—</span>}
 </td>
 <td className="px-3 py-1.5 text-right tabular-nums text-zinc-500">
 {l.total_cost > 0 ? `₩${Math.round(l.total_cost).toLocaleString()}` : <span className="text-zinc-300">—</span>}
 </td>
 <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${l.margin > 0 ? 'text-emerald-700' : l.margin < 0 ? 'text-rose-700' : 'text-zinc-500'}`}>
 {l.cost_per_unit > 0 ? `₩${Math.round(l.margin).toLocaleString()}` : <span className="text-zinc-300">—</span>}
 </td>
 <td className={`px-3 py-1.5 text-right tabular-nums text-[11px] ${l.margin > 0 ? 'text-emerald-700' : l.margin < 0 ? 'text-rose-700' : 'text-zinc-500'}`}>
 {l.cost_per_unit > 0 ? `${l.margin_rate.toFixed(1)}%` : <span className="text-zinc-300">—</span>}
 </td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 )
 })}
 <div className="bg-zinc-900 text-white px-4 py-3 flex items-center justify-between text-[13px] rounded-b-2xl">
 <span>전체 합계</span>
 <div className="flex items-center gap-5">
 <span>매출 <strong className="tabular-nums">₩{totalRevenue.toLocaleString()}</strong></span>
 <span className="opacity-70">원가 <strong className="tabular-nums">₩{totalCost.toLocaleString()}</strong></span>
 <span className={totalMargin > 0 ? 'text-emerald-300' : totalMargin < 0 ? 'text-rose-300' : ''}>
 마진 <strong className="tabular-nums">₩{totalMargin.toLocaleString()}</strong> ({avgMarginRate.toFixed(1)}%)
 </span>
 </div>
 </div>
 </div>
 )}
 <p className="px-4 py-3 text-[11px] text-zinc-500">
 💡 원가는 <strong>원가계산서</strong>에서 입력된 재료 합계 기준입니다. 원가가 입력되지 않은 상품은 마진 계산이 빈칸으로 표시됩니다.
 </p>
 </div>
 </div>
 )
}

function StatCard({ label, value, hint, accent }: {
 label: string; value: string; hint?: string; accent?: 'zinc' | 'blue' | 'green' | 'amber' | 'violet' | 'rose'
}) {
 const palettes = {
   zinc:   { bg: 'from-zinc-50 to-white border-zinc-200',       text: 'text-zinc-900' },
   blue:   { bg: 'from-blue-50 to-white border-blue-100',       text: 'text-blue-900' },
   green:  { bg: 'from-emerald-50 to-white border-emerald-100', text: 'text-emerald-900' },
   amber:  { bg: 'from-amber-50 to-white border-amber-100',     text: 'text-amber-900' },
   violet: { bg: 'from-violet-50 to-white border-violet-100',   text: 'text-violet-900' },
   rose:   { bg: 'from-rose-50 to-white border-rose-100',       text: 'text-rose-900' },
 }
 const p = accent ? palettes[accent] : null
 return (
 <div className={`border rounded-2xl p-4 ${p ? `bg-gradient-to-br ${p.bg}` : 'bg-white border-zinc-200'}`}>
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
 <p className={`text-[20px] font-bold mt-1 tabular-nums ${p?.text || 'text-zinc-900'}`}>{value}</p>
 {hint && <p className="text-[11px] text-zinc-400 mt-0.5">{hint}</p>}
 </div>
 )
}
