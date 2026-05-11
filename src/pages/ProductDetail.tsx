import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Product, Vendor, CostItem, FabricUsage, IncomingItem, Incoming, InvoiceItem, Invoice } from '@/lib/types'
import { Button, PageHeader, Badge, Empty } from '@/components/ui'

interface CostItemWithSupplier extends CostItem {
  supplier?: Vendor
}

interface IncomingHistoryItem {
  incoming_id: string
  delivery_date: string | null
  carton_no: number | null
  sizes: Record<string, number>
  total_quantity: number
  period: string | null
  vendor_name: string
}

interface SalesHistoryItem {
  invoice_id: string
  issue_date: string
  vendor_name: string
  quantity: number
  unit_price: number
  amount: number
}

export default function ProductDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [customer, setCustomer] = useState<Vendor | null>(null)
  const [costItems, setCostItems] = useState<CostItemWithSupplier[]>([])
  const [fabric, setFabric] = useState<FabricUsage[]>([])
  const [incomingHistory, setIncomingHistory] = useState<IncomingHistoryItem[]>([])
  const [salesHistory, setSalesHistory] = useState<SalesHistoryItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [id])

  async function load() {
    if (!id) return
    setLoading(true)

    const { data: p } = await supabase.from('products').select('*').eq('id', id).single()
    if (!p) { setLoading(false); return }
    setProduct(p)

    const [
      { data: cust },
      { data: cItems },
      { data: fItems },
      { data: incItems },
      { data: invItems },
    ] = await Promise.all([
      supabase.from('vendors').select('*').eq('id', p.vendor_id).single(),
      supabase.from('cost_items').select('*, supplier:vendors(*)').eq('product_id', id).order('sort_order'),
      supabase.from('fabric_usage').select('*').eq('product_id', id).order('created_at'),
      supabase.from('incoming_items').select('*, incoming:incoming(period, vendor_id, vendors:vendors(name))').eq('product_id', id),
      supabase.from('invoice_items').select('*, invoice:invoices(issue_date, vendor_id, vendors:vendors(name))').eq('product_id', id),
    ])
    setCustomer(cust)
    setCostItems(cItems ?? [])
    setFabric(fItems ?? [])

    const incHistory: IncomingHistoryItem[] = (incItems ?? []).map((it: any) => ({
      incoming_id: it.incoming_id,
      delivery_date: it.delivery_date,
      carton_no: it.carton_no,
      sizes: it.sizes || {},
      total_quantity: Number(it.total_quantity || 0),
      period: it.incoming?.period,
      vendor_name: it.incoming?.vendors?.name || '—',
    })).sort((a: any, b: any) => (b.delivery_date || '').localeCompare(a.delivery_date || ''))
    setIncomingHistory(incHistory)

    const salesHist: SalesHistoryItem[] = (invItems ?? []).map((it: any) => ({
      invoice_id: it.invoice_id,
      issue_date: it.invoice?.issue_date || '',
      vendor_name: it.invoice?.vendors?.name || '—',
      quantity: Number(it.quantity || 0),
      unit_price: Number(it.unit_price || 0),
      amount: Number(it.amount || 0),
    })).sort((a: any, b: any) => b.issue_date.localeCompare(a.issue_date))
    setSalesHistory(salesHist)

    setLoading(false)
  }

  if (loading) return (
    <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
  )

  if (!product) return (
    <div>
      <Empty icon="❌" title="상품을 찾을 수 없습니다" action={<Button onClick={() => navigate('/products')}>상품 목록으로</Button>} />
    </div>
  )

  // 계산
  const productionCost = costItems.reduce((s, c) => s + Number(c.subtotal || 0), 0)
  const margin = Number(product.selling_price || 0) - productionCost
  const marginRate = product.selling_price > 0 ? (margin / product.selling_price) * 100 : 0

  // 공급처별로 재료 묶기
  const supplierGroups = costItems.reduce<Record<string, { supplier: Vendor | undefined; items: CostItemWithSupplier[] }>>((acc, c) => {
    const key = c.supplier_id || 'unknown'
    if (!acc[key]) acc[key] = { supplier: c.supplier, items: [] }
    acc[key].items.push(c)
    return acc
  }, {})

  // 입고/판매 합계
  const totalIncoming = incomingHistory.reduce((s, i) => s + i.total_quantity, 0)
  const totalSold = salesHistory.reduce((s, i) => s + i.quantity, 0)
  const stock = totalIncoming - totalSold

  // 사이즈별 합계 (입고 - 판매)
  const sizeKeys: string[] = customer?.size_system || []

  function copyToClipboard(text: string) {
    navigator.clipboard?.writeText(text)
    alert('복사됨!')
  }

  function buildReorderSMS() {
    let text = `[리오더 요청] ${product?.name || ''}${product?.color ? ` (${product.color})` : ''}\n`
    text += `품번: ${product?.code}\n\n`
    Object.values(supplierGroups).forEach(g => {
      text += `📍 ${g.supplier?.name || '미지정'}${g.supplier?.phone ? ` (${g.supplier.phone})` : ''}\n`
      g.items.forEach(it => {
        text += `  - ${it.item_name}: 요척 ${it.yards} × 단가 ₩${Number(it.unit_price).toLocaleString()}\n`
      })
      text += '\n'
    })
    return text
  }

  return (
    <div>
      {/* 페이지 헤더 */}
      <div className="mb-4 flex items-center gap-2 text-[12px] text-zinc-500">
        <Link to="/products" className="hover:text-zinc-900">상품 관리</Link>
        <span>/</span>
        <span className="text-zinc-700">{product.code}</span>
      </div>

      <PageHeader
        title={product.name}
        description={`품번 ${product.code}${product.color ? ` · ${product.color}` : ''} · 거래처: ${customer?.name || '—'}`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => navigate('/cost')}>원가 편집</Button>
            <Button variant="secondary" onClick={() => copyToClipboard(buildReorderSMS())}>📋 리오더 메시지 복사</Button>
            <Button onClick={() => navigate('/products')}>← 목록</Button>
          </div>
        }
      />

      {/* 상단 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
        <StatCard label="판매가" value={`₩${Number(product.selling_price).toLocaleString()}`} hint={customer?.name || ''} />
        <StatCard label="생산원가" value={`₩${Math.round(productionCost).toLocaleString()}`} hint={`재료 ${costItems.length}건`} />
        <StatCard
          label="마진"
          value={`₩${Math.round(margin).toLocaleString()}`}
          hint={costItems.length > 0 ? `${marginRate.toFixed(1)}%` : '원가 미입력'}
          highlight={margin > 0 ? 'green' : margin < 0 ? 'rose' : 'zinc'}
        />
        <StatCard label="누적 입고" value={`${totalIncoming.toLocaleString()}장`} hint={`${incomingHistory.length}건`} />
        <StatCard label="누적 판매" value={`${totalSold.toLocaleString()}장`} hint={`재고 ${stock.toLocaleString()}장`} highlight={stock > 0 ? 'green' : 'rose'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 좌측: 공급처별 재료 (리오더용) */}
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold text-zinc-900">📦 리오더 체크리스트</h2>
              <p className="text-[11px] text-zinc-500 mt-0.5">공급처별 재료 + 요척 + 연락처</p>
            </div>
            <span className="text-[12px] text-zinc-500">{Object.keys(supplierGroups).length}개 공급처</span>
          </div>

          {Object.keys(supplierGroups).length === 0 ? (
            <Empty icon="📋" title="원가가 입력되지 않았어요" description="원가계산서에서 재료를 등록하면 여기에 표시돼요." action={<Button size="sm" onClick={() => navigate('/cost')}>원가 입력하기</Button>} />
          ) : (
            <div className="p-3 space-y-2">
              {Object.values(supplierGroups).map((g, idx) => (
                <div key={idx} className="border border-zinc-200 rounded-xl overflow-hidden">
                  {/* 공급처 헤더 */}
                  <div className="bg-zinc-50 px-3 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-[13px] text-zinc-900">
                        {g.supplier?.name || '⚠ 미지정 공급처'}
                      </span>
                      {g.supplier?.phone && (
                        <a href={`tel:${g.supplier.phone}`} className="text-[11px] text-blue-600 hover:underline">
                          📞 {g.supplier.phone}
                        </a>
                      )}
                      {g.supplier?.ceo_name && (
                        <span className="text-[11px] text-zinc-500">담당: {g.supplier.ceo_name}</span>
                      )}
                    </div>
                    <span className="text-[11px] text-zinc-500">{g.items.length}개 재료</span>
                  </div>

                  {/* 재료 라인들 */}
                  <table className="w-full text-[12px]">
                    <thead className="bg-white">
                      <tr className="text-left text-[10px] font-semibold uppercase text-zinc-500 border-t border-zinc-100">
                        <th className="px-3 py-1.5">재료</th>
                        <th className="px-3 py-1.5 text-right">단가</th>
                        <th className="px-3 py-1.5 text-right">요척</th>
                        <th className="px-3 py-1.5 text-right">소계</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map(it => (
                        <tr key={it.id} className="border-t border-zinc-100">
                          <td className="px-3 py-1.5 font-medium">{it.item_name}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">₩{Number(it.unit_price).toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Number(it.yards).toFixed(3)}</td>
                          <td className="px-3 py-1.5 text-right font-medium tabular-nums">₩{Math.round(Number(it.subtotal || 0)).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* 공급처별 합계 */}
                  <div className="bg-zinc-50 px-3 py-1.5 text-right text-[11px] border-t border-zinc-100">
                    <span className="text-zinc-500">소계: </span>
                    <span className="font-semibold tabular-nums text-zinc-900">
                      ₩{Math.round(g.items.reduce((s, i) => s + Number(i.subtotal || 0), 0)).toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}

              {/* 생산원가 합계 */}
              <div className="bg-zinc-900 text-white rounded-xl px-4 py-3 flex items-center justify-between">
                <span className="text-[13px]">생산원가 합계</span>
                <span className="text-[16px] font-bold tabular-nums">₩{Math.round(productionCost).toLocaleString()}</span>
              </div>
            </div>
          )}
        </div>

        {/* 우측: 실(원단) 입고 + 사이즈별 재고 */}
        <div className="space-y-4">
          {/* 실 입고 내역 */}
          <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h2 className="text-[15px] font-semibold text-zinc-900">🧵 실(원단) 입고 내역</h2>
                <p className="text-[11px] text-zinc-500 mt-0.5">컬러별 입고/재단/벌당 단가</p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => navigate('/fabric')}>편집 →</Button>
            </div>
            {fabric.length === 0 ? (
              <div className="p-6 text-center text-[12px] text-zinc-400">실 입고 내역이 없어요</div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="bg-zinc-50">
                  <tr className="text-[10px] font-semibold uppercase text-zinc-500">
                    <th className="px-3 py-2 text-left">컬러</th>
                    <th className="px-3 py-2 text-right">입고(yd)</th>
                    <th className="px-3 py-2 text-right">재단(벌)</th>
                    <th className="px-3 py-2 text-right">벌당</th>
                  </tr>
                </thead>
                <tbody>
                  {fabric.map(f => (
                    <tr key={f.id} className="border-t border-zinc-100">
                      <td className="px-3 py-1.5 font-medium">{f.color}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{Number(f.fabric_in).toFixed(2)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{f.cut_quantity}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">₩{Math.round(Number(f.cost_per_unit) || 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* 사이즈별 입고 vs 판매 (재고) */}
          {sizeKeys.length > 0 && (
            <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
              <div className="px-5 py-4 border-b border-zinc-100">
                <h2 className="text-[15px] font-semibold text-zinc-900">📊 사이즈별 현황</h2>
                <p className="text-[11px] text-zinc-500 mt-0.5">입고 - 판매 = 재고 (음수면 추가 입고 필요)</p>
              </div>
              <div className="p-4">
                <SizeStockTable
                  sizeKeys={sizeKeys}
                  incomingHistory={incomingHistory}
                  salesHistory={salesHistory}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 하단: 입고 이력 + 판매 이력 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
        {/* 입고 이력 */}
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-zinc-900">📦 입고 이력</h2>
            <span className="text-[12px] text-zinc-500">총 {totalIncoming.toLocaleString()}장</span>
          </div>
          {incomingHistory.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-zinc-400">입고 이력이 없어요</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr className="text-[10px] font-semibold uppercase text-zinc-500">
                    <th className="px-3 py-2 text-left">입고일</th>
                    <th className="px-3 py-2 text-left">거래처</th>
                    <th className="px-3 py-2 text-right">C/T</th>
                    <th className="px-3 py-2 text-right">수량</th>
                  </tr>
                </thead>
                <tbody>
                  {incomingHistory.map((h, i) => (
                    <tr key={i} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                      <td className="px-3 py-1.5 tabular-nums">{h.delivery_date || h.period || '—'}</td>
                      <td className="px-3 py-1.5"><Badge color="green">{h.vendor_name}</Badge></td>
                      <td className="px-3 py-1.5 text-right text-zinc-500">{h.carton_no || '—'}</td>
                      <td className="px-3 py-1.5 text-right font-medium tabular-nums">{h.total_quantity.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* 판매 이력 */}
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold text-zinc-900">🧾 판매 이력</h2>
            <span className="text-[12px] text-zinc-500">총 {totalSold.toLocaleString()}장 · ₩{salesHistory.reduce((s, h) => s + h.amount, 0).toLocaleString()}</span>
          </div>
          {salesHistory.length === 0 ? (
            <div className="p-6 text-center text-[12px] text-zinc-400">판매 이력이 없어요</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-[12px]">
                <thead className="bg-zinc-50 sticky top-0">
                  <tr className="text-[10px] font-semibold uppercase text-zinc-500">
                    <th className="px-3 py-2 text-left">발행일</th>
                    <th className="px-3 py-2 text-left">거래처</th>
                    <th className="px-3 py-2 text-right">수량</th>
                    <th className="px-3 py-2 text-right">단가</th>
                    <th className="px-3 py-2 text-right">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {salesHistory.map((h, i) => (
                    <tr key={i} className={`border-t border-zinc-100 hover:bg-zinc-50/50 ${h.quantity < 0 ? 'bg-rose-50/30' : ''}`}>
                      <td className="px-3 py-1.5 tabular-nums">{h.issue_date}</td>
                      <td className="px-3 py-1.5"><Badge color="green">{h.vendor_name}</Badge></td>
                      <td className={`px-3 py-1.5 text-right tabular-nums ${h.quantity < 0 ? 'text-rose-700' : ''}`}>{h.quantity.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">₩{h.unit_price.toLocaleString()}</td>
                      <td className={`px-3 py-1.5 text-right font-medium tabular-nums ${h.amount < 0 ? 'text-rose-700' : ''}`}>₩{h.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* 사이즈별 입고 vs 판매 표 */
function SizeStockTable({ sizeKeys, incomingHistory, salesHistory: _ }: {
  sizeKeys: string[]
  incomingHistory: IncomingHistoryItem[]
  salesHistory: SalesHistoryItem[]
}) {
  // 입고 사이즈 합계
  const incomingBySize: Record<string, number> = {}
  sizeKeys.forEach(s => incomingBySize[s] = 0)
  incomingHistory.forEach(h => {
    sizeKeys.forEach(s => {
      incomingBySize[s] += Number(h.sizes[s] || 0)
    })
  })

  // 판매 사이즈 합계는 invoice_items에 사이즈 정보가 없어서 계산 불가
  // 일단 입고만 표시 (추후 invoice_items에 사이즈 추가하면 비교 가능)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="text-[10px] font-semibold uppercase text-zinc-500 border-b border-zinc-100">
            <th className="px-2 py-1.5 text-left">사이즈</th>
            {sizeKeys.map(s => <th key={s} className="px-2 py-1.5 text-center">{s}</th>)}
            <th className="px-2 py-1.5 text-right">합계</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-zinc-100">
            <td className="px-2 py-1.5 font-medium">📦 입고</td>
            {sizeKeys.map(s => (
              <td key={s} className="px-2 py-1.5 text-center tabular-nums">{incomingBySize[s]}</td>
            ))}
            <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
              {Object.values(incomingBySize).reduce((s, v) => s + v, 0).toLocaleString()}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="text-[10px] text-zinc-400 mt-2">
        💡 계산서엔 사이즈 정보가 없어서 사이즈별 판매/재고는 별도 추적 안 됨. 입고 사이즈 분포 참고용.
      </p>
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
