import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Product, Vendor, CostItem } from '@/lib/types'
import { Button, Input, Select, InlineInput, PageHeader, Empty, Badge } from '@/components/ui'
import SupplierPicker from '@/components/SupplierPicker'

export default function CostBreakdown() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Vendor[]>([])
  const [customers, setCustomers] = useState<Vendor[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [items, setItems] = useState<CostItem[]>([])
  const [copyModalOpen, setCopyModalOpen] = useState(false)

  // 좌측 거래처/브랜드 접기 상태 (localStorage 저장)
  const COLLAPSE_KEY = 'cost_breakdown_collapsed'
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

  const [searchParams] = useSearchParams()
  const requestedProductId = searchParams.get('product')

  useEffect(() => { loadAll() }, [])
  // URL ?product=... 또는 첫 상품 자동 선택
  useEffect(() => {
    if (products.length === 0) return
    if (requestedProductId && products.find(p => p.id === requestedProductId)) {
      setSelectedId(requestedProductId)
    } else if (!selectedId) {
      setSelectedId(products[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, requestedProductId])
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
      item_name: '',
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

  /** 다른 상품의 cost_items를 복사 */
  async function copyFromProduct(sourceProductId: string, mode: 'replace' | 'append') {
    if (!selectedId || sourceProductId === selectedId) return
    const { data: sourceItems } = await supabase.from('cost_items')
      .select('*').eq('product_id', sourceProductId).order('sort_order')
    if (!sourceItems || sourceItems.length === 0) {
      alert('복사할 원가 항목이 없어요.')
      return
    }
    if (mode === 'replace') {
      await supabase.from('cost_items').delete().eq('product_id', selectedId)
    }
    const startSort = mode === 'append' ? items.length : 0
    const payload = sourceItems.map((it: any, i: number) => ({
      product_id: selectedId,
      supplier_id: it.supplier_id,
      item_name: it.item_name,
      unit_price: Number(it.unit_price || 0),
      yards: Number(it.yards || 0),
      sort_order: startSort + i,
    }))
    const { error } = await supabase.from('cost_items').insert(payload)
    if (error) return alert('복사 실패: ' + error.message)
    setCopyModalOpen(false)
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
              <Input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="🔍 품번 / 품목명 / 컬러" />
              <div className="flex items-center gap-2 mt-2 text-[10px]">
                <button
                  onClick={() => {
                    // 모든 거래처 키 모음
                    const vendorNames = Array.from(new Set(filteredProducts.map(p => customers.find(c => c.id === p.vendor_id)?.name || '거래처 미지정')))
                    collapseAll(vendorNames.map(v => `vendor:${v}`))
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                >▶ 모두 접기</button>
                <button
                  onClick={expandAll}
                  className="px-2 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                >▼ 모두 펼치기</button>
              </div>
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
                  const vendorKey = `vendor:${vName}`
                  const vendorCollapsed = collapsed.has(vendorKey)
                  return (
                    <div key={vName}>
                      {/* 회사 헤더 — 클릭하면 접기/펼치기 */}
                      <button
                        type="button"
                        onClick={() => toggleCollapse(vendorKey)}
                        className="sticky top-0 z-[1] w-full px-3 py-2.5 bg-gradient-to-r from-zinc-900 to-zinc-800 text-white flex items-center justify-between border-b border-zinc-700 hover:from-zinc-800 hover:to-zinc-700 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[10px] text-white/60 flex-shrink-0">{vendorCollapsed ? '▶' : '▼'}</span>
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
                      </button>
                      {/* 브랜드별 상품 — 거래처 펼침 상태일 때만 */}
                      {!vendorCollapsed && brandKeys.map(bName => {
                        const list = brands[bName]
                        const showBrandSep = brandKeys.length > 1
                        const brandKey = `brand:${vName}::${bName}`
                        const brandCollapsed = collapsed.has(brandKey)
                        return (
                          <div key={bName}>
                            {showBrandSep && (
                              <button
                                type="button"
                                onClick={() => toggleCollapse(brandKey)}
                                className="w-full px-3 py-1.5 bg-zinc-50 hover:bg-zinc-100 border-b border-zinc-100 flex items-center gap-1.5 transition-colors"
                              >
                                <span className="text-[9px] text-zinc-400">{brandCollapsed ? '▶' : '▼'}</span>
                                <span className="inline-block w-1 h-3 rounded-full bg-blue-400" />
                                <span className="text-[11px] font-semibold text-zinc-700">{bName || '(브랜드 없음)'}</span>
                                <span className="text-[10px] text-zinc-400 ml-auto tabular-nums">{list.length}</span>
                              </button>
                            )}
                            {(!showBrandSep || !brandCollapsed) && list.map(p => (
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
                {/* 선택 상품 헤더 + 빠른 이동 + 원가 복사 */}
                <div className="bg-white border border-zinc-200 rounded-2xl p-4 mb-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="text-[18px]">📦</span>
                    <div>
                      <p className="text-[15px] font-semibold text-zinc-900">{selectedProduct.name}</p>
                      <p className="text-[11px] text-zinc-500">{selectedProduct.code} {selectedProduct.color ? `· ${selectedProduct.color}` : ''}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        // 활성 input 강제 blur → 자동 저장 트리거
                        if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
                      }}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-medium whitespace-nowrap"
                      title="현재 수정 중인 칸 저장 (Enter 또는 다른 칸 클릭과 동일)"
                    >
                      💾 저장
                    </button>
                    <button
                      onClick={() => setCopyModalOpen(true)}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-medium whitespace-nowrap"
                      title="다른 상품의 원가를 그대로 가져오기"
                    >
                      📋 원가 복사
                    </button>
                    <button onClick={() => navigate(`/products/${selectedProduct.id}`)} className="text-[12px] text-blue-600 hover:underline whitespace-nowrap">
                      상품 상세 보기 →
                    </button>
                  </div>
                </div>

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
                                <th className="px-3 py-2 text-right w-36">단가</th>
                                <th className="px-3 py-2 text-right w-28">요척</th>
                                <th className="px-3 py-2 text-right w-32">소계</th>
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
                                      placeholder="재료/공정명 입력"
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

      {/* 원가 복사 모달 */}
      <CopyCostModal
        open={copyModalOpen}
        onClose={() => setCopyModalOpen(false)}
        currentProduct={selectedProduct}
        candidates={products.filter(p => p.id !== selectedId)}
        hasExisting={items.length > 0}
        onCopy={copyFromProduct}
      />
    </div>
  )
}

/* ─────────────────────────────────────────────
 * 원가 복사 모달 — 다른 상품 선택 → cost_items 복사
 * 같은 디자인 다른 칼라 / 비슷한 상품 입력 노가다 줄이기
 * ───────────────────────────────────────────── */
function CopyCostModal({ open, onClose, currentProduct, candidates, hasExisting, onCopy }: {
  open: boolean
  onClose: () => void
  currentProduct: Product | null
  candidates: Product[]
  hasExisting: boolean
  onCopy: (productId: string, mode: 'replace' | 'append') => void
}) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string>('')
  if (!open || !currentProduct) return null

  // 추천: 같은 거래처 + 같은 코드 prefix (DD26SMTS-009- 같은 거)
  const baseCode = (currentProduct.code || '').replace(/-[A-Z]{2,3}$/, '')   // 끝의 컬러 코드 제거
  const sameDesign = candidates.filter(p =>
    p.vendor_id === currentProduct.vendor_id &&
    p.code && (p.code.startsWith(baseCode) || p.name === currentProduct.name)
  )
  const others = candidates.filter(p => !sameDesign.includes(p))
  const filtered = search
    ? candidates.filter(p =>
        (p.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (p.code || '').toLowerCase().includes(search.toLowerCase())
      )
    : null
  const list = filtered || [...sameDesign, ...others]
  const selected = candidates.find(p => p.id === selectedId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-100">
          <h2 className="text-[16px] font-semibold text-zinc-900">📋 원가 복사</h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            <span className="font-semibold text-zinc-800">{currentProduct.name}</span> {currentProduct.color ? `(${currentProduct.color})` : ''}로 다른 상품의 원가 항목을 복사합니다.
          </p>
        </div>

        <div className="px-5 py-3 border-b border-zinc-100">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="다른 상품 이름/품번 검색" />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {list.length === 0 ? (
            <p className="text-[12px] text-zinc-400 text-center py-8">복사 가능한 상품이 없어요</p>
          ) : (
            <>
              {!filtered && sameDesign.length > 0 && (
                <div className="mb-2 inline-flex items-center gap-2 px-2 py-1 rounded bg-emerald-50 text-emerald-800 text-[10px] border border-emerald-200">
                  💡 같은 디자인 후보 {sameDesign.length}개 추천
                </div>
              )}
              <div className="space-y-1">
                {list.slice(0, 30).map(p => (
                  <button
                    key={p.id}
                    onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-colors ${
                      selectedId === p.id
                        ? 'bg-emerald-50 border-emerald-300'
                        : sameDesign.includes(p)
                          ? 'bg-emerald-50/40 border-emerald-100 hover:bg-emerald-50'
                          : 'bg-white border-zinc-200 hover:bg-zinc-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[13px] font-medium text-zinc-900 truncate">{p.name} {p.color && <span className="text-zinc-500">· {p.color}</span>}</p>
                        <p className="text-[11px] text-zinc-500 font-mono">{p.code}</p>
                      </div>
                      {selectedId === p.id && <span className="text-emerald-600 text-[14px] flex-shrink-0">✓</span>}
                    </div>
                  </button>
                ))}
                {list.length > 30 && (
                  <p className="text-[11px] text-zinc-400 text-center py-2">... 그 외 {list.length - 30}개 (검색으로 좁히세요)</p>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-zinc-100 flex items-center justify-between gap-2 flex-wrap">
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <div className="flex gap-2">
            {hasExisting && (
              <Button variant="secondary" onClick={() => selected && onCopy(selected.id, 'append')} disabled={!selected} title="기존 항목 유지하고 복사한 항목을 뒤에 추가">＋ 추가하기</Button>
            )}
            <Button onClick={() => selected && onCopy(selected.id, 'replace')} disabled={!selected} title={hasExisting ? '기존 항목 모두 삭제하고 복사' : '복사한 항목으로 채우기'}>
              {hasExisting ? '⚠ 덮어쓰기' : '복사하기'}
            </Button>
          </div>
        </div>
      </div>
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
