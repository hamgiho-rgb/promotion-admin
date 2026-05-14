import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { SupplierInvoice, SupplierInvoiceItem, Vendor } from '@/lib/types'

/* ─────────────────────────────────────────────
 * 공급처(공장) 계산서 출력 페이지 — A4 인쇄용
 * URL: /supplier-invoices/:id/print
 * ───────────────────────────────────────────── */

export default function SupplierInvoicePrint() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inv, setInv] = useState<SupplierInvoice | null>(null)
  const [items, setItems] = useState<SupplierInvoiceItem[]>([])
  const [supplier, setSupplier] = useState<Vendor | null>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const { data: invData } = await supabase.from('supplier_invoices').select('*').eq('id', id).single()
      if (!invData) return
      setInv(invData as SupplierInvoice)
      const [{ data: itemData }, { data: vData }] = await Promise.all([
        supabase.from('supplier_invoice_items').select('*').eq('invoice_id', id).order('sort_order'),
        supabase.from('vendors').select('*').eq('id', invData.supplier_id).single(),
      ])
      setItems((itemData ?? []) as SupplierInvoiceItem[])
      setSupplier(vData as Vendor)
    })()
  }, [id])

  if (!inv) {
    return <div className="p-12 text-center text-zinc-500">불러오는 중…</div>
  }

  // 상호별 합계 (브랜드 컬럼이 비어있으면 안 보임)
  const showBrand = items.some(it => (it.brand || '').trim() !== '')
  const byBrand: Record<string, { qty: number; amount: number }> = {}
  items.forEach(it => {
    const b = (it.brand || '').trim() || '—'
    if (!byBrand[b]) byBrand[b] = { qty: 0, amount: 0 }
    byBrand[b].qty += Number(it.quantity || 0)
    byBrand[b].amount += Number(it.amount || 0)
  })

  const totalQty = items.reduce((s, it) => s + Number(it.quantity || 0), 0)
  const totalAmount = items.reduce((s, it) => s + Number(it.amount || 0), 0)

  return (
    <div className="bg-zinc-100 min-h-screen py-8 print:bg-white print:py-0">
      <div className="max-w-[900px] mx-auto mb-4 px-4 print:hidden flex items-center justify-between">
        <button onClick={() => navigate('/supplier-invoices')} className="text-[13px] text-zinc-600 hover:text-zinc-900 flex items-center gap-1">
          ← 목록으로
        </button>
        <button onClick={() => window.print()} className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-[13px] font-medium hover:bg-zinc-700">
          🖨️ 인쇄
        </button>
      </div>

      <div className="max-w-[900px] mx-auto bg-white p-10 shadow-sm print:shadow-none print:p-0 print:max-w-none">
        <h1 className="text-center text-[28px] font-bold tracking-[0.3em] mb-6">공 급 처 계 산 서</h1>

        {/* 공장(공급처) + 기간 */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div className="border-2 border-zinc-800 px-4 py-3">
            <span className="text-[11px] text-zinc-500 mr-2">공급처(공장)</span>
            <span className="text-[16px] font-bold">{supplier?.name || '—'}</span>
            {supplier?.business_number && (
              <div className="text-[11px] text-zinc-500 mt-1">사업자 {supplier.business_number} · 대표 {supplier.ceo_name || ''}</div>
            )}
          </div>
          <div className="border-2 border-zinc-800 px-4 py-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-500">기간</span>
              <span className="text-[14px] font-semibold tabular-nums">{inv.period || ''}</span>
            </div>
            {inv.issue_date && (
              <div className="flex items-center justify-between mt-1">
                <span className="text-[11px] text-zinc-500">발행일</span>
                <span className="text-[12px] tabular-nums">{inv.issue_date}</span>
              </div>
            )}
            <div className="flex items-center justify-between mt-1 pt-1 border-t border-zinc-300">
              <span className="text-[11px] text-zinc-500">총 청구액</span>
              <span className="text-[16px] font-bold tabular-nums">₩{Number(inv.total || 0).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {inv.notes && (
          <div className="border border-zinc-300 px-3 py-2 text-[11px] text-zinc-600 mb-3 whitespace-pre-line">
            {inv.notes}
          </div>
        )}

        {/* 라인 표 */}
        <table className="w-full text-[12px] border-2 border-zinc-800 mt-3">
          <thead>
            <tr className="bg-zinc-100 border-b-2 border-zinc-800">
              <th className="px-2 py-2 border-r border-zinc-300 w-20">날짜</th>
              <th className="px-2 py-2 border-r border-zinc-300">품목</th>
              {showBrand && <th className="px-2 py-2 border-r border-zinc-300 w-20">상호</th>}
              <th className="px-2 py-2 border-r border-zinc-300 w-14">수량</th>
              <th className="px-2 py-2 border-r border-zinc-300 w-20">단가</th>
              <th className="px-2 py-2 w-24">금액</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={showBrand ? 6 : 5} className="text-center py-6 text-zinc-400">라인이 없습니다.</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className="border-b border-zinc-200">
                <td className="px-2 py-1.5 border-r border-zinc-200 text-center tabular-nums">{it.line_date || ''}</td>
                <td className="px-2 py-1.5 border-r border-zinc-200">{it.product_name || ''}</td>
                {showBrand && <td className="px-2 py-1.5 border-r border-zinc-200 text-center text-[11px]">{it.brand || ''}</td>}
                <td className="px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums">{Number(it.quantity).toLocaleString()}</td>
                <td className="px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums">{Number(it.unit_price).toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right tabular-nums font-medium">{Number(it.amount).toLocaleString()}</td>
              </tr>
            ))}
            {/* 합계 행 */}
            {items.length > 0 && (
              <tr className="bg-zinc-100 border-t-2 border-zinc-800 font-bold">
                <td colSpan={showBrand ? 3 : 2} className="px-2 py-2 text-center">합 계</td>
                <td className="px-2 py-2 text-right tabular-nums border-l border-zinc-300">{totalQty.toLocaleString()}</td>
                <td className="px-2 py-2 border-l border-zinc-300"></td>
                <td className="px-2 py-2 text-right tabular-nums bg-zinc-200">₩{totalAmount.toLocaleString()}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 상호별 집계 (브랜드 있을 때만) */}
        {showBrand && Object.keys(byBrand).filter(b => b !== '—').length > 1 && (
          <div className="mt-4 border border-zinc-300 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-2">상호별 집계</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
              {Object.entries(byBrand).map(([b, v]) => (
                <div key={b} className="border border-zinc-200 px-2 py-1.5 rounded">
                  <div className="font-medium text-zinc-800">{b}</div>
                  <div className="text-zinc-500 tabular-nums">{v.qty.toLocaleString()}장 · ₩{v.amount.toLocaleString()}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 풋터 */}
        <p className="text-center mt-8 text-[12px] text-zinc-600">위 금액을 청구함</p>
      </div>
    </div>
  )
}
