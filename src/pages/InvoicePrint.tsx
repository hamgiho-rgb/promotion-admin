import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Invoice, InvoiceItem, Vendor } from '@/lib/types'

export default function InvoicePrint() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [invoice, setInvoice] = useState<Invoice | null>(null)
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [loading, setLoading] = useState(true)
  // 보기 모드: 'line' = 라인별(원본), 'product' = 품명별 묶음
  const [viewMode, setViewMode] = useState<'line' | 'product'>(() => {
    try { return (localStorage.getItem('invoice_print_view_mode') as any) || 'line' } catch { return 'line' }
  })
  function changeViewMode(m: 'line' | 'product') {
    setViewMode(m)
    try { localStorage.setItem('invoice_print_view_mode', m) } catch {}
  }

  useEffect(() => { load() }, [id])

  async function load() {
    if (!id) return
    setLoading(true)
    const { data: inv } = await supabase.from('invoices').select('*').eq('id', id).single()
    if (!inv) { setLoading(false); return }
    setInvoice(inv)

    const { data: lns } = await supabase
      .from('invoice_items')
      .select('*')
      .eq('invoice_id', id)
      .order('line_date')
      .order('sort_order')
    setItems(lns ?? [])

    const { data: v } = await supabase.from('vendors').select('*').eq('id', inv.vendor_id).single()
    setVendor(v ?? null)

    setLoading(false)
  }

  if (loading) return <div className="p-10 text-center text-zinc-400">불러오는 중...</div>
  if (!invoice) return <div className="p-10 text-center text-rose-600">계산서를 찾을 수 없습니다.</div>

  const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0)
  const vat = Math.round(subtotal * 0.1)
  const total = subtotal + vat

  return (
    <div className="bg-zinc-100 min-h-screen py-8 print:bg-white print:py-0">
      {/* 상단 액션 바 (인쇄 시 숨김) */}
      <div className="max-w-[800px] mx-auto mb-4 flex items-center justify-between print:hidden">
        <button onClick={() => navigate('/invoices')} className="text-[13px] text-zinc-600 hover:text-zinc-900 flex items-center gap-1">
          ← 목록으로
        </button>
        <div className="flex gap-2 items-center">
          <div className="inline-flex rounded-lg border border-zinc-300 overflow-hidden bg-white">
            <button
              onClick={() => changeViewMode('line')}
              className={`px-3 py-2 text-[12px] font-medium ${viewMode === 'line' ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
              title="원본 라인별 보기"
            >
              📄 라인별
            </button>
            <button
              onClick={() => changeViewMode('product')}
              className={`px-3 py-2 text-[12px] font-medium border-l border-zinc-300 ${viewMode === 'product' ? 'bg-emerald-600 text-white' : 'text-zinc-600 hover:bg-zinc-50'}`}
              title="같은 품명 묶어서 수량/금액 합산"
            >
              🧮 품명별 묶기
            </button>
          </div>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-[13px] font-medium hover:bg-zinc-800"
          >
            🖨️ 인쇄 / PDF 저장
          </button>
        </div>
      </div>

      {/* 인쇄 영역 */}
      <div className="max-w-[800px] mx-auto bg-white shadow-sm print:shadow-none">
        <div className="p-10 print:p-8 print-page" style={{ fontFamily: "'Pretendard','맑은 고딕',sans-serif" }}>
          {/* 제목 */}
          <h1 className="text-center text-2xl font-bold tracking-wider mb-1">영 수 증</h1>
          <p className="text-center text-[12px] text-zinc-500 mb-8">(공급받는자용)</p>

          {/* 받는 거래처 + 공급자 정보 */}
          <div className="grid grid-cols-2 gap-6 mb-6 text-[13px]">
            <div className="border-t-2 border-b border-zinc-800 py-3">
              <p className="text-[10px] text-zinc-500 mb-1">받는 곳</p>
              <p className="text-[18px] font-semibold">{vendor?.name || '—'} 귀하</p>
            </div>
            <div className="border border-zinc-300 rounded">
              <table className="w-full text-[11px]">
                <tbody>
                  <tr className="border-b border-zinc-200">
                    <td className="bg-zinc-50 px-2 py-1.5 w-20 font-medium border-r border-zinc-200">공급자</td>
                    <td className="px-2 py-1.5 text-zinc-500" colSpan={2}>{invoice.supplier_name}</td>
                  </tr>
                  <tr className="border-b border-zinc-200">
                    <td className="bg-zinc-50 px-2 py-1.5 font-medium border-r border-zinc-200">사업자번호</td>
                    <td className="px-2 py-1.5 tabular-nums" colSpan={2}>{invoice.supplier_business_number}</td>
                  </tr>
                  <tr className="border-b border-zinc-200">
                    <td className="bg-zinc-50 px-2 py-1.5 font-medium border-r border-zinc-200">상호</td>
                    <td className="px-2 py-1.5 border-r border-zinc-200">{invoice.supplier_name}</td>
                    <td className="px-2 py-1.5 bg-zinc-50 font-medium w-12">성명</td>
                  </tr>
                  <tr>
                    <td className="bg-zinc-50 px-2 py-1.5 font-medium border-r border-zinc-200">소재지</td>
                    <td className="px-2 py-1.5 text-[10px]" colSpan={2}>{invoice.supplier_address}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 작성일 + 총액 */}
          <div className="grid grid-cols-2 gap-6 mb-2">
            <div className="border-2 border-zinc-800 px-3 py-2">
              <span className="text-[11px] text-zinc-500 mr-2">작성일</span>
              <span className="text-[14px] font-medium">{invoice.issue_date}</span>
            </div>
            <div className="border-2 border-zinc-800 px-3 py-2 flex items-center justify-between">
              <span className="text-[11px] text-zinc-500">{Number(invoice.deposit_amount || 0) > 0 ? '청구 잔금' : '금일 금액'}</span>
              <span className="text-[16px] font-bold tabular-nums">₩{(total - Number(invoice.deposit_amount || 0)).toLocaleString()}</span>
            </div>
          </div>

          {/* 거래 라인 표 */}
          {(() => {
            // 사이즈 컬럼
            const sizeKeySet = new Set<string>()
            items.forEach(it => {
              const sz = (it as any).sizes as Record<string, number> | null
              if (sz) Object.keys(sz).forEach(k => { if (Number(sz[k]) > 0) sizeKeySet.add(k) })
            })
            const sizeKeys = Array.from(sizeKeySet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
            const showSizeColumns = sizeKeys.length > 0
            const showSingleSize = !showSizeColumns && items.some(it => ((it as any).size || '').toString().trim() !== '')

            // 상품명 헬퍼
            function extractColor(it: any): string {
              if (it.color && it.color.trim()) return it.color.trim()
              const m = String(it.product_name || '').match(/\(([^()]+)\)\s*$/)
              return m ? m[1].trim() : ''
            }
            function stripColorFromName(it: any): string {
              if (it.color && it.color.trim()) return it.product_name || ''
              return String(it.product_name || '').replace(/\s*\(([^()]+)\)\s*$/, '').trim()
            }

            // viewMode === 'product' 일 때 묶기 — 품명+칼라 기준
            type GroupedLine = {
              key: string
              name: string
              color: string
              sizes: Record<string, number>
              singleSizes: string[]
              quantity: number
              amount: number
              unitPrices: Set<number>
              hasReturn: boolean
              lineCount: number
            }
            const grouped: GroupedLine[] = (() => {
              const map = new Map<string, GroupedLine>()
              items.forEach(it => {
                const name = stripColorFromName(it)
                const color = extractColor(it)
                const key = `${name}||${color}`
                let g = map.get(key)
                if (!g) {
                  g = {
                    key, name, color,
                    sizes: {}, singleSizes: [],
                    quantity: 0, amount: 0,
                    unitPrices: new Set<number>(),
                    hasReturn: false, lineCount: 0,
                  }
                  map.set(key, g)
                }
                const itemSizes = ((it as any).sizes || {}) as Record<string, number>
                Object.entries(itemSizes).forEach(([sz, n]) => {
                  const num = Number(n) || 0
                  g!.sizes[sz] = (g!.sizes[sz] || 0) + num
                })
                const sz = ((it as any).size || '').toString().trim()
                if (sz && !g.singleSizes.includes(sz)) g.singleSizes.push(sz)
                g.quantity += Number(it.quantity || 0) * (it.is_return ? -1 : 1)
                g.amount += Number(it.amount || 0) * (it.is_return ? -1 : 1)
                g.unitPrices.add(Number(it.unit_price || 0))
                if (it.is_return) g.hasReturn = true
                g.lineCount += 1
              })
              return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
            })()

            const totalCols = 1 /*날짜*/ + 1 /*품명*/ + 1 /*칼라*/ + (showSingleSize ? 1 : 0) + sizeKeys.length + 3

            return (
              <table className="w-full text-[12px] border-2 border-zinc-800 mt-3">
                <thead>
                  <tr className={`${viewMode === 'product' ? 'bg-emerald-50' : 'bg-zinc-100'} border-b-2 border-zinc-800`}>
                    <th className="px-2 py-2 border-r border-zinc-300 w-28">{viewMode === 'product' ? '라인수' : '납품일'}</th>
                    <th className="px-2 py-2 border-r border-zinc-300">품명</th>
                    <th className="px-2 py-2 border-r border-zinc-300 w-20">칼라</th>
                    {showSingleSize && <th className="px-2 py-2 border-r border-zinc-300 w-12">사이즈</th>}
                    {sizeKeys.map(sz => (
                      <th key={sz} className="px-1 py-2 border-r border-zinc-300 text-center tabular-nums" style={{ minWidth: '40px' }}>{sz}</th>
                    ))}
                    <th className="px-2 py-2 border-r border-zinc-300 w-14">수량</th>
                    <th className="px-2 py-2 border-r border-zinc-300 w-20">단가</th>
                    <th className="px-2 py-2 w-24">금액</th>
                  </tr>
                </thead>
                <tbody>
                  {items.length === 0 ? (
                    <tr><td colSpan={totalCols} className="text-center py-6 text-zinc-400">등록된 거래 라인이 없습니다.</td></tr>
                  ) : viewMode === 'line' ? items.map(it => {
                    const itemSizes = ((it as any).sizes || {}) as Record<string, number>
                    const dateStr = (it.line_date || '').trim() || invoice.issue_date || ''
                    const colorStr = extractColor(it)
                    const nameStr = stripColorFromName(it)
                    return (
                      <tr key={it.id} className={`border-b border-zinc-200 ${it.is_return ? 'bg-rose-50/50' : ''}`}>
                        <td className="px-2 py-1.5 border-r border-zinc-200 text-center tabular-nums text-[11px]">{dateStr}</td>
                        <td className="px-2 py-1.5 border-r border-zinc-200">{nameStr}</td>
                        <td className="px-2 py-1.5 border-r border-zinc-200 text-center">{colorStr || '—'}</td>
                        {showSingleSize && <td className="px-2 py-1.5 border-r border-zinc-200 text-center tabular-nums">{(it as any).size || ''}</td>}
                        {sizeKeys.map(sz => {
                          const n = Number(itemSizes[sz] || 0)
                          return (
                            <td key={sz} className={`px-1 py-1.5 border-r border-zinc-200 text-center tabular-nums ${n === 0 ? 'text-zinc-300' : ''}`}>
                              {n > 0 ? n : '-'}
                            </td>
                          )
                        })}
                        <td className={`px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums font-medium ${it.is_return ? 'text-rose-700' : ''}`}>
                          {Number(it.quantity).toLocaleString()}
                        </td>
                        <td className="px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums">{Number(it.unit_price).toLocaleString()}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${it.is_return ? 'text-rose-700' : ''}`}>
                          {Number(it.amount).toLocaleString()}
                        </td>
                      </tr>
                    )
                  }) : grouped.map(g => {
                    const unitPriceDisplay = g.unitPrices.size === 1
                      ? Number([...g.unitPrices][0]).toLocaleString()
                      : (g.quantity !== 0 ? Math.round(g.amount / g.quantity).toLocaleString() + '*' : '—')
                    return (
                      <tr key={g.key} className={`border-b border-zinc-200 ${g.hasReturn ? 'bg-rose-50/30' : ''}`}>
                        <td className="px-2 py-1.5 border-r border-zinc-200 text-center tabular-nums text-[11px]">
                          {g.lineCount}건
                        </td>
                        <td className="px-2 py-1.5 border-r border-zinc-200">{g.name}</td>
                        <td className="px-2 py-1.5 border-r border-zinc-200 text-center">{g.color || '—'}</td>
                        {showSingleSize && <td className="px-2 py-1.5 border-r border-zinc-200 text-center tabular-nums text-[10px]">{g.singleSizes.join(',')}</td>}
                        {sizeKeys.map(sz => {
                          const n = Number(g.sizes[sz] || 0)
                          return (
                            <td key={sz} className={`px-1 py-1.5 border-r border-zinc-200 text-center tabular-nums ${n === 0 ? 'text-zinc-300' : ''}`}>
                              {n > 0 ? n.toLocaleString() : '-'}
                            </td>
                          )
                        })}
                        <td className={`px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums font-medium ${g.hasReturn ? 'text-rose-700' : ''}`}>
                          {g.quantity.toLocaleString()}
                        </td>
                        <td className="px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums">{unitPriceDisplay}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${g.hasReturn ? 'text-rose-700' : ''}`}>
                          {g.amount.toLocaleString()}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          })()}
          {viewMode === 'product' && (
            <p className="text-[10px] text-zinc-500 mt-1 print:hidden">* 단가에 *표시: 라인별로 단가가 달라서 평균값. 반품은 (-)로 수량/금액에 반영.</p>
          )}

          {/* 하단: 계좌 + 합계 */}
          <div className="grid grid-cols-2 gap-6 mt-4">
            <div className="border border-zinc-300 p-3 text-[11px]">
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">입금 계좌</div>
              <div className="leading-relaxed text-zinc-800 break-all">{invoice.bank_info || '—'}</div>
            </div>
            <div className="border-2 border-zinc-800">
              <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-1.5 border-b border-zinc-300 text-[12px]">
                <span className="text-zinc-500">공급가액</span>
                <span className="tabular-nums">₩{subtotal.toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-1.5 border-b border-zinc-300 text-[12px]">
                <span className="text-zinc-500">부가세</span>
                <span className="tabular-nums">₩{vat.toLocaleString()}</span>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-2 bg-zinc-50 text-[14px] font-bold border-b border-zinc-300">
                <span>총 합계</span>
                <span className="tabular-nums">₩{total.toLocaleString()}</span>
              </div>
              {Number(invoice.deposit_amount || 0) > 0 && (
                <>
                  <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-1.5 border-b border-zinc-300 text-[12px] text-amber-700">
                    <span>선납 받음 (계약금)</span>
                    <span className="tabular-nums">− ₩{Number(invoice.deposit_amount).toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-2 bg-amber-50 text-[14px] font-bold">
                    <span>청구 잔금</span>
                    <span className="tabular-nums">₩{(total - Number(invoice.deposit_amount || 0)).toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {invoice.notes && (
            <div className="mt-4 text-[12px] text-zinc-600 border-t border-zinc-200 pt-3">
              <p className="text-[10px] text-zinc-500 mb-1">메모</p>
              {invoice.notes}
            </div>
          )}

          {/* 풋터 */}
          <p className="text-center mt-8 text-[13px] font-medium">위 금액을 청구(영수)함</p>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: white !important; }
        }
      `}</style>
    </div>
  )
}
