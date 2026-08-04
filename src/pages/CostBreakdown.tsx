import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Product, Vendor, CostItem } from '@/lib/types'
import { Button, Input, Select, InlineInput, PageHeader, Empty, Badge, Label, Drawer } from '@/components/ui'
import SupplierPicker from '@/components/SupplierPicker'
import CustomerPicker from '@/components/CustomerPicker'
import CostImportButton from '@/components/CostImportButton'
import { exportSheet } from '@/lib/exportXlsx'

export default function CostBreakdown() {
  const navigate = useNavigate()
  const [products, setProducts] = useState<Product[]>([])
  const [suppliers, setSuppliers] = useState<Vendor[]>([])
  const [customers, setCustomers] = useState<Vendor[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [items, setItems] = useState<CostItem[]>([])
  const [copyModalOpen, setCopyModalOpen] = useState(false)
  const [copyProductOpen, setCopyProductOpen] = useState(false)

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

  // 신규 상품 등록 드로어
  const [newProductOpen, setNewProductOpen] = useState(false)
  const [editingProduct, setEditingProduct] = useState<Product | null>(null)

  // 일괄 선택 (상품 삭제용)
  const [selectMode, setSelectMode] = useState(false)
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set())
  function toggleSelectProduct(id: string) {
    setSelectedProducts(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function selectProducts(ids: string[], checked: boolean) {
    setSelectedProducts(prev => {
      const next = new Set(prev)
      if (checked) ids.forEach(id => next.add(id))
      else ids.forEach(id => next.delete(id))
      return next
    })
  }
  function clearSelectedProducts() { setSelectedProducts(new Set()) }

  /** 선택한 상품들의 원가 항목(cost_items)만 삭제 — 상품은 그대로 둠 */
  async function handleBulkClearCostItems() {
    const ids = Array.from(selectedProducts)
    if (ids.length === 0) return
    if (!confirm(`선택한 ${ids.length}개 상품의 원가 항목을 모두 삭제할까요?\n\n· 상품은 그대로 남습니다 (상품관리에 계속 보임)\n· 원가 입력만 빈 상태로 초기화됩니다\n· 이 작업은 되돌릴 수 없어요`)) return
    const { error } = await supabase.from('cost_items').delete().in('product_id', ids)
    if (error) { alert('삭제 실패: ' + error.message); return }
    clearSelectedProducts()
    setSelectMode(false)
    // 현재 선택중이던 상품이 영향받았으면 새로고침
    if (selectedId && ids.includes(selectedId)) loadItems(selectedId)
  }

  async function loadAll() {
    setLoading(true)
    const [{ data: pData }, { data: sData }, { data: cData }] = await Promise.all([
      // 휴지통(deleted_at not null)에 들어간 상품은 제외
      supabase.from('products').select('*').is('deleted_at', null).order('name'),
      supabase.from('vendors').select('*').eq('vendor_type', 'supplier').is('deleted_at', null).order('name'),
      supabase.from('vendors').select('*').eq('vendor_type', 'customer').is('deleted_at', null).order('name'),
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

  const [searchParams, setSearchParams] = useSearchParams()
  const requestedProductId = searchParams.get('product')

  useEffect(() => { loadAll() }, [])
  // URL ?product=... 또는 첫 상품 자동 선택
  useEffect(() => {
    if (products.length === 0) return
    if (requestedProductId && products.find(p => p.id === requestedProductId)) {
      setSelectedId(requestedProductId)
    } else if (!selectedId) {
      // 처음 진입 시 URL 없으면 첫 상품 자동 선택 (URL은 그대로 두기 — 뒤로가기 정상 동작)
      setSelectedId(products[0].id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, requestedProductId])
  useEffect(() => {
    if (selectedId) loadItems(selectedId)
    else setItems([])
  }, [selectedId])

  /** 좌측 상품 리스트에서 상품 클릭 시 — URL 도 갱신해서 뒤로가기 히스토리 남김 */
  function selectProduct(id: string) {
    setSelectedId(id)
    // URL 갱신 (history entry 생성) — 뒤로가기 하면 이전 상품/이전 페이지로 이동
    setSearchParams({ product: id })
  }

  const selectedProduct = products.find(p => p.id === selectedId) || null
  const productionCost = items.reduce((sum, i) => sum + Number(i.subtotal || 0), 0)
  const margin = (selectedProduct?.selling_price || 0) - productionCost
  const marginRate = selectedProduct?.selling_price ? (margin / selectedProduct.selling_price) * 100 : 0
  const markup = productionCost > 0 ? (margin / productionCost) * 100 : 0   // 원가 대비 마크업 %

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

  /** 상품 복사 — 기존 상품 → 새 품번/컬러/거래처로 복제. 원가도 같이 복사 옵션 */
  async function cloneProduct(source: Product, newCode: string, newColor: string, newName: string | null, copyCost: boolean, targetVendorId?: string) {
    const payload = {
      vendor_id: targetVendorId || source.vendor_id,   // 지정된 거래처, 없으면 원본과 동일
      code: newCode.trim(),
      name: (newName?.trim() || source.name || ''),
      name_en: source.name_en || null,
      brand: source.brand || null,
      color: newColor.trim() || null,
      selling_price: Number(source.selling_price) || 0,
    }
    // 새 상품 등록
    const { data: created, error } = await supabase.from('products').insert(payload).select().single()
    if (error) {
      // 휴지통 중복 자동 복구 시도
      const msg = error.message.toLowerCase()
      if (msg.includes('duplicate') || msg.includes('unique')) {
        const { data: trashed } = await supabase.from('products')
          .select('id, name').eq('vendor_id', payload.vendor_id).eq('code', payload.code)
          .not('deleted_at', 'is', null).maybeSingle()
        if (trashed) {
          if (confirm(`품번 '${payload.code}' 가 휴지통에 있습니다. ('${trashed.name}')\n복구해서 복제 정보로 업데이트할까요?`)) {
            const { data: restored, error: rErr } = await supabase.from('products')
              .update({ deleted_at: null, ...payload }).eq('id', trashed.id).select().single()
            if (rErr) { alert('복구 실패: ' + rErr.message); return }
            if (restored && copyCost) await copyCostToProduct(source.id, restored.id)
            setCopyProductOpen(false)
            await loadAll()
            if (restored) setSelectedId(restored.id)
            return
          }
        }
      }
      alert('복제 실패: ' + error.message)
      return
    }
    if (!created) return
    // 원가도 복사
    if (copyCost) await copyCostToProduct(source.id, created.id)
    setCopyProductOpen(false)
    await loadAll()
    setSelectedId(created.id)
  }

  /** 상품 이동 — 다른 거래처로 vendor_id 변경. 연결된 이력 개수 확인 후 경고 */
  async function moveProduct(source: Product, targetVendorId: string) {
    if (targetVendorId === source.vendor_id) { alert('같은 거래처예요. 다른 거래처를 선택하세요.'); return }
    // 연결된 이력 개수 확인
    const [{ count: invCount }, { count: incCount }, { count: costCount }] = await Promise.all([
      supabase.from('invoice_items').select('id', { count: 'exact', head: true }).eq('product_id', source.id),
      supabase.from('incoming_items').select('id', { count: 'exact', head: true }).eq('product_id', source.id),
      supabase.from('cost_items').select('id', { count: 'exact', head: true }).eq('product_id', source.id),
    ])
    const srcVendorName = customers.find(c => c.id === source.vendor_id)?.name || '(원본)'
    const dstVendorName = customers.find(c => c.id === targetVendorId)?.name || '(대상)'
    // 휴지통 중복 체크 — 대상 거래처에 같은 품번이 살아있는 상품 있으면 이동 불가
    const { data: dup } = await supabase.from('products')
      .select('id, name').eq('vendor_id', targetVendorId).eq('code', source.code)
      .is('deleted_at', null).maybeSingle()
    if (dup) {
      alert(`이동 실패: 대상 거래처 '${dstVendorName}'에 이미 같은 품번 '${source.code}' 상품이 있어요 (${dup.name}).\n다른 품번으로 복사하거나 대상 상품을 먼저 정리하세요.`)
      return
    }

    // 이력 있으면 경고
    const hasHistory = (invCount || 0) > 0 || (incCount || 0) > 0
    let msg = `🚚 상품 이동\n\n${source.name} (${source.code})\n${srcVendorName} → ${dstVendorName}\n\n`
    if (hasHistory) {
      msg += `⚠ 기존 연결 이력:\n`
      if (invCount) msg += `  · 계산서 라인: ${invCount}건\n`
      if (incCount) msg += `  · 입고 라인: ${incCount}건\n`
      if (costCount) msg += `  · 원가 항목: ${costCount}건 (자동 유지됨)\n`
      msg += `\n※ 계산서/입고 라인들은 원본 거래처(${srcVendorName})에 이미 발행돼있어서,\n   상품만 옮기면 이력이 뒤섞여 보일 수 있어요.\n\n그래도 진행할까요?`
    } else {
      msg += `연결된 이력 없음. 안전하게 이동 가능.\n\n진행할까요?`
    }
    if (!confirm(msg)) return

    // vendor_id 변경
    const { error } = await supabase.from('products').update({ vendor_id: targetVendorId }).eq('id', source.id)
    if (error) { alert('이동 실패: ' + error.message); return }
    setCopyProductOpen(false)
    await loadAll()
    setSelectedId(source.id)   // 옮긴 상품 그대로 유지
  }

  /** cost_items를 다른 상품으로 복사 (내부 헬퍼) */
  async function copyCostToProduct(srcProductId: string, dstProductId: string) {
    const { data: srcItems } = await supabase.from('cost_items').select('*').eq('product_id', srcProductId).order('sort_order')
    if (!srcItems || srcItems.length === 0) return
    const payload = srcItems.map((it: any, i: number) => ({
      product_id: dstProductId,
      supplier_id: it.supplier_id,
      item_name: it.item_name,
      unit_price: Number(it.unit_price || 0),
      yards: Number(it.yards || 0),
      sort_order: i,
    }))
    await supabase.from('cost_items').insert(payload)
  }

  async function deleteItem(id: string) {
    if (!confirm('이 항목을 삭제할까요?')) return
    await supabase.from('cost_items').delete().eq('id', id)
    loadItems(selectedId)
  }

  /** 공급처 그룹 통째로 위/아래 이동 — 그룹의 모든 항목 sort_order 재배치 */
  async function moveGroup(supplierKey: string, dir: 'up' | 'down') {
    const groupKeys = Object.keys(supplierGroups)
    const idx = groupKeys.indexOf(supplierKey)
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= groupKeys.length) return
    // 새 그룹 순서
    const newKeys = [...groupKeys]
    ;[newKeys[idx], newKeys[targetIdx]] = [newKeys[targetIdx], newKeys[idx]]
    // 새 순서대로 sort_order 0,1,2,... 재할당 (그룹 내 항목 순서는 유지)
    let n = 0
    const updates: { id: string; sort_order: number }[] = []
    for (const key of newKeys) {
      const groupItems = supplierGroups[key].items
        .slice()
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
      for (const it of groupItems) {
        updates.push({ id: it.id, sort_order: n++ })
      }
    }
    // 한 번에 update — Promise.all
    await Promise.all(updates.map(u =>
      supabase.from('cost_items').update({ sort_order: u.sort_order }).eq('id', u.id)
    ))
    loadItems(selectedId)
  }

  /** 원가 항목 위/아래로 이동 — 같은 공급처 그룹 내에서 sort_order 스왑 */
  async function moveItem(itemId: string, dir: 'up' | 'down') {
    const item = items.find(i => i.id === itemId)
    if (!item) return
    // 같은 공급처(또는 미지정)끼리만 스왑 — 그래야 시각적으로 위치가 바뀜
    const groupItems = items
      .filter(i => (i.supplier_id || null) === (item.supplier_id || null))
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    const idx = groupItems.findIndex(i => i.id === itemId)
    const targetIdx = dir === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= groupItems.length) return
    const target = groupItems[targetIdx]
    const myOrder = Number(item.sort_order || 0)
    const targetOrder = Number(target.sort_order || 0)
    // 두 행의 sort_order 교환
    await supabase.from('cost_items').update({ sort_order: targetOrder }).eq('id', item.id)
    await supabase.from('cost_items').update({ sort_order: myOrder }).eq('id', target.id)
    loadItems(selectedId)
  }

  /** 현재 선택 상품의 원가내역을 엑셀로 내보내기 */
  function exportCurrentToExcel() {
    if (!selectedProduct) return
    const customerName = customers.find(c => c.id === selectedProduct.vendor_id)?.name || '거래처 미지정'
    const sellingPrice = Number(selectedProduct.selling_price || 0)
    const totalCost = items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
    const marginVal = sellingPrice - totalCost
    const marginPct = sellingPrice ? (marginVal / sellingPrice) * 100 : 0
    const markupPct = totalCost > 0 ? (marginVal / totalCost) * 100 : 0   // 원가 대비 마크업

    const rows: any[][] = []
    // 상품 정보
    rows.push(['원가내역서'])
    rows.push([])
    rows.push(['거래처', customerName, '품번', selectedProduct.code])
    rows.push(['품목명', selectedProduct.name, '컬러', selectedProduct.color || ''])
    rows.push(['브랜드', selectedProduct.brand || '', '판매가', sellingPrice])
    rows.push([])
    // 원가 항목 헤더
    rows.push(['공급처', '재료/공정', '단가', '요척', '소계'])
    for (const it of items) {
      const supplierName = suppliers.find(s => s.id === it.supplier_id)?.name || '미지정'
      rows.push([
        supplierName,
        it.item_name || '',
        Number(it.unit_price || 0),
        Number(it.yards || 0),
        Math.round(Number(it.subtotal || 0)),
      ])
    }
    rows.push([])
    rows.push(['', '', '', '생산원가 합계', Math.round(totalCost)])
    rows.push(['', '', '', '판매가', sellingPrice])
    rows.push(['', '', '', '마진', Math.round(marginVal)])
    rows.push(['', '', '', `마진율 (판매가 대비)`, `${marginPct.toFixed(1)}%`])
    rows.push(['', '', '', `마크업 (원가 대비)`, `${markupPct.toFixed(1)}%`])

    const safeCode = (selectedProduct.code || 'product').replace(/[\\/:*?"<>|]/g, '_')
    exportSheet(rows, '원가내역서', `원가내역서_${safeCode}`)
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
        action={<CostImportButton onImported={loadAll} />}
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
              <div className="flex items-center gap-2 mb-2">
                <button
                  onClick={() => setNewProductOpen(true)}
                  className="flex-1 text-[12px] px-2.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-medium"
                  title="원가계산서에서 바로 상품 등록"
                >＋ 새 상품 등록</button>
              </div>
              <Input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="🔍 품번 / 품목명 / 컬러" />
              <div className="flex items-center gap-2 mt-2 text-[10px] flex-wrap">
                <button
                  onClick={() => {
                    const vendorNames = Array.from(new Set(filteredProducts.map(p => customers.find(c => c.id === p.vendor_id)?.name || '거래처 미지정')))
                    collapseAll(vendorNames.map(v => `vendor:${v}`))
                  }}
                  className="px-2 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                >▶ 접기</button>
                <button
                  onClick={expandAll}
                  className="px-2 py-0.5 rounded bg-zinc-100 hover:bg-zinc-200 text-zinc-700"
                >▼ 펼치기</button>
                <button
                  onClick={() => { setSelectMode(m => !m); if (selectMode) clearSelectedProducts() }}
                  className={`px-2 py-0.5 rounded transition-colors ml-auto ${selectMode ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-700'}`}
                  title="여러 상품의 원가 항목을 한꺼번에 비우기 (상품 자체는 그대로)"
                >
                  {selectMode ? '✕ 선택 해제' : '🧹 원가 일괄 비우기'}
                </button>
              </div>
            </div>

            {/* 선택 액션 바 — 상품의 원가 항목만 삭제 (상품 자체는 그대로) */}
            {selectMode && (
              <div className="px-3 py-2 bg-amber-50 border-b border-amber-200 text-[11px]">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="font-semibold text-amber-900">✓ {selectedProducts.size}개 선택</span>
                  <button
                    onClick={() => selectProducts(filteredProducts.map(p => p.id), true)}
                    className="px-2 py-0.5 rounded bg-white border border-amber-300 text-amber-800 hover:bg-amber-100"
                  >
                    표시 {filteredProducts.length}개 모두
                  </button>
                  <button
                    onClick={clearSelectedProducts}
                    className="px-2 py-0.5 rounded bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50"
                  >
                    해제
                  </button>
                  {selectedProducts.size > 0 && (
                    <button
                      onClick={handleBulkClearCostItems}
                      className="ml-auto px-2.5 py-1 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-medium"
                    >
                      🧹 원가 비우기 ({selectedProducts.size})
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-amber-700 leading-tight">
                  💡 상품의 <b>원가 항목만</b> 삭제됩니다. 상품 자체는 상품관리에 그대로 남아요. 상품을 지우려면 <b>상품관리 메뉴</b>에서 하세요.
                </p>
              </div>
            )}
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
                  // 거래처에 속한 모든 상품 ID 모음
                  const allVendorProductIds = brandKeys.flatMap(b => brands[b].map(p => p.id))
                  const allVendorSelected = allVendorProductIds.length > 0 && allVendorProductIds.every(id => selectedProducts.has(id))
                  const someVendorSelected = allVendorProductIds.some(id => selectedProducts.has(id))
                  return (
                    <div key={vName}>
                      {/* 회사 헤더 — 클릭하면 접기/펼치기 */}
                      <div className="sticky top-0 z-[1] w-full px-3 py-2.5 bg-gradient-to-r from-zinc-900 to-zinc-800 text-white flex items-center gap-2 border-b border-zinc-700">
                        {selectMode && (
                          <input
                            type="checkbox"
                            checked={allVendorSelected}
                            ref={el => { if (el) el.indeterminate = someVendorSelected && !allVendorSelected }}
                            onChange={e => selectProducts(allVendorProductIds, e.target.checked)}
                            className="w-3.5 h-3.5 rounded cursor-pointer flex-shrink-0"
                            title="이 거래처의 모든 상품 선택"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => toggleCollapse(vendorKey)}
                          className="flex-1 flex items-center justify-between text-left hover:opacity-90 min-w-0"
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
                      </div>
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
                            {(!showBrandSep || !brandCollapsed) && list.map(p => {
                              const isPicked = selectedProducts.has(p.id)
                              return (
                                <div
                                  key={p.id}
                                  className={`group w-full flex items-center border-b border-zinc-50 transition-colors relative ${
                                    selectedId === p.id
                                      ? 'bg-zinc-900 text-white'
                                      : isPicked
                                        ? 'bg-rose-50'
                                        : 'hover:bg-blue-50/60'
                                  }`}
                                >
                                  {selectedId === p.id && <span className="absolute left-0 top-0 bottom-0 w-1 bg-blue-400" />}
                                  {selectMode && (
                                    <label className="pl-3 pr-1 py-2.5 cursor-pointer flex-shrink-0" onClick={e => e.stopPropagation()}>
                                      <input
                                        type="checkbox"
                                        checked={isPicked}
                                        onChange={() => toggleSelectProduct(p.id)}
                                        className="w-4 h-4 rounded cursor-pointer"
                                      />
                                    </label>
                                  )}
                                  <button
                                    onClick={() => selectProduct(p.id)}
                                    className="flex-1 text-left px-3 py-2.5 min-w-0"
                                  >
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
                                </div>
                              )
                            })}
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
                      <p className="text-[15px] font-semibold text-zinc-900 flex items-center gap-1.5">
                        {selectedProduct.name}
                        <button
                          onClick={() => setEditingProduct(selectedProduct)}
                          className="text-blue-500 hover:text-blue-700 text-[13px]"
                          title="상품 정보 수정 (품번/이름/컬러/판매가 등)"
                        >✎</button>
                      </p>
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
                    <button
                      onClick={() => setCopyProductOpen(true)}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 font-medium whitespace-nowrap"
                      title="이 상품을 새 품번/컬러로 복제 (원가도 같이 복사)"
                    >
                      🎨 상품 복사
                    </button>
                    <button
                      onClick={exportCurrentToExcel}
                      disabled={items.length === 0}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-violet-50 hover:bg-violet-100 disabled:bg-zinc-100 disabled:text-zinc-400 text-violet-700 border border-violet-200 disabled:border-zinc-200 font-medium whitespace-nowrap"
                      title="이 상품의 원가내역을 엑셀로 다운로드"
                    >
                      📥 엑셀
                    </button>
                    <button
                      onClick={() => window.open(`/cost/${selectedProduct.id}/print`, '_blank')}
                      disabled={items.length === 0}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-zinc-900 hover:bg-zinc-800 disabled:bg-zinc-200 disabled:text-zinc-400 text-white font-medium whitespace-nowrap"
                      title="원가내역서 인쇄 / PDF 저장"
                    >
                      🖨️ 인쇄
                    </button>
                    <button onClick={() => navigate(`/products/${selectedProduct.id}`)} className="text-[12px] text-blue-600 hover:underline whitespace-nowrap">
                      상품 상세 →
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
                    hint={markup ? `마진율 ${marginRate.toFixed(1)}% · 마크업 ${markup.toFixed(1)}% (원가 대비)` : '판매가 − 원가'}
                    highlight={margin > 0 ? 'green' : margin < 0 ? 'rose' : 'zinc'}
                  />
                </div>

                {/* 공급처별 재료 그룹 */}
                <div className="space-y-3">
                  {Object.entries(supplierGroups).map(([supplierId, group], groupIdx, groupArr) => {
                    const groupTotal = group.items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
                    return (
                      <div key={supplierId} className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
                        {/* 공급처 헤더 */}
                        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {/* 그룹 순서 변경 ▲▼ */}
                            <div className="flex flex-col gap-0.5 mr-1">
                              <button
                                onClick={() => moveGroup(supplierId, 'up')}
                                disabled={groupIdx === 0}
                                className="w-6 h-5 rounded text-[11px] bg-white border border-zinc-200 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-700 leading-none"
                                title="공급처 그룹을 위로 이동"
                              >▲</button>
                              <button
                                onClick={() => moveGroup(supplierId, 'down')}
                                disabled={groupIdx === groupArr.length - 1}
                                className="w-6 h-5 rounded text-[11px] bg-white border border-zinc-200 hover:bg-zinc-100 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-700 leading-none"
                                title="공급처 그룹을 아래로 이동"
                              >▼</button>
                            </div>
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
                                <th className="px-3 py-2 w-14 text-center">순서</th>
                                <th className="px-3 py-2">공급처</th>
                                <th className="px-3 py-2">재료/항목명</th>
                                <th className="px-3 py-2 text-right w-36">단가</th>
                                <th className="px-3 py-2 text-right w-28">요척</th>
                                <th className="px-3 py-2 text-right w-32">소계</th>
                                <th className="px-3 py-2 w-10"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.items.map((item, idx) => (
                                <tr key={item.id} className="border-t border-zinc-100">
                                  <td className="px-1 py-1.5">
                                    <div className="flex flex-col items-center gap-0.5">
                                      <button
                                        onClick={() => moveItem(item.id, 'up')}
                                        disabled={idx === 0}
                                        className="w-6 h-5 rounded text-[11px] bg-zinc-100 hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-700 leading-none"
                                        title="위로 이동"
                                      >▲</button>
                                      <button
                                        onClick={() => moveItem(item.id, 'down')}
                                        disabled={idx === group.items.length - 1}
                                        className="w-6 h-5 rounded text-[11px] bg-zinc-100 hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed text-zinc-700 leading-none"
                                        title="아래로 이동"
                                      >▼</button>
                                    </div>
                                  </td>
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

      {/* 상품 복사 / 이동 모달 */}
      <CloneProductModal
        open={copyProductOpen}
        source={selectedProduct}
        customers={customers}
        onClose={() => setCopyProductOpen(false)}
        onClone={cloneProduct}
        onMove={moveProduct}
      />

      {/* 신규 상품 등록 / 상품 정보 수정 드로어 */}
      <NewProductDrawer
        open={newProductOpen || !!editingProduct}
        editing={editingProduct}
        onClose={() => { setNewProductOpen(false); setEditingProduct(null) }}
        customers={customers}
        onCreated={async (savedId) => {
          setNewProductOpen(false)
          setEditingProduct(null)
          await loadAll()
          setSelectedId(savedId)
        }}
        onCustomersChanged={loadAll}
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

/* ─────────────────────────────────────────────
 * 상품 복사 모달 — 이 상품을 새 품번/컬러로 복제
 * 예) 같은 디자인 다른 컬러: DD26SMTS-007-SK (스카이) → DD26SMTS-007-BK (블랙)
 * ───────────────────────────────────────────── */
function CloneProductModal({ open, source, customers, onClose, onClone, onMove }: {
  open: boolean
  source: Product | null
  customers: Vendor[]
  onClose: () => void
  onClone: (source: Product, newCode: string, newColor: string, newName: string | null, copyCost: boolean, targetVendorId?: string) => void
  onMove: (source: Product, targetVendorId: string) => void
}) {
  const [mode, setMode] = useState<'copy' | 'move'>('copy')
  const [newCode, setNewCode] = useState('')
  const [newColor, setNewColor] = useState('')
  const [newName, setNewName] = useState('')
  const [copyCost, setCopyCost] = useState(true)
  const [targetVendorId, setTargetVendorId] = useState<string>('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open || !source) return
    setMode('copy')
    const codeBase = (source.code || '').replace(/-[A-Z]{2,4}$/, '')
    setNewCode(codeBase + '-')
    setNewColor('')
    setNewName(source.name || '')
    setCopyCost(true)
    setTargetVendorId(source.vendor_id || '')
    setSaving(false)
  }, [open, source])

  if (!open || !source) return null

  const sourceVendorName = customers.find(c => c.id === source.vendor_id)?.name || '(원본 거래처)'
  const isDifferentVendor = targetVendorId && targetVendorId !== source.vendor_id
  const targetVendorName = customers.find(c => c.id === targetVendorId)?.name || ''

  function handleSubmit() {
    if (mode === 'move') {
      if (!targetVendorId || targetVendorId === source?.vendor_id) {
        alert('다른 거래처를 선택해주세요.')
        return
      }
      setSaving(true)
      onMove(source!, targetVendorId)
      return
    }
    // 복사 모드
    if (!newCode.trim()) { alert('새 품번을 입력해주세요.'); return }
    if (targetVendorId === source?.vendor_id && newCode.trim() === (source?.code || '')) {
      alert('같은 거래처에서 품번이 원본과 같아요. 다른 품번으로 입력해주세요.')
      return
    }
    setSaving(true)
    onClone(source!, newCode.trim(), newColor.trim(), newName.trim() || null, copyCost, targetVendorId || undefined)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-100">
          <h2 className="text-[16px] font-semibold text-zinc-900">
            {mode === 'copy' ? '🎨 상품 복사' : '🚚 상품 이동'}
          </h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">
            <span className="font-semibold text-zinc-800">{source.name}</span>
            {source.color ? ` (${source.color})` : ''}
            {mode === 'copy' ? ' 를 새 상품으로 복제합니다.' : ' 를 다른 거래처로 이동합니다.'}
          </p>
        </div>
        <div className="p-5 space-y-3">
          {/* 모드 토글 */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode('copy')}
              className={`flex-1 px-3 py-2 rounded-md text-[13px] font-medium border transition-colors ${
                mode === 'copy' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
              }`}
            >🎨 복사 (원본 유지)</button>
            <button
              type="button"
              onClick={() => setMode('move')}
              className={`flex-1 px-3 py-2 rounded-md text-[13px] font-medium border transition-colors ${
                mode === 'move' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-zinc-700 border-zinc-300 hover:bg-zinc-50'
              }`}
            >🚚 이동 (원본 없어짐)</button>
          </div>

          <div className="p-3 bg-zinc-50 border border-zinc-200 rounded-lg text-[11px] text-zinc-600">
            <div>원본 품번: <span className="font-mono font-semibold text-zinc-800">{source.code}</span></div>
            <div>거래처: <span className="text-zinc-800">{sourceVendorName}</span> · 브랜드: {source.brand || '—'} · 판매가 ₩{Number(source.selling_price || 0).toLocaleString()}</div>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-zinc-700 mb-1">
              {mode === 'move' ? '이동할 거래처 *' : '거래처 *'}
            </label>
            <VendorSearchSelect
              value={targetVendorId || 'all'}
              vendors={customers}
              onChange={v => setTargetVendorId(v === 'all' ? '' : v)}
              placeholder="🔍 거래처 검색"
            />
            {mode === 'copy' && isDifferentVendor && (
              <p className="text-[10px] text-blue-700 mt-1">
                💡 다른 거래처(<strong>{targetVendorName}</strong>)로 복사됩니다. 원본은 <strong>{sourceVendorName}</strong>에 그대로 남음.
              </p>
            )}
            {mode === 'move' && isDifferentVendor && (
              <p className="text-[10px] text-amber-700 mt-1">
                ⚠ 상품이 <strong>{sourceVendorName}</strong>에서 <strong>{targetVendorName}</strong>으로 옮겨집니다. 기존 계산서/입고 이력은 원본 거래처에 남지만 상품 참조가 뒤섞일 수 있어요. 진행 전 다음 확인 창에서 이력 개수 알려드림.
              </p>
            )}
          </div>

          {/* 복사 모드일 때만 품번/컬러/이름 노출 */}
          {mode === 'copy' && (
            <>
              <div>
                <label className="block text-[12px] font-medium text-zinc-700 mb-1">새 품번 *</label>
                <input
                  type="text"
                  value={newCode}
                  onChange={e => setNewCode(e.target.value)}
                  autoFocus
                  placeholder="예: DD26SMTS-007-BK"
                  className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[10px] text-zinc-500 mt-1">원본 품번에서 컬러코드(-SK 등) 부분만 바꿔주세요.</p>
              </div>
              <div>
                <label className="block text-[12px] font-medium text-zinc-700 mb-1">새 컬러</label>
                <input
                  type="text"
                  value={newColor}
                  onChange={e => setNewColor(e.target.value)}
                  placeholder="예: 블랙"
                  className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-[12px] font-medium text-zinc-700 mb-1">품목명 (수정 가능)</label>
                <input
                  type="text"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="text-[10px] text-zinc-500 mt-1">보통 원본과 동일. 필요하면 수정.</p>
              </div>
              <label className={`flex items-center gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${copyCost ? 'border-blue-500 bg-blue-50' : 'border-zinc-300 hover:bg-zinc-50'}`}>
                <input
                  type="checkbox"
                  checked={copyCost}
                  onChange={e => setCopyCost(e.target.checked)}
                  className="w-4 h-4"
                />
                <div className="text-[12.5px]">
                  <div className="font-medium">원가 항목도 같이 복사</div>
                  <div className="text-[10px] text-zinc-500">체크 해제 시 상품만 복제되고 원가는 빈 상태로 시작</div>
                </div>
              </label>
            </>
          )}

          {/* 이동 모드 안내 */}
          {mode === 'move' && (
            <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-[11px] text-amber-800 space-y-1">
              <div className="font-semibold">🚚 이동 모드</div>
              <div>· 품번 유지 (변경 안 됨)</div>
              <div>· 원가 항목 유지 (같이 옮겨짐)</div>
              <div>· 대상 거래처에 같은 품번 이미 있으면 이동 실패</div>
              <div>· 기존 계산서/입고 이력 있으면 진행 전 개수 안내 후 확인</div>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md border border-zinc-300 text-zinc-700 text-[13px] hover:bg-zinc-50">취소</button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className={`px-4 py-2 rounded-md text-white text-[13px] font-medium disabled:opacity-50 ${
              mode === 'copy' ? 'bg-indigo-600 hover:bg-indigo-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {saving ? '처리 중...' : (mode === 'copy' ? '🎨 복제하기' : '🚚 이동하기')}
          </button>
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

/* ─────────────────────────────────────────────
 * 신규 상품 등록 드로어 — 원가계산서에서 바로 상품 추가
 * 등록 후 콜백에 새 상품 id 전달 → 좌측 목록 새로고침 + 자동 선택
 * ───────────────────────────────────────────── */
function NewProductDrawer({ open, onClose, customers, editing, onCreated, onCustomersChanged }: {
  open: boolean
  onClose: () => void
  customers: Vendor[]
  /** 값이 있으면 수정 모드, 없으면 신규 등록 모드 */
  editing?: Product | null
  onCreated: (newId: string) => void
  onCustomersChanged: () => void
}) {
  const isEdit = !!editing
  const [vendorId, setVendorId] = useState<string>('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [brand, setBrand] = useState('')
  const [color, setColor] = useState('')
  const [sellingPrice, setSellingPrice] = useState<number | ''>('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 드로어 열릴 때 폼 초기화 — 수정 모드면 기존 값
  useEffect(() => {
    if (!open) return
    if (editing) {
      setVendorId(editing.vendor_id || '')
      setCode(editing.code || '')
      setName(editing.name || '')
      setNameEn(editing.name_en || '')
      setBrand(editing.brand || '')
      setColor(editing.color || '')
      setSellingPrice(Number(editing.selling_price) || '')
    } else {
      setVendorId(customers[0]?.id || '')
      setCode(''); setName(''); setNameEn(''); setBrand(''); setColor(''); setSellingPrice('')
    }
    setError(null)
  }, [open, editing, customers])

  async function handleSave() {
    if (!vendorId) { setError('거래처를 선택해주세요.'); return }
    if (!code.trim()) { setError('품번은 필수입니다.'); return }
    if (!name.trim()) { setError('품목명은 필수입니다.'); return }
    setSaving(true); setError(null)

    const payload = {
      vendor_id: vendorId,
      code: code.trim(),
      name: name.trim(),
      name_en: nameEn.trim() || null,
      brand: brand.trim() || null,
      color: color.trim() || null,
      selling_price: Number(sellingPrice) || 0,
    }

    // 수정 모드
    if (isEdit && editing) {
      const { data, error: upErr } = await supabase.from('products').update(payload).eq('id', editing.id).select().single()
      setSaving(false)
      if (upErr) { setError(upErr.message); return }
      if (data) onCreated(data.id)
      return
    }

    // 신규 등록
    const { data, error: insErr } = await supabase.from('products').insert(payload).select().single()
    if (insErr) {
      const msg = insErr.message.toLowerCase()
      if (msg.includes('duplicate') || msg.includes('unique')) {
        const { data: trashed } = await supabase
          .from('products')
          .select('id, name')
          .eq('vendor_id', vendorId)
          .eq('code', payload.code)
          .not('deleted_at', 'is', null)
          .maybeSingle()
        if (trashed) {
          if (confirm(`품번 '${payload.code}' 가 휴지통에 있습니다. ('${trashed.name}')\n\n복구해서 입력한 정보로 업데이트할까요?`)) {
            const { data: restored, error: rErr } = await supabase
              .from('products')
              .update({ deleted_at: null, ...payload })
              .eq('id', trashed.id)
              .select().single()
            setSaving(false)
            if (rErr) { setError(rErr.message); return }
            if (restored) onCreated(restored.id)
            return
          }
          setSaving(false)
          setError(`품번 '${payload.code}' 가 휴지통에 있어요. 다른 품번을 쓰거나 휴지통에서 복구하세요.`)
          return
        }
      }
      setSaving(false); setError(insErr.message); return
    }
    setSaving(false)
    if (data) onCreated(data.id)
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? '✎ 상품 정보 수정' : '＋ 새 상품 등록'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '저장 중...' : (isEdit ? '수정 저장' : '저장하고 원가 입력 시작')}
          </Button>
        </>
      }
    >
      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">{error}</div>}

      <div className="mb-4 p-3 rounded-lg bg-blue-50 border border-blue-200 text-[12px] text-blue-900">
        {isEdit
          ? '💡 상품 정보를 수정합니다. 품번은 변경 가능하지만 신중히 — 다른 곳(계산서/입고)에서 참조 중일 수 있어요.'
          : '💡 상품 등록 후 자동으로 좌측 목록에 추가되고, 이 상품의 원가 입력 화면으로 이동합니다.'}
      </div>

      <div className="space-y-4">
        <div>
          <Label required>거래처(고객)</Label>
          <CustomerPicker
            value={vendorId || null}
            customers={customers}
            onChange={id => setVendorId(id || '')}
            onCustomersChanged={onCustomersChanged}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label required>품번</Label>
            <Input value={code} onChange={e => setCode(e.target.value)} placeholder="예: DD26SMTS-007-SK" />
          </div>
          <div>
            <Label>컬러</Label>
            <Input value={color} onChange={e => setColor(e.target.value)} placeholder="예: 차콜" />
          </div>
        </div>

        <div>
          <Label required>품목명 (한글)</Label>
          <Input value={name} onChange={e => setName(e.target.value)} placeholder="예: 픽셀 글리프 테이프 셔츠" />
        </div>

        <div>
          <Label>영문 품목명 (선택)</Label>
          <Input value={nameEn} onChange={e => setNameEn(e.target.value)} placeholder="예: DD pixel glyph tape shirt" />
        </div>

        <div>
          <Label>브랜드 (선택)</Label>
          <Input value={brand} onChange={e => setBrand(e.target.value)} placeholder="예: 단델" />
          <p className="text-[11px] text-zinc-500 mt-1">예: 회사 '마요네즈' 안에 브랜드 '단델'</p>
        </div>

        <div>
          <Label>판매가 (선택)</Label>
          <Input
            type="number"
            value={sellingPrice === '' ? '' : sellingPrice}
            onChange={e => setSellingPrice(e.target.value === '' ? '' : Number(e.target.value))}
            placeholder="0"
          />
          <p className="text-[11px] text-zinc-500 mt-1">나중에 상품관리에서 수정 가능. 마진 계산에 사용됨.</p>
        </div>
      </div>
    </Drawer>
  )
}
