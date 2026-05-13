import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Product, Vendor, CostItem } from '@/lib/types'
import { Button, Input, Select, InlineInput, PageHeader, Empty, Badge } from '@/components/ui'
import SupplierPicker from '@/components/SupplierPicker'

export default function CostBreakdown() {
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Vendor[]>([])
  const [customers, setCustomers] = useState<Vendor[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [items, setItems] = useState<CostItem[]>([])
  const [loading, setLoading] = useState(true)
  const [productSearch, setProductSearch] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())

  async function loadAll() {
    setLoading(true)
    const [{ data: pData }, { data: sData }, { data: cData }] = await Promise.all([
      supabase.from('products').select('*').order('name'),
      supabase.from('vendors').select('*').eq('vendor_type', 'supplier').order('name'),
      supabase.from('vendors').select('*').eq('vendor_type', 'customer').order('name'),
    ])
    setProducts(pData ?? [])
    setSuppliers(sData ?? [])
    setCustomers(cData ?? [])
    setLoading(false)
  }

  function toggleGroup(key: string) {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  async function loadItems(productId: string) {
    const { data } = await supabase
      .from('cost_items')
      .select('*')
      .eq('product_id', productId)
      .order('sort_order')
    setItems(data ?? [])
  }

  useEffect(() => { loadAll() }, [])
  // 자동으로 첫 상품 선택
  useEffect(() => {
    if (!selectedId && products.length > 0) {
      setSelectedId(products[0].id)
    }
  }, [products, selectedId])
  useEffect(() => {
    if (selectedId) loadItems(selectedId)
    else setItems([])
  }, [selectedId])

  const selectedProduct = products.find(p => p.id === selectedId) || null
  const productionCost = items.reduce((sum, i) => sum + Number(i.subtotal || 0), 0)
  const margin = (selectedProduct?.selling_price || 0) - productionCost
  const marginRate = selectedProduct?.selling_price ? (margin / selectedProduct.selling_price) * 100 : 0

  async function addItem(supplierId?: string | null) {
    if (!selectedId) return
    const { error } = await supabase.from('cost_items').insert({
      product_id: selectedId,
      supplier_id: supplierId || null,
      item_name: '신규 항목',
      unit_price: 0,
      yards: 0,
      sort_order: items.length,
    })
    if (error) return alert('추가 실패: ' + error.message)
    loadItems(selectedId)
  }

  async function updateItem(id: string, patch: Partial<CostItem>) {
    const { error } = await supabase.from('cost_items').update(patch).eq('id', id)
    if (error) return alert('수정 실패: ' + error.message)
    loadItems(selectedId)
  }

  async function deleteItem(id: string) {
    if (!confirm('이 항목을 삭제할까요?')) return
    await supabase.from('cost_items').delete().eq('id', id)
    loadItems(selectedId)
  }

  const filteredProducts = products.filter(p =>
    !productSearch ||
    p.name.toLowerCase().includes(productSearch.toLowerCase()) ||
    p.code.toLowerCase().includes(productSearch.toLowerCase())
  )

  // 공급처별로 그룹핑
  const supplierGroups = items.reduce<Record<string, { supplier: Vendor | null; items: CostItem[] }>>((acc, item) => {
    const key = item.supplier_id || '__unset__'
    if (!acc[key]) {
      acc[key] = {
        supplier: suppliers.find(s => s.id === item.supplier_id) || null,
        items: [],
      }
    }
    acc[key].items.push(item)
    return acc
  }, {})

  return (
    <div>
      <PageHeader
        title="원가계산서"
        description="상품별 재료 항목을 입력하면 생산원가와 마진이 자동 계산됩니다. 재료마다 다른 공급처를 지정할 수 있어요."
      />

      {loading ? (
        <div className="bg-white border border-zinc-200 rounded-2xl p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
      ) : products.length === 0 ? (
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
          <Empty icon="👕" title="먼저 상품을 등록해주세요" description="상품 관리 메뉴에서 상품을 등록한 뒤 이곳에서 원가를 입력할 수 있어요." />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* 좌측 상품 목록 */}
          <aside className="lg:col-span-3 bg-white border border-zinc-200 rounded-2xl overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 200px)' }}>
            <div className="p-3 border-b border-zinc-100">
              <Input value={productSearch} onChange={e => setProductSearch(e.target.value)} />
            </div>
            <div className="flex-1 overflow-y-auto">
              {(() => {
                const vendorName = (id: string) => customers.find(c => c.id === id)?.name || '거래처 미지정'
                type ByBrand = Record<string, Product[]>
                type ByVendor = Record<string, ByBrand>
                const grouped: ByVendor = {}
                for (const p of filteredProducts) {
                  const v = vendorName(p.vendor_id)
                  const b = p.brand || ''
                  if (!grouped[v]) grouped[v] = {}
                  if (!grouped[v][b]) grouped[v][b] = []
                  grouped[v][b].push(p)
                }
                const vendorKeys = Object.keys(grouped).sort()
                if (vendorKeys.length === 0) {
                  return <div className="p-6 text-center text-[12px] text-zinc-400">검색 결과 없음</div>
                }
                return vendorKeys.map(vName => {
                  const brands = grouped[vName]
                  const brandKeys = Object.keys(brands).sort()
                  const vendorTotal = brandKeys.reduce((s, b) => s + brands[b].length, 0)
                  const onlyBrand = brandKeys.length === 1 ? brandKeys[0] : null
                  return (
                    <div key={vName}>
                      {/* 회사 헤더 */}
                      <div className="sticky top-0 z-[1] px-3 py-2.5 bg-gradient-to-r from-zinc-900 to-zinc-800 text-white flex items-center justify-between border-b border-zinc-700">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-6 h-6 rounded-full bg-white/15 flex items-center justify-center text-[11px] font-bold flex-shrink-0">
                            {vName.slice(0, 1)}
                          </div>
                          <span className="font-semibold text-[13px] truncate">{vName}</span>
                          {onlyBrand && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/15 text-white/90 font-medium flex-shrink-0">
                              {onlyBrand}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] tabular-nums text-white/60 flex-shrink-0">{vendorTotal}</span>
                      </div>
                      {/* 브랜드별 상품 */}
                      {brandKeys.map(bName => {
                        const list = brands[bName]
                        const showBrandSep = brandKeys.length > 1
                        return (
                          <div key={bName}>
                            {showBrandSep && (
                              <div className="px-3 py-1.5 bg-zinc-50 border-b border-zinc-100 flex items-center gap-1.5">
                                <span className="inline-block w-1 h-3 rounded-full bg-blue-400" />
                                <span className="text-[11px] font-semibold text-zinc-700">{bName || '(브랜드 없음)'}</span>
                                <span className="text-[10px] text-zinc-400 ml-auto tabular-nums">{list.length}</span>
                              </div>
                            )}
                            {list.map(p => (
                              <button
                                key={p.id}
                                onClick={() => setSelectedId(p.id)}
                                className={`group w-full text-left px-3 py-2.5 border-b border-zinc-50 transition-colors relative ${
                                  selectedId === p.id
                                    ? 'bg-zinc-900 text-white'
                                    : 'hover:bg-blue-50/60'
                                }`}
                              >
                                {selectedId === p.id && <span className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400" />}
                                <div className={`text-[10px] font-mono truncate ${selectedId === p.id ? 'text-blue-300' : 'text-zinc-400'}`}>
                                  {p.code}
                                </div>
                                <div className="text-[12.5px] font-medium truncate leading-tight mt-0.5">{p.name}</div>
                                {(p.color || p.name_en) && (
                                  <div className={`text-[10px] mt-0.5 truncate ${selectedId === p.id ? 'text-zinc-400' : 'text-zinc-500'}`}>
                                    {p.color}{p.color && p.name_en ? ' · ' : ''}{p.name_en}
                                  </div>
                                )}
                              </button>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )
                })
              })()}
            </div>
          </aside>

          {/* 우측 원가 입력 */}
          <div className="lg:col-span-9">
            {!selectedProduct ? (
              <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
                <Empty icon="←" title="좌측에서 상품을 선택하세요" description="상품을 선택하면 원가 항목을 입력할 수 있습니다." />
              </div>
            ) : (
              <>
                {/* 요약 카드 */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <SummaryCard label="판매가" value={`₩${(selectedProduct.selling_price || 0).toLocaleString()}`} hint="상품에서 수정" />
                  <SummaryCard label="생산원가" value={`₩${productionCost.toLocaleString()}`} hint={`재료 ${items.length}건`} />
                  <SummaryCard
                    label={`마진 ${marginRate ? `(${marginRate.toFixed(1)}%)` : ''}`}
                    value={`₩${margin.toLocaleString()}`}
                    hint="판매가 − 원가"
                    highlight={margin > 0 ? 'green' : margin < 0 ? 'rose' : 'zinc'}
                  />
                </div>

                {/* 공급처별 재료 그룹 */}
                <div className="space-y-3">
                  {Object.entries(supplierGroups).map(([supplierId, group]) => {
                    const groupTotal = group.items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
                    return (
                      <div key={supplierId} className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
                        {/* 공급처 헤더 */}
                        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {group.supplier ? (
                              <>
                                <Badge color="blue">{group.supplier.name}</Badge>
                                {group.supplier.phone && (
                                  <a href={`tel:${group.supplier.phone}`} className="text-[11px] text-blue-600 hover:underline">📞 {group.supplier.phone}</a>
                                )}
                              </>
                            ) : (
                              <Badge color="amber">⚠ 공급처 미지정</Badge>
                            )}
                            <span className="text-[11px] text-zinc-500">{group.items.length}건</span>
                          </div>
                          <span className="text-[12px] tabular-nums">
                            소계 <span className="font-semibold">₩{Math.round(groupTotal).toLocaleString()}</span>
                          </span>
                        </div>

                        {/* 재료 라인들 */}
                        <div className="overflow-x-auto">
                          <table className="w-full text-[13px] min-w-[600px]">
                            <thead>
                              <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
                                <th className="px-3 py-2">공급처</th>
                                <th className="px-3 py-2">재료/항목명</th>
                                <th className="px-3 py-2 text-right w-28">단가</th>
                                <th className="px-3 py-2 text-right w-20">요척</th>
                                <th className="px-3 py-2 text-right w-28">소계</th>
                                <th className="px-3 py-2 w-10"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.map(item => (
                                <tr key={item.id} className="border-t border-zinc-100">
                                  <td className="px-2 py-1.5">
                                    <SupplierPicker
                                      value={item.supplier_id}
                                      suppliers={suppliers}
                                      onChange={(id) => updateItem(item.id, { supplier_id: id })}
                                      onSuppliersChanged={loadAll}
                                      className="text-[12px] px-2 py-1.5"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <InlineInput
                                      value={item.item_name}
                                      onCommit={(v) => updateItem(item.id, { item_name: v })}
                                      className="text-[12px] px-2 py-1.5"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <InlineInput
                                      type="number"
                                      value={item.unit_price}
                                      onCommit={(v) => updateItem(item.id, { unit_price: Number(v) })}
                                      className="text-[12px] text-right tabular-nums px-2 py-1.5"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">
                                    <InlineInput
                                      type="number"
                                      step="0.01"
                                      value={item.yards}
                                      onCommit={(v) => updateItem(item.id, { yards: Number(v) })}
                                      className="text-[12px] text-right tabular-nums px-2 py-1.5"
                                    />
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                                    ₩{Math.round(Number(item.subtotal) || 0).toLocaleString()}
                                  </td>
                                  <td className="px-1 py-1.5 text-center">
                                    <button onClick={() => deleteItem(item.id)} className="text-rose-500 hover:text-rose-700 text-lg w-8 h-8">×</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="mt-4 bg-white border border-dashed border-zinc-300 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <p className="text-[13px] font-medium text-zinc-700">재료/공임 항목 추가</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">새 재료를 추가하세요.</p>
                  </div>
                  <Button onClick={() => addItem(null)}>＋ 항목 추가</Button>
                </div>

                <div className="mt-3 bg-zinc-900 text-white rounded-2xl px-5 py-3 flex items-center justify-between">
                  <span className="text-[14px]">생산원가 합계</span>
                  <span className="text-[18px] font-bold tabular-nums">₩{Math.round(productionCost).toLocaleString()}</span>
                </div>
                <p className="text-[11px] text-zinc-400 mt-2">💡 같은 재료라도 공급처가 다르면 별도 항목으로 추가하세요.</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SummaryCard({ label, value, hint, highlight = 'zinc' }: {
  label: string; value: string; hint: string; highlight?: 'zinc' | 'green' | 'rose'
}) {
  const colors = { zinc: 'text-zinc-900', green: 'text-emerald-700', rose: 'text-rose-700' }
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`text-[20px] font-bold mt-1 tabular-nums ${colors[highlight]}`}>{value}</p>
      <p className="text-[11px] text-zinc-400 mt-0.5">{hint}</p>
    </div>
  )
}
