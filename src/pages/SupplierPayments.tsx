import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor, Product, CostItem, Incoming, IncomingItem } from '@/lib/types'
import { Button, Input, Select, PageHeader, Drawer, Empty, Badge } from '@/components/ui'
import { exportSheet, exportMultiSheet, rowsToSheet } from '@/lib/exportXlsx'

/* ────────────────────────────────────────────────
 * 공급처 정산
 * 입고수량 × (원가계산서 단가 × 요척) = 공급처별 지급 금액 자동 계산
 *
 * 흐름:
 *   incoming_items → product_id, total_quantity
 *   cost_items     → product_id 별 (supplier_id, subtotal=단가×요척)
 *   결합           → quantity × subtotal = 공급처에 지급할 금액
 *   집계           → supplier별 합산
 *
 * 필터: 기간 (이번달/지난달/사용자), 카테고리 (전체/원단/공임/...)
 * ──────────────────────────────────────────────── */

const CATEGORIES = [
  { label: '전체', value: 'all' },
  { label: '원단', value: '원단' },
  { label: '립', value: '립' },
  { label: '나염/프린트', value: '나염/프린트' },
  { label: '자수', value: '자수' },
  { label: '부자재', value: '부자재' },
  { label: '워싱', value: '워싱' },
  { label: '라벨', value: '라벨' },
  { label: '공임', value: '공임' },
  { label: '포장', value: '포장' },
  { label: '기타', value: '기타' },
]

function getCategory(memo: string | null): string {
  if (!memo) return '기타'
  const m = memo.match(/^\[([^\]]+)\]/)
  return m ? m[1] : '기타'
}

type Period = 'thisMonth' | 'lastMonth' | 'thisYear' | 'all' | 'custom'

interface SupplierTotal {
  supplier_id: string
  supplier_name: string
  category: string
  totalAmount: number
  totalQty: number
  productCount: number
  // 상품별 세부
  items: {
    product_id: string
    product_code: string
    product_name: string
    quantity: number
    unitCost: number   // 벌당 원가 (단가 × 요척)
    yards: number
    amount: number
    item_name: string  // 재료명 (예: '20수싱글' or '공임')
  }[]
}

export default function SupplierPayments() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [costItems, setCostItems] = useState<CostItem[]>([])
  const [incomings, setIncomings] = useState<Incoming[]>([])
  const [items, setItems] = useState<IncomingItem[]>([])
  const [loading, setLoading] = useState(true)

  const [period, setPeriod] = useState<Period>('thisMonth')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [detailSupplier, setDetailSupplier] = useState<SupplierTotal | null>(null)

  useEffect(() => {
    (async () => {
      setLoading(true)
      const [{ data: vData }, { data: pData }, { data: cData }, { data: iData }, { data: itData }] = await Promise.all([
        supabase.from('vendors').select('*'),
        supabase.from('products').select('*'),
        supabase.from('cost_items').select('*'),
        supabase.from('incoming').select('*').order('created_at', { ascending: false }),
        supabase.from('incoming_items').select('*'),
      ])
      setVendors((vData ?? []) as Vendor[])
      setProducts((pData ?? []) as Product[])
      setCostItems((cData ?? []) as CostItem[])
      setIncomings((iData ?? []) as Incoming[])
      setItems((itData ?? []) as IncomingItem[])
      setLoading(false)
    })()
  }, [])

  // 빠른 조회용 맵
  const vendorById = useMemo(() => new Map(vendors.map(v => [v.id, v])), [vendors])
  const productById = useMemo(() => new Map(products.map(p => [p.id, p])), [products])
  const costItemsByProduct = useMemo(() => {
    const m = new Map<string, CostItem[]>()
    costItems.forEach(c => {
      const arr = m.get(c.product_id) || []
      arr.push(c)
      m.set(c.product_id, arr)
    })
    return m
  }, [costItems])
  const incomingById = useMemo(() => new Map(incomings.map(i => [i.id, i])), [incomings])

  // 기간 필터링 — incoming.period (YYYY.MM) 기준
  function periodMatches(inc: Incoming): boolean {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    const thisMonth = `${y}.${String(m).padStart(2, '0')}`
    const lastDate = new Date(y, m - 2, 1)
    const lastMonth = `${lastDate.getFullYear()}.${String(lastDate.getMonth() + 1).padStart(2, '0')}`
    const thisYear = String(y)

    if (period === 'all') return true
    if (period === 'thisMonth') return inc.period === thisMonth
    if (period === 'lastMonth') return inc.period === lastMonth
    if (period === 'thisYear') return inc.period?.startsWith(thisYear) ?? false
    if (period === 'custom') {
      if (!customFrom && !customTo) return true
      // period는 YYYY.MM 형식, customFrom/To는 YYYY-MM-DD
      const normalized = inc.period ? inc.period.replace('.', '-') + '-01' : ''
      if (customFrom && normalized < customFrom) return false
      if (customTo && normalized > customTo) return false
      return true
    }
    return true
  }

  // 핵심 집계
  const supplierTotals = useMemo<SupplierTotal[]>(() => {
    const filteredIncIds = new Set(incomings.filter(periodMatches).map(i => i.id))
    const filteredItems = items.filter(it => filteredIncIds.has(it.incoming_id) && it.product_id && it.total_quantity > 0)

    // supplier_id → SupplierTotal
    const map = new Map<string, SupplierTotal>()
    const productSets = new Map<string, Set<string>>()

    filteredItems.forEach(it => {
      const pid = it.product_id!
      const qty = it.total_quantity
      const product = productById.get(pid)
      const costs = costItemsByProduct.get(pid) || []

      costs.forEach(c => {
        if (!c.supplier_id) return
        const supplier = vendorById.get(c.supplier_id)
        if (!supplier) return
        const cat = getCategory(supplier.memo)
        if (categoryFilter !== 'all' && cat !== categoryFilter) return

        const unitCost = Number(c.subtotal || 0)
        const amount = unitCost * qty

        if (!map.has(c.supplier_id)) {
          map.set(c.supplier_id, {
            supplier_id: c.supplier_id,
            supplier_name: supplier.name,
            category: cat,
            totalAmount: 0,
            totalQty: 0,
            productCount: 0,
            items: [],
          })
          productSets.set(c.supplier_id, new Set())
        }
        const st = map.get(c.supplier_id)!
        st.totalAmount += amount
        st.totalQty += qty
        productSets.get(c.supplier_id)!.add(pid)
        st.items.push({
          product_id: pid,
          product_code: product?.code || '',
          product_name: product?.name || '—',
          quantity: qty,
          unitCost,
          yards: Number(c.yards || 0),
          amount,
          item_name: c.item_name,
        })
      })
    })

    map.forEach((st, sid) => { st.productCount = productSets.get(sid)?.size || 0 })
    return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount)
  }, [items, incomings, costItems, vendors, products, period, customFrom, customTo, categoryFilter, vendorById, productById, costItemsByProduct])

  // 카테고리별 합계 (상단 카드)
  const byCategoryTotal = useMemo(() => {
    const m = new Map<string, number>()
    supplierTotals.forEach(st => m.set(st.category, (m.get(st.category) || 0) + st.totalAmount))
    return m
  }, [supplierTotals])

  const grandTotal = supplierTotals.reduce((s, x) => s + x.totalAmount, 0)
  const totalSuppliers = supplierTotals.length
  const totalIncomingCount = incomings.filter(periodMatches).length

  function handleExport() {
    if (supplierTotals.length === 0) return alert('내보낼 정산 내역이 없어요.')
    // 시트1: 공급처 요약
    const summary = rowsToSheet(supplierTotals as any[], [
      { key: 'supplier_name', label: '공급처' },
      { key: 'category', label: '분류' },
      { key: 'productCount', label: '관련 상품수' },
      { key: 'totalQty', label: '입고 합계(장)' },
      { key: 'totalAmount', label: '정산 금액(원)', format: (v: number) => Math.round(v) },
    ])
    summary.push(['합계', '', '', supplierTotals.reduce((s, x) => s + x.totalQty, 0), Math.round(grandTotal)])

    // 시트2: 라인별 상세
    const detail: any[][] = [['공급처','분류','상품','품번','재료명','입고수량','벌당원가','요척','정산금액']]
    supplierTotals.forEach(st => {
      st.items.forEach(it => {
        detail.push([st.supplier_name, st.category, it.product_name, it.product_code, it.item_name,
                     it.quantity, Math.round(it.unitCost), it.yards, Math.round(it.amount)])
      })
    })
    exportMultiSheet([
      { name: '공급처별_요약', rows: summary },
      { name: '라인별_상세', rows: detail },
    ], '공급처정산')
  }

  return (
    <div>
      <PageHeader
        title="공급처 정산"
        description="입고 수량 × 원가계산서 = 공급처별 지급해야 할 금액 자동 계산"
        action={
          <Button variant="secondary" onClick={handleExport} disabled={supplierTotals.length === 0}>
            📥 엑셀 내보내기
          </Button>
        }
      />

      {/* 기간 + 카테고리 필터 */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-4 mb-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">기간</div>
            <div className="flex flex-wrap gap-1">
              {([
                ['thisMonth','이번 달'],
                ['lastMonth','지난 달'],
                ['thisYear','올해'],
                ['all','전체'],
                ['custom','사용자 지정'],
              ] as [Period, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setPeriod(v)}
                  className={`px-3 py-1.5 rounded-md text-[12px] font-medium border ${
                    period === v ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200'
                  }`}>{label}</button>
              ))}
            </div>
          </div>

          {period === 'custom' && (
            <div className="flex gap-2 items-end">
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">부터</div>
                <Input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">까지</div>
                <Input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
              </div>
            </div>
          )}

          <div className="flex-1 min-w-[200px]">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-1.5">분류 필터</div>
            <Select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </div>
        </div>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="정산 합계" value={`₩${grandTotal.toLocaleString()}`} hint={`${supplierTotals.reduce((s, x) => s + x.totalQty, 0).toLocaleString()}장 기준`} />
        <StatCard label="대상 공급처" value={`${totalSuppliers}곳`} hint={categoryFilter === 'all' ? '전체 분류' : categoryFilter} />
        <StatCard label="입고 건수" value={`${totalIncomingCount}건`} hint="선택 기간 내" />
        <StatCard label="원단" value={`₩${(byCategoryTotal.get('원단') || 0).toLocaleString()}`} hint="요척 검증용" />
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
        ) : supplierTotals.length === 0 ? (
          <Empty icon="📊" title="해당 기간에 정산할 내역이 없어요" description="원가계산서와 입고내역서가 등록되어 있어야 자동 집계돼요." />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500 border-b border-zinc-100">
                <th className="px-4 py-3">공급처</th>
                <th className="px-4 py-3">분류</th>
                <th className="px-4 py-3 text-right">상품수</th>
                <th className="px-4 py-3 text-right">입고 합계</th>
                <th className="px-4 py-3 text-right">정산 금액</th>
                <th className="px-4 py-3 text-right">상세</th>
              </tr>
            </thead>
            <tbody>
              {supplierTotals.map(st => (
                <tr key={st.supplier_id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                  <td className="px-4 py-3 font-medium text-zinc-900">
                    <button onClick={() => setDetailSupplier(st)} className="hover:underline">{st.supplier_name}</button>
                  </td>
                  <td className="px-4 py-3"><Badge color={categoryColor(st.category)}>{st.category}</Badge></td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{st.productCount}개</td>
                  <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{st.totalQty.toLocaleString()}장</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums">₩{Math.round(st.totalAmount).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => setDetailSupplier(st)}>상세 보기</Button>
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
                <td className="px-4 py-3" colSpan={3}>합계 ({supplierTotals.length}곳)</td>
                <td className="px-4 py-3 text-right tabular-nums">{supplierTotals.reduce((s, x) => s + x.totalQty, 0).toLocaleString()}장</td>
                <td className="px-4 py-3 text-right tabular-nums">₩{Math.round(grandTotal).toLocaleString()}</td>
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </div>

      <DetailDrawer supplier={detailSupplier} onClose={() => setDetailSupplier(null)} incomingById={incomingById} />
    </div>
  )
}

function categoryColor(cat: string): 'blue' | 'amber' | 'violet' | 'rose' | 'green' | 'zinc' {
  return cat === '원단' ? 'blue'
    : cat === '립' ? 'amber'
    : cat === '나염/프린트' ? 'violet'
    : cat === '자수' ? 'rose'
    : cat === '워싱' ? 'blue'
    : cat === '공임' ? 'green'
    : 'zinc'
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

function DetailDrawer({ supplier, onClose, incomingById }: {
  supplier: SupplierTotal | null
  onClose: () => void
  incomingById: Map<string, Incoming>
}) {
  if (!supplier) return null
  // 같은 상품 합쳐서 보여주기
  const byProduct = new Map<string, { name: string; code: string; item_name: string; qty: number; unitCost: number; yards: number; amount: number }>()
  supplier.items.forEach(it => {
    const key = it.product_id
    if (!byProduct.has(key)) byProduct.set(key, { name: it.product_name, code: it.product_code, item_name: it.item_name, qty: 0, unitCost: it.unitCost, yards: it.yards, amount: 0 })
    const x = byProduct.get(key)!
    x.qty += it.quantity
    x.amount += it.amount
  })
  const products = Array.from(byProduct.values()).sort((a, b) => b.amount - a.amount)

  return (
    <Drawer
      open={!!supplier}
      onClose={onClose}
      title={`${supplier.supplier_name} · 정산 상세`}
      width="lg"
    >
      <div className="bg-zinc-50 rounded-xl p-4 mb-5">
        <div className="flex items-center gap-2 mb-2">
          <Badge color={categoryColor(supplier.category)}>{supplier.category}</Badge>
          <span className="text-[12px] text-zinc-500">{supplier.productCount}개 상품 · {supplier.totalQty.toLocaleString()}장</span>
        </div>
        <div className="text-[24px] font-bold text-zinc-900 tabular-nums">
          ₩{Math.round(supplier.totalAmount).toLocaleString()}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">이 기간 지급해야 할 총 금액</p>
      </div>

      <h3 className="text-[13px] font-semibold text-zinc-900 mb-2">상품별 내역</h3>
      <div className="border border-zinc-200 rounded-xl overflow-hidden">
        <table className="w-full text-[12px]">
          <thead className="bg-zinc-50">
            <tr>
              <th className="px-3 py-2 text-left">상품</th>
              <th className="px-3 py-2 text-left">재료/항목</th>
              <th className="px-3 py-2 text-right">수량(장)</th>
              <th className="px-3 py-2 text-right">요척</th>
              <th className="px-3 py-2 text-right">벌당</th>
              <th className="px-3 py-2 text-right">금액</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p, i) => (
              <tr key={i} className="border-t border-zinc-100">
                <td className="px-3 py-2 text-zinc-800">
                  <div className="font-medium">{p.name}</div>
                  {p.code && <div className="text-[10px] text-zinc-500">{p.code}</div>}
                </td>
                <td className="px-3 py-2 text-zinc-600">{p.item_name}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.qty.toLocaleString()}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.yards.toFixed(2)}</td>
                <td className="px-3 py-2 text-right tabular-nums">₩{Math.round(p.unitCost).toLocaleString()}</td>
                <td className="px-3 py-2 text-right font-medium tabular-nums">₩{Math.round(p.amount).toLocaleString()}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-zinc-300 bg-zinc-50 font-semibold">
              <td className="px-3 py-2" colSpan={5}>합계</td>
              <td className="px-3 py-2 text-right tabular-nums">₩{Math.round(supplier.totalAmount).toLocaleString()}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-zinc-500 mt-4">
        ※ 원단의 경우 요척 × 수량으로 실제 사용량 확인 가능 (벌당 원가 = 단가 × 요척)
      </p>
    </Drawer>
  )
}
