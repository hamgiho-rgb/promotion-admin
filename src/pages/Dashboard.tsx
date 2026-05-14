import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Invoice, Incoming } from '@/lib/types'
import { Drawer, Badge, Empty } from '@/components/ui'
import { getTrashCounts } from '@/lib/trash'

interface MonthlyData {
  month: string
  revenue: number
  invoiceCount: number
  incomingCount: number
  incomingQty: number
}

type SummaryType = 'this_month_revenue' | 'last_month_revenue' | 'ytd_revenue' | 'this_month_incoming' | null

interface AlertStats {
  acceptedNoDeposit: { count: number; amount: number }   // 수락된 견적인데 계약금 미수령
  paidDepositNoInvoice: { count: number; amount: number } // 계약금 받았는데 계산서 미발행
  productsNoPrice: number                                 // 판매가 미입력 상품
  productsNoCost: number                                  // 원가 미입력 상품
  trashTotal: number                                      // 휴지통 총 건수
  thisMonthQuotations: number
  thisMonthIncomings: number
  thisMonthInvoices: number
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [incomings, setIncomings] = useState<Incoming[]>([])
  const [incomingItemsMap, setIncomingItemsMap] = useState<Map<string, number>>(new Map())
  const [vendorMap, setVendorMap] = useState<Map<string, string>>(new Map())
  const [alerts, setAlerts] = useState<AlertStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<SummaryType>(null)

  async function load() {
    setLoading(true)
    const today = new Date()
    const thisYearMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const thisYearMonthDot = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}`

    const [
      { data: invData },
      { data: incData },
      { data: vData },
      { data: quotData },
      { data: prodData },
      { data: costData },
      trash,
    ] = await Promise.all([
      supabase.from('invoices').select('*').is('deleted_at', null).order('issue_date', { ascending: false }),
      supabase.from('incoming').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
      supabase.from('vendors').select('id, name').is('deleted_at', null),
      // 알림용 — 수락 견적의 계약금 상태 + 계산서 연결 상태
      supabase.from('quotations').select('id, status, deposit_received, deposit_amount, total, issue_date').is('deleted_at', null),
      // 알림용 — 판매가/원가 미입력
      supabase.from('products').select('id, selling_price').is('deleted_at', null),
      supabase.from('cost_items').select('product_id'),
      getTrashCounts(),
    ])
    setInvoices(invData ?? [])
    setIncomings(incData ?? [])

    const vMap = new Map<string, string>()
    ;(vData ?? []).forEach(v => vMap.set(v.id, v.name))
    setVendorMap(vMap)

    if (incData && incData.length > 0) {
      const ids = incData.map(i => i.id)
      const { data: items } = await supabase
        .from('incoming_items')
        .select('incoming_id, total_quantity')
        .in('incoming_id', ids)
      const map = new Map<string, number>()
      ;(items ?? []).forEach((it: any) => {
        map.set(it.incoming_id, (map.get(it.incoming_id) || 0) + Number(it.total_quantity || 0))
      })
      setIncomingItemsMap(map)
    }

    // 알림 통계 계산
    const accepted = (quotData ?? []).filter((q: any) => q.status === 'accepted')
    const acceptedNoDeposit = accepted.filter((q: any) => !q.deposit_received)
    const invQuotIds = new Set((invData ?? []).map((i: any) => i.quotation_id).filter(Boolean))
    const paidDepNoInvoice = accepted.filter((q: any) => q.deposit_received && !invQuotIds.has(q.id))
    const productsNoPrice = (prodData ?? []).filter((p: any) => !Number(p.selling_price || 0)).length
    const prodsWithCost = new Set((costData ?? []).map((c: any) => c.product_id).filter(Boolean))
    const productsNoCost = (prodData ?? []).filter((p: any) => !prodsWithCost.has(p.id)).length
    const trashTotal = Object.values(trash || {}).reduce((s: number, n: any) => s + n, 0)

    setAlerts({
      acceptedNoDeposit: {
        count: acceptedNoDeposit.length,
        amount: acceptedNoDeposit.reduce((s: number, q: any) => s + Number(q.deposit_amount || 0), 0),
      },
      paidDepositNoInvoice: {
        count: paidDepNoInvoice.length,
        amount: paidDepNoInvoice.reduce((s: number, q: any) => s + Number(q.total || 0), 0),
      },
      productsNoPrice,
      productsNoCost,
      trashTotal,
      thisMonthQuotations: (quotData ?? []).filter((q: any) => q.issue_date?.startsWith(thisYearMonth)).length,
      thisMonthIncomings: (incData ?? []).filter((i: any) => i.period === thisYearMonthDot).length,
      thisMonthInvoices: (invData ?? []).filter((i: any) => i.issue_date?.startsWith(thisYearMonth)).length,
    })

    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const today = new Date()
  const dateStr = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`

  const monthlyMap = new Map<string, MonthlyData>()
  for (let i = 0; i < 12; i++) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    monthlyMap.set(key, { month: key, revenue: 0, invoiceCount: 0, incomingCount: 0, incomingQty: 0 })
  }
  invoices.forEach(inv => {
    const key = inv.issue_date?.slice(0, 7)
    if (!key) return
    const m = monthlyMap.get(key)
    if (m) {
      m.revenue += Number(inv.total || 0)
      m.invoiceCount += 1
    }
  })
  incomings.forEach(inc => {
    const period = inc.period
    if (!period) return
    const key = period.replace('.', '-')
    const m = monthlyMap.get(key)
    if (m) {
      m.incomingCount += 1
      m.incomingQty += incomingItemsMap.get(inc.id) || 0
    }
  })
  const months = Array.from(monthlyMap.values()).sort((a, b) => b.month.localeCompare(a.month))

  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`
  const thisMonthInc = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}`
  const thisYearStr = String(today.getFullYear())

  const thisMonthData = monthlyMap.get(thisMonth) ?? { month: thisMonth, revenue: 0, invoiceCount: 0, incomingCount: 0, incomingQty: 0 }
  const lastMonthData = monthlyMap.get(lastMonth) ?? { month: lastMonth, revenue: 0, invoiceCount: 0, incomingCount: 0, incomingQty: 0 }
  const yearRevenue = months.filter(m => m.month.startsWith(String(today.getFullYear()))).reduce((s, m) => s + m.revenue, 0)
  const maxRevenue = Math.max(1, ...months.map(m => m.revenue))

  const monthDelta = lastMonthData.revenue > 0
    ? ((thisMonthData.revenue - lastMonthData.revenue) / lastMonthData.revenue) * 100
    : 0

  return (
    <div>
      {/* 헤더 — 그라데이션 배경 */}
      <div className="mb-6 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 px-4 sm:px-6 pt-5 pb-6 bg-gradient-to-br from-zinc-900 via-zinc-800 to-zinc-900 text-white rounded-b-3xl">
        <p className="text-[12px] text-zinc-400 mb-1">{dateStr}</p>
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight">대시보드</h1>
            <p className="text-[12px] text-zinc-400 mt-1">한눈에 보는 이번 달 매출과 입고 현황</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">이번 달 매출</div>
            <div className="text-[26px] sm:text-[32px] font-bold tabular-nums">₩{thisMonthData.revenue.toLocaleString()}</div>
            {lastMonthData.revenue > 0 && (
              <div className={`text-[11px] mt-0.5 ${monthDelta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {monthDelta >= 0 ? '↑' : '↓'} {Math.abs(monthDelta).toFixed(1)}% (지난 달 대비)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 핵심 지표 카드 - 클릭하면 해당 페이지로 이동 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard
          label="이번 달 매출"
          value={`₩${thisMonthData.revenue.toLocaleString()}`}
          hint={`${thisMonth} · 계산서 ${thisMonthData.invoiceCount}건`}
          delta={lastMonthData.revenue > 0 ? { value: monthDelta.toFixed(1) + '%', positive: monthDelta >= 0 } : null}
          onClick={() => navigate(`/invoices?month=${thisMonth}`)}
          accent="blue"
        />
        <StatCard
          label="지난 달 매출"
          value={`₩${lastMonthData.revenue.toLocaleString()}`}
          hint={`${lastMonth} · 계산서 ${lastMonthData.invoiceCount}건`}
          onClick={() => navigate(`/invoices?month=${lastMonth}`)}
          accent="violet"
        />
        <StatCard
          label={`${today.getFullYear()}년 누적`}
          value={`₩${yearRevenue.toLocaleString()}`}
          hint="올해 매출 합계"
          onClick={() => navigate(`/invoices?year=${thisYearStr}`)}
          accent="green"
        />
        <StatCard
          label="이번 달 입고"
          value={`${thisMonthData.incomingQty.toLocaleString()}장`}
          hint={`${thisMonthData.incomingCount}건의 입고내역서`}
          onClick={() => navigate(`/incoming?month=${thisMonthInc}`)}
          accent="amber"
        />
      </div>

      {/* 알림 위젯 — 즉시 처리해야 할 일들 */}
      {alerts && (alerts.acceptedNoDeposit.count + alerts.paidDepositNoInvoice.count + alerts.productsNoPrice + alerts.productsNoCost + alerts.trashTotal > 0) && (
        <div className="mb-6">
          <h2 className="text-[13px] font-semibold text-zinc-700 mb-2 flex items-center gap-2">
            🔔 확인이 필요한 항목
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {alerts.acceptedNoDeposit.count > 0 && (
              <AlertCard
                icon="💰"
                tone="amber"
                title="계약금 미수령"
                value={`₩${alerts.acceptedNoDeposit.amount.toLocaleString()}`}
                hint={`수락된 견적 ${alerts.acceptedNoDeposit.count}건`}
                onClick={() => navigate('/quotations')}
              />
            )}
            {alerts.paidDepositNoInvoice.count > 0 && (
              <AlertCard
                icon="📄"
                tone="blue"
                title="계약금 받음 · 계산서 미발행"
                value={`${alerts.paidDepositNoInvoice.count}건`}
                hint={`총 견적액 ₩${alerts.paidDepositNoInvoice.amount.toLocaleString()}`}
                onClick={() => navigate('/quotations')}
              />
            )}
            {alerts.productsNoPrice > 0 && (
              <AlertCard
                icon="⚠"
                tone="rose"
                title="판매가 미입력 상품"
                value={`${alerts.productsNoPrice}개`}
                hint="계산서 단가 자동 매칭 안 됨"
                onClick={() => navigate('/products')}
              />
            )}
            {alerts.productsNoCost > 0 && (
              <AlertCard
                icon="🧮"
                tone="violet"
                title="원가 미입력 상품"
                value={`${alerts.productsNoCost}개`}
                hint="마진 계산 안 됨"
                onClick={() => navigate('/products')}
              />
            )}
            {alerts.trashTotal > 0 && (
              <AlertCard
                icon="🗑️"
                tone="zinc"
                title="휴지통"
                value={`${alerts.trashTotal}건`}
                hint="30일 후 자동 영구삭제"
                onClick={() => navigate('/trash')}
              />
            )}
          </div>
        </div>
      )}

      {/* 이번 달 작업 진행 — 견적 → 입고 → 계산서 단계별 */}
      {alerts && (alerts.thisMonthQuotations + alerts.thisMonthIncomings + alerts.thisMonthInvoices > 0) && (
        <div className="mb-6 bg-white border border-zinc-200 rounded-2xl p-4">
          <h2 className="text-[13px] font-semibold text-zinc-700 mb-3 flex items-center gap-2">
            📈 이번 달 작업 흐름
          </h2>
          <div className="flex items-center gap-3 overflow-x-auto">
            <FlowStep label="견적서" count={alerts.thisMonthQuotations} icon="📑" tone="blue" onClick={() => navigate('/quotations?month=' + thisMonth)} />
            <FlowArrow />
            <FlowStep label="입고" count={alerts.thisMonthIncomings} icon="📦" tone="amber" onClick={() => navigate('/incoming?month=' + thisMonthInc)} />
            <FlowArrow />
            <FlowStep label="계산서" count={alerts.thisMonthInvoices} icon="🧾" tone="green" onClick={() => navigate('/invoices?month=' + thisMonth)} />
          </div>
        </div>
      )}

      {/* 월별 매출 차트 + 표 */}
      <div className="bg-white border border-zinc-200 rounded-2xl mb-6 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-zinc-900">월별 매출</h2>
            <p className="text-[12px] text-zinc-500 mt-0.5">최근 12개월</p>
          </div>
          <button onClick={() => navigate('/invoices')} className="text-[12px] text-zinc-600 hover:text-zinc-900 hover:underline">계산서 전체 보기 →</button>
        </div>
        {loading ? (
          <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
        ) : (
          <div className="p-5">
            <div className="flex items-end justify-between gap-1.5 h-40 mb-4">
              {[...months].reverse().map(m => {
                const heightPct = maxRevenue > 0 ? (m.revenue / maxRevenue) * 100 : 0
                const isThisMonth = m.month === thisMonth
                return (
                  <div key={m.month} className="flex-1 flex flex-col items-center group relative">
                    {/* 툴팁 */}
                    {m.revenue > 0 && (
                      <div className="absolute -top-12 px-2 py-1 bg-zinc-900 text-white text-[10px] rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                        ₩{m.revenue.toLocaleString()}<br />{m.invoiceCount}건
                      </div>
                    )}
                    <div className="w-full flex items-end justify-center h-32">
                      <div
                        className={`w-full rounded-t-md transition-all ${
                          isThisMonth
                            ? 'bg-gradient-to-t from-zinc-900 to-zinc-700'
                            : m.revenue > 0
                            ? 'bg-gradient-to-t from-blue-400 to-blue-300 group-hover:from-blue-500 group-hover:to-blue-400'
                            : 'bg-zinc-100'
                        }`}
                        style={{ height: `${Math.max(heightPct, m.revenue > 0 ? 4 : 0)}%` }}
                      />
                    </div>
                    <span className={`text-[10px] mt-1.5 tabular-nums ${isThisMonth ? 'font-bold text-zinc-900' : 'text-zinc-500'}`}>
                      {m.month.slice(5)}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px] mt-4">
                <thead>
                  <tr className="text-left text-[10px] font-semibold uppercase text-zinc-500 border-b border-zinc-100">
                    <th className="py-2">월</th><th className="py-2 text-right">매출</th><th className="py-2 text-right">계산서</th><th className="py-2 text-right">입고 수량</th>
                  </tr>
                </thead>
                <tbody>
                  {months.filter(m => m.revenue > 0 || m.incomingCount > 0).slice(0, 12).map(m => (
                    <tr key={m.month} className={`border-b border-zinc-50 ${m.month === thisMonth ? 'bg-zinc-50/40 font-medium' : ''}`}>
                      <td className="py-2 tabular-nums">{m.month}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">₩{m.revenue.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums text-zinc-600">{m.invoiceCount}건</td>
                      <td className="py-2 text-right tabular-nums text-zinc-600">{m.incomingQty.toLocaleString()}장</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <h2 className="text-[13px] font-semibold text-zinc-700 mb-2">바로 가기</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <QuickAction onClick={() => navigate('/quotations')} icon="📑" label="견적서 작성" desc="새 견적 + 계약금" tint="blue" />
        <QuickAction onClick={() => navigate('/incoming')} icon="📦" label="입고 등록" desc="새 입고내역서" tint="amber" />
        <QuickAction onClick={() => navigate('/invoices')} icon="🧾" label="계산서 발행" desc="매출 청구" tint="green" />
        <QuickAction onClick={() => navigate('/payments')} icon="🏭" label="공급처 정산" desc="공장 결제 자동 계산" tint="violet" />
      </div>

      <SummaryDrawer type={summary} invoices={invoices} incomings={incomings} incomingItemsMap={incomingItemsMap} vendorMap={vendorMap} onClose={() => setSummary(null)} />
    </div>
  )
}

function StatCard({ label, value, hint, delta, onClick, accent }: { label: string; value: string; hint?: string; delta?: { value: string; positive: boolean } | null; onClick?: () => void; accent?: 'blue'|'green'|'amber'|'violet' }) {
  const palettes = {
    blue:   { bg: 'from-blue-50 to-white border-blue-100',       hover: 'hover:border-blue-300 hover:from-blue-100' },
    green:  { bg: 'from-emerald-50 to-white border-emerald-100', hover: 'hover:border-emerald-300 hover:from-emerald-100' },
    amber:  { bg: 'from-amber-50 to-white border-amber-100',     hover: 'hover:border-amber-300 hover:from-amber-100' },
    violet: { bg: 'from-violet-50 to-white border-violet-100',   hover: 'hover:border-violet-300 hover:from-violet-100' },
  }
  const p = accent ? palettes[accent] : null
  const baseClass = p
    ? `bg-gradient-to-br ${p.bg} ${onClick ? `cursor-pointer transition-colors ${p.hover}` : ''}`
    : `bg-white border-zinc-200 ${onClick ? 'hover:border-zinc-400 hover:bg-zinc-50/50 cursor-pointer transition-colors' : ''}`
  const inner = (
    <div className={`border rounded-2xl p-4 text-left ${baseClass}`}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
        {delta && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${delta.positive ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
            {delta.positive ? '↑' : '↓'} {delta.value}
          </span>
        )}
      </div>
      <p className="text-[22px] font-bold text-zinc-900 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-zinc-500 mt-1 flex items-center justify-between"><span>{hint}</span>{onClick && <span className="text-zinc-400">→</span>}</p>}
    </div>
  )
  return onClick ? <button onClick={onClick} className="block w-full">{inner}</button> : inner
}

function AlertCard({ icon, title, value, hint, tone, onClick }: { icon: string; title: string; value: string; hint?: string; tone: 'amber'|'rose'|'blue'|'violet'|'zinc'; onClick: () => void }) {
  const palettes = {
    amber:  { border: 'border-amber-200',  bg: 'from-amber-50 to-white',   text: 'text-amber-900',   hover: 'hover:border-amber-400 hover:from-amber-100' },
    rose:   { border: 'border-rose-200',   bg: 'from-rose-50 to-white',    text: 'text-rose-900',    hover: 'hover:border-rose-400 hover:from-rose-100' },
    blue:   { border: 'border-blue-200',   bg: 'from-blue-50 to-white',    text: 'text-blue-900',    hover: 'hover:border-blue-400 hover:from-blue-100' },
    violet: { border: 'border-violet-200', bg: 'from-violet-50 to-white',  text: 'text-violet-900',  hover: 'hover:border-violet-400 hover:from-violet-100' },
    zinc:   { border: 'border-zinc-200',   bg: 'from-zinc-50 to-white',    text: 'text-zinc-900',    hover: 'hover:border-zinc-400 hover:from-zinc-100' },
  }
  const p = palettes[tone]
  return (
    <button onClick={onClick} className={`text-left bg-gradient-to-br ${p.bg} border ${p.border} ${p.hover} rounded-2xl p-4 transition-colors w-full`}>
      <div className="flex items-start justify-between mb-1">
        <span className="text-xl">{icon}</span>
        <span className="text-zinc-400 text-xs">→</span>
      </div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-600">{title}</p>
      <p className={`text-[20px] font-bold tabular-nums mt-0.5 ${p.text}`}>{value}</p>
      {hint && <p className="text-[11px] text-zinc-500 mt-0.5">{hint}</p>}
    </button>
  )
}

function FlowStep({ label, count, icon, tone, onClick }: { label: string; count: number; icon: string; tone: 'blue'|'amber'|'green'; onClick: () => void }) {
  const palettes = {
    blue:  { bg: 'bg-blue-50 hover:bg-blue-100',     text: 'text-blue-700',     border: 'border-blue-200' },
    amber: { bg: 'bg-amber-50 hover:bg-amber-100',   text: 'text-amber-700',    border: 'border-amber-200' },
    green: { bg: 'bg-emerald-50 hover:bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  }
  const p = palettes[tone]
  return (
    <button onClick={onClick} className={`flex-shrink-0 ${p.bg} border ${p.border} rounded-xl px-4 py-3 transition-colors text-left min-w-[120px]`}>
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <span className={`text-[11px] font-semibold uppercase tracking-wider ${p.text}`}>{label}</span>
      </div>
      <p className={`text-[20px] font-bold mt-1 tabular-nums ${p.text}`}>{count}<span className="text-[11px] ml-1 opacity-70">건</span></p>
    </button>
  )
}

function FlowArrow() {
  return <span className="text-zinc-300 text-xl flex-shrink-0">→</span>
}

function QuickAction({ icon, label, desc, onClick, tint }: { icon: string; label: string; desc: string; onClick: () => void; tint?: 'blue'|'green'|'amber'|'violet' }) {
  const tints = {
    blue: 'hover:border-blue-400 hover:bg-blue-50/60',
    green: 'hover:border-emerald-400 hover:bg-emerald-50/60',
    amber: 'hover:border-amber-400 hover:bg-amber-50/60',
    violet: 'hover:border-violet-400 hover:bg-violet-50/60',
  }
  return (
    <button onClick={onClick} className={`bg-white border border-zinc-200 rounded-2xl p-4 text-left transition-colors ${tint ? tints[tint] : 'hover:border-zinc-400'}`}>
      <div className="text-2xl mb-2">{icon}</div>
      <p className="text-[13px] font-semibold text-zinc-900">{label}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5">{desc}</p>
    </button>
  )
}

function SummaryDrawer({ type, invoices, incomings, incomingItemsMap, vendorMap, onClose }: {
  type: SummaryType; invoices: Invoice[]; incomings: Incoming[]; incomingItemsMap: Map<string, number>; vendorMap: Map<string, string>; onClose: () => void
}) {
  const navigate = useNavigate()
  if (!type) return null
  const today = new Date()
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const lastMonthDate = new Date(today.getFullYear(), today.getMonth() - 1, 1)
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`
  const thisYear = String(today.getFullYear())
  const thisMonthInc = `${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, '0')}`

  let title = '', content: React.ReactNode = null
  if (type === 'this_month_revenue' || type === 'last_month_revenue' || type === 'ytd_revenue') {
    const prefix = type === 'this_month_revenue' ? thisMonth : type === 'last_month_revenue' ? lastMonth : thisYear
    const filtered = invoices.filter(i => i.issue_date?.startsWith(prefix))
    const total = filtered.reduce((s, i) => s + Number(i.total || 0), 0)
    const byVendor = filtered.reduce<Record<string, { name: string; count: number; total: number }>>((acc, i) => {
      const name = vendorMap.get(i.vendor_id) || '—'
      if (!acc[i.vendor_id]) acc[i.vendor_id] = { name, count: 0, total: 0 }
      acc[i.vendor_id].count += 1
      acc[i.vendor_id].total += Number(i.total || 0)
      return acc
    }, {})
    title = type === 'this_month_revenue' ? `${thisMonth} 매출 요약` : type === 'last_month_revenue' ? `${lastMonth} 매출 요약` : `${thisYear}년 누적`
    content = (
      <>
        <div className="bg-zinc-900 text-white rounded-2xl p-5 mb-5">
          <p className="text-[11px] uppercase opacity-70">합계</p>
          <p className="text-[28px] font-bold tabular-nums mt-1">₩{total.toLocaleString()}</p>
          <p className="text-[12px] opacity-70 mt-1">{filtered.length}건</p>
        </div>
        {filtered.length === 0 ? <Empty icon="📭" title="없음" /> : (
          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-zinc-50"><tr><th className="px-3 py-2 text-left">거래처</th><th className="px-3 py-2 text-right">건수</th><th className="px-3 py-2 text-right">매출</th></tr></thead>
              <tbody>
                {Object.entries(byVendor).sort((a, b) => b[1].total - a[1].total).map(([id, v]) => (
                  <tr key={id} className="border-t border-zinc-100">
                    <td className="px-3 py-2"><Badge color="green">{v.name}</Badge></td>
                    <td className="px-3 py-2 text-right tabular-nums">{v.count}건</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">₩{v.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )
  } else {
    const filtered = incomings.filter(i => i.period === thisMonthInc)
    const totalQty = filtered.reduce((s, i) => s + (incomingItemsMap.get(i.id) || 0), 0)
    title = `${thisMonthInc} 입고 요약`
    content = (
      <>
        <div className="bg-zinc-900 text-white rounded-2xl p-5 mb-5">
          <p className="text-[11px] uppercase opacity-70">이번 달 입고</p>
          <p className="text-[28px] font-bold tabular-nums mt-1">{totalQty.toLocaleString()}장</p>
          <p className="text-[12px] opacity-70 mt-1">{filtered.length}건</p>
        </div>
        {filtered.length === 0 ? <Empty icon="📦" title="없음" /> : (
          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-zinc-50"><tr><th className="px-3 py-2 text-left">기간</th><th className="px-3 py-2 text-left">거래처</th><th className="px-3 py-2 text-right">수량</th></tr></thead>
              <tbody>
                {filtered.map(i => (
                  <tr key={i.id} className="border-t border-zinc-100">
                    <td className="px-3 py-2 tabular-nums">{i.period}</td>
                    <td className="px-3 py-2">{vendorMap.get(i.vendor_id) || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-medium">{(incomingItemsMap.get(i.id) || 0).toLocaleString()}장</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )
  }
  return <Drawer open={!!type} onClose={onClose} title={title} width="lg">{content}</Drawer>
}
