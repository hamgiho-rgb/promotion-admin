import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor, ProductMargin } from '@/lib/types'
import { Button, Input, Select, PageHeader, Empty, Badge } from '@/components/ui'
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
 const [vendors, setVendors] = useState<Vendor[]>([])
 const [lines, setLines] = useState<MarginLine[]>([])
 const [loading, setLoading] = useState(true)
 const [vendorFilter, setVendorFilter] = useState<string>('all')
 const [period, setPeriod] = useState<Period>('this_year')
 const [search, setSearch] = useState('')

 async function load() {
 setLoading(true)
 const [{ data: vData }, { data: invData }, { data: itemData }, { data: marginData }] = await Promise.all([
 supabase.from('vendors').select('*').eq('vendor_type', 'customer').order('name'),
 supabase.from('invoices').select('id, vendor_id, issue_date'),
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

 return (
 <div>
 <PageHeader
 title="마진내역서"
 description="상품별·거래처별 매출과 원가, 마진을 분석합니다. 계산서에 등록된 모든 라인이 기준입니다."
 action={<Button variant="secondary" onClick={() => {
   const data = rowsToSheet(filtered as any[], [
     { key: 'line_date', label: '날짜' },
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
   // 합계 행 추가
   data.push(['합계','','','', totalQty, '', totalRevenue, '', totalCost, totalMargin, avgMarginRate.toFixed(1)])
   exportSheet(data, '마진내역서', '마진내역서')
 }} disabled={filtered.length === 0}>📥 엑셀 내보내기</Button>}
 />

 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
 <StatCard label="매출액" value={`₩${totalRevenue.toLocaleString()}`} hint={`납품 ${totalQty.toLocaleString()}장`} />
 <StatCard label="원가 합계" value={`₩${totalCost.toLocaleString()}`} hint="생산원가 기준" />
 <StatCard
 label="마진"
 value={`₩${totalMargin.toLocaleString()}`}
 hint={`평균 마진율 ${avgMarginRate.toFixed(1)}%`}
 highlight={totalMargin > 0 ? 'green' : totalMargin < 0 ? 'rose' : 'zinc'}
 />
 <StatCard label="라인 수" value={`${filtered.length}건`} hint="필터 결과" />
 </div>

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

function StatCard({ label, value, hint, highlight = 'zinc' }: {
 label: string; value: string; hint?: string; highlight?: 'zinc' | 'green' | 'rose'
}) {
 const colors = { zinc: 'text-zinc-900', green: 'text-emerald-700', rose: 'text-rose-700' }
 return (
 <div className="bg-white border border-zinc-200 rounded-2xl p-4">
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
 <p className={`text-[20px] font-bold mt-1 tabular-nums ${colors[highlight]}`}>{value}</p>
 {hint && <p className="text-[11px] text-zinc-400 mt-0.5">{hint}</p>}
 </div>
 )
}
