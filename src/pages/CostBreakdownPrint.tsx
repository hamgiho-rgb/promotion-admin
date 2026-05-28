import { Fragment, useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Product, Vendor, CostItem } from '@/lib/types'

/* ─────────────────────────────────────────────
 * 원가내역서 인쇄 페이지
 * URL: /cost/:productId/print
 * - 단일 상품 원가표 (공급처별 그룹 + 합계 + 마진)
 * - window.print() 로 인쇄 / PDF 저장
 * ───────────────────────────────────────────── */

export default function CostBreakdownPrint() {
  const { productId } = useParams()
  const navigate = useNavigate()
  const [product, setProduct] = useState<Product | null>(null)
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [items, setItems] = useState<CostItem[]>([])
  const [suppliers, setSuppliers] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [productId])

  async function load() {
    if (!productId) return
    setLoading(true)
    const { data: p } = await supabase.from('products').select('*').eq('id', productId).single()
    if (!p) { setLoading(false); return }
    setProduct(p as Product)

    const { data: v } = await supabase.from('vendors').select('*').eq('id', p.vendor_id).single()
    setVendor(v ?? null)

    const { data: ci } = await supabase.from('cost_items').select('*').eq('product_id', productId).order('sort_order')
    setItems((ci ?? []) as CostItem[])

    const { data: sv } = await supabase.from('vendors').select('*').eq('vendor_type', 'supplier')
    setSuppliers((sv ?? []) as Vendor[])

    setLoading(false)
  }

  if (loading) return <div className="p-10 text-center text-zinc-400">불러오는 중...</div>
  if (!product) return <div className="p-10 text-center text-rose-600">상품을 찾을 수 없습니다.</div>

  // 공급처별 그룹화
  const groups = items.reduce<Record<string, { supplier: Vendor | null; items: CostItem[] }>>((acc, it) => {
    const key = it.supplier_id || '__unset__'
    if (!acc[key]) {
      acc[key] = { supplier: suppliers.find(s => s.id === it.supplier_id) || null, items: [] }
    }
    acc[key].items.push(it)
    return acc
  }, {})

  const total = items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
  const sellingPrice = Number(product.selling_price || 0)
  const margin = sellingPrice - total
  const marginRate = sellingPrice ? (margin / sellingPrice) * 100 : 0

  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="bg-zinc-100 min-h-screen py-8 print:bg-white print:py-0">
      {/* 상단 액션 바 (인쇄 시 숨김) */}
      <div className="max-w-[800px] mx-auto mb-4 flex items-center justify-between print:hidden">
        <button onClick={() => navigate('/cost?product=' + productId)} className="text-[13px] text-zinc-600 hover:text-zinc-900 flex items-center gap-1">
          ← 원가계산서로
        </button>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-[13px] font-medium hover:bg-zinc-800"
        >
          🖨️ 인쇄 / PDF 저장
        </button>
      </div>

      {/* 인쇄 영역 */}
      <div className="max-w-[800px] mx-auto bg-white shadow-sm print:shadow-none">
        <div className="p-10 print:p-8 print-page" style={{ fontFamily: "'Pretendard','맑은 고딕',sans-serif" }}>
          {/* 제목 */}
          <h1 className="text-center text-2xl font-bold tracking-wider mb-1">원 가 내 역 서</h1>
          <p className="text-center text-[12px] text-zinc-500 mb-8">{today}</p>

          {/* 상품 정보 박스 */}
          <table className="w-full border border-zinc-300 text-[12px] mb-6">
            <tbody>
              <tr className="border-b border-zinc-200">
                <td className="bg-zinc-50 px-3 py-2 w-24 font-medium border-r border-zinc-200">거래처</td>
                <td className="px-3 py-2">{vendor?.name || '—'}{vendor?.company_name && <span className="text-zinc-500"> ({vendor.company_name})</span>}</td>
                <td className="bg-zinc-50 px-3 py-2 w-24 font-medium border-l border-r border-zinc-200">품번</td>
                <td className="px-3 py-2 font-mono">{product.code}</td>
              </tr>
              <tr className="border-b border-zinc-200">
                <td className="bg-zinc-50 px-3 py-2 font-medium border-r border-zinc-200">품목명</td>
                <td className="px-3 py-2" colSpan={3}>
                  {product.brand && <span className="inline-block px-1.5 py-0.5 mr-2 rounded bg-blue-100 text-blue-700 text-[10px] font-semibold">{product.brand}</span>}
                  {product.name}
                  {product.name_en && <span className="text-zinc-500 text-[11px] ml-2">· {product.name_en}</span>}
                </td>
              </tr>
              <tr>
                <td className="bg-zinc-50 px-3 py-2 font-medium border-r border-zinc-200">컬러</td>
                <td className="px-3 py-2">{product.color || '—'}</td>
                <td className="bg-zinc-50 px-3 py-2 font-medium border-l border-r border-zinc-200">판매가</td>
                <td className="px-3 py-2 tabular-nums font-semibold">₩{sellingPrice.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>

          {/* 원가 항목 표 */}
          {items.length === 0 ? (
            <div className="border border-zinc-300 p-8 text-center text-zinc-400 text-[13px]">등록된 원가 항목이 없습니다.</div>
          ) : (
            <table className="w-full border border-zinc-300 text-[12px] mb-6">
              <thead>
                <tr className="bg-zinc-100 border-b border-zinc-300 text-[11px]">
                  <th className="px-3 py-2 text-left border-r border-zinc-200 w-32">공급처</th>
                  <th className="px-3 py-2 text-left border-r border-zinc-200">재료 / 공정</th>
                  <th className="px-3 py-2 text-right border-r border-zinc-200 w-24">단가</th>
                  <th className="px-3 py-2 text-right border-r border-zinc-200 w-20">요척</th>
                  <th className="px-3 py-2 text-right w-28">소계</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(groups).map(([gKey, group]) => {
                  const groupTotal = group.items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
                  return (
                    <Fragment key={gKey}>
                      {group.items.map((it, idx) => (
                        <tr key={it.id} className="border-b border-zinc-100">
                          {idx === 0 ? (
                            <td
                              className="px-3 py-1.5 border-r border-zinc-200 align-top font-medium"
                              rowSpan={group.items.length}
                            >
                              {group.supplier?.name || '— 미지정 —'}
                            </td>
                          ) : null}
                          <td className="px-3 py-1.5 border-r border-zinc-200">{it.item_name || '—'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums border-r border-zinc-200">{Number(it.unit_price || 0).toLocaleString()}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums border-r border-zinc-200">{Number(it.yards || 0)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(Number(it.subtotal || 0)).toLocaleString()}</td>
                        </tr>
                      ))}
                      <tr className="bg-zinc-50 border-b border-zinc-200 text-[11px]">
                        <td colSpan={4} className="px-3 py-1.5 text-right text-zinc-600">소계</td>
                        <td className="px-3 py-1.5 text-right font-semibold tabular-nums">₩{Math.round(groupTotal).toLocaleString()}</td>
                      </tr>
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-zinc-900 text-white text-[13px]">
                  <td colSpan={4} className="px-3 py-2.5 text-right font-semibold">생산원가 합계</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">₩{Math.round(total).toLocaleString()}</td>
                </tr>
              </tfoot>
            </table>
          )}

          {/* 마진 요약 */}
          <table className="w-full border border-zinc-300 text-[12px]">
            <tbody>
              <tr className="border-b border-zinc-200">
                <td className="bg-zinc-50 px-3 py-2 w-32 font-medium border-r border-zinc-200">판매가</td>
                <td className="px-3 py-2 text-right tabular-nums">₩{sellingPrice.toLocaleString()}</td>
              </tr>
              <tr className="border-b border-zinc-200">
                <td className="bg-zinc-50 px-3 py-2 font-medium border-r border-zinc-200">− 생산원가</td>
                <td className="px-3 py-2 text-right tabular-nums">₩{Math.round(total).toLocaleString()}</td>
              </tr>
              <tr className={margin >= 0 ? 'bg-emerald-50' : 'bg-rose-50'}>
                <td className="px-3 py-2.5 font-semibold border-r border-zinc-200">마진 {marginRate ? `(${marginRate.toFixed(1)}%)` : ''}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums font-bold text-[14px] ${margin >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                  ₩{Math.round(margin).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>

          <p className="text-center text-[10px] text-zinc-400 mt-8">
            본 내역서는 내부 원가 산출용입니다. 출력일: {today}
          </p>
        </div>
      </div>

      {/* 프린트 CSS */}
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  )
}
