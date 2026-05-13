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
        <div className="flex gap-2">
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
          <table className="w-full text-[12px] border-2 border-zinc-800 mt-3">
            <thead>
              <tr className="bg-zinc-100 border-b-2 border-zinc-800">
                <th className="px-2 py-2 border-r border-zinc-300 w-24">날짜</th>
                <th className="px-2 py-2 border-r border-zinc-300">품명</th>
                <th className="px-2 py-2 border-r border-zinc-300 w-20">칼라</th>
                <th className="px-2 py-2 border-r border-zinc-300 w-16">수량</th>
                <th className="px-2 py-2 border-r border-zinc-300 w-20">단가</th>
                <th className="px-2 py-2 w-24">금액</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-zinc-400">등록된 거래 라인이 없습니다.</td></tr>
              ) : items.map(it => (
                <tr key={it.id} className={`border-b border-zinc-200 ${it.is_return ? 'bg-rose-50/50' : ''}`}>
                  <td className="px-2 py-1.5 border-r border-zinc-200 text-center tabular-nums">{it.line_date || ''}</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200">{it.product_name || ''}</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200 text-center">{it.color || ''}</td>
                  <td className={`px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums ${it.is_return ? 'text-rose-700' : ''}`}>
                    {Number(it.quantity).toLocaleString()}
                  </td>
                  <td className="px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums">{Number(it.unit_price).toLocaleString()}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums font-medium ${it.is_return ? 'text-rose-700' : ''}`}>
                    {Number(it.amount).toLocaleString()}
                  </td>
                </tr>
              ))}
              {/* 빈 줄들 (양식 미관용) */}
              {items.length > 0 && items.length < 10 && Array.from({ length: 10 - items.length }).map((_, i) => (
                <tr key={`empty-${i}`} className="border-b border-zinc-200">
                  <td className="px-2 py-1.5 border-r border-zinc-200 h-6">&nbsp;</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5"></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 하단: 계좌 + 합계 */}
          <div className="grid grid-cols-2 gap-6 mt-4">
            <div className="border border-zinc-300 p-3 text-[11px] whitespace-pre-line">
              {invoice.bank_info || ''}
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
