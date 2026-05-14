import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Quotation, QuotationItem, Vendor } from '@/lib/types'
import { toKRDate } from '@/lib/datetime'

export default function QuotationPrint() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [q, setQ] = useState<Quotation | null>(null)
  const [items, setItems] = useState<QuotationItem[]>([])
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [id])

  async function load() {
    if (!id) return
    setLoading(true)
    const { data: qd } = await supabase.from('quotations').select('*').eq('id', id).single()
    if (!qd) { setLoading(false); return }
    setQ(qd)
    const { data: lns } = await supabase.from('quotation_items').select('*').eq('quotation_id', id).order('sort_order')
    setItems(lns ?? [])
    const { data: v } = await supabase.from('vendors').select('*').eq('id', qd.vendor_id).single()
    setVendor(v ?? null)
    setLoading(false)
  }

  if (loading) return <div className="p-10 text-center text-zinc-400">불러오는 중...</div>
  if (!q) return <div className="p-10 text-center text-rose-600">견적서를 찾을 수 없습니다.</div>

  const subtotal = items.reduce((s, i) => s + Number(i.amount || 0), 0)
  const vat = Math.round(subtotal * 0.1)
  const total = subtotal + vat
  const depositAmount = Math.round(total * Number(q.deposit_rate || 0) / 100)
  const balance = total - depositAmount

  // 유효 만료일
  const issueDate = new Date(q.issue_date)
  const validUntil = new Date(issueDate)
  validUntil.setDate(validUntil.getDate() + (q.validity_days || 30))
  const validUntilStr = toKRDate(validUntil)

  return (
    <div className="bg-zinc-100 min-h-screen py-8 print:bg-white print:py-0">
      <div className="max-w-[800px] mx-auto mb-4 flex items-center justify-between print:hidden">
        <button onClick={() => navigate('/quotations')} className="text-[13px] text-zinc-600 hover:text-zinc-900">← 목록으로</button>
        <button onClick={() => window.print()} className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-[13px] font-medium hover:bg-zinc-800">
          🖨️ 인쇄 / PDF 저장
        </button>
      </div>

      <div className="max-w-[800px] mx-auto bg-white shadow-sm print:shadow-none">
        <div className="p-10 print:p-8" style={{ fontFamily: "'Pretendard','맑은 고딕',sans-serif" }}>
          {/* 제목 */}
          <h1 className="text-center text-2xl font-bold tracking-wider mb-1">견 적 서</h1>
          <p className="text-center text-[11px] text-zinc-500 mb-8">Q U O T A T I O N</p>

          {/* 받는 곳 + 공급자 */}
          <div className="grid grid-cols-2 gap-6 mb-6 text-[13px]">
            <div className="border-t-2 border-b border-zinc-800 py-3">
              <p className="text-[10px] text-zinc-500 mb-1">받는 곳</p>
              <p className="text-[18px] font-semibold mb-1">{vendor?.name || '—'} 귀하</p>
              {vendor?.ceo_name && <p className="text-[12px] text-zinc-600">{vendor.ceo_name} 귀하</p>}
              <p className="text-[10px] text-zinc-500 mt-3">아래와 같이 견적서를 제출합니다.</p>
            </div>
            <div className="border border-zinc-300 rounded">
              <table className="w-full text-[11px]">
                <tbody>
                  <tr className="border-b border-zinc-200">
                    <td className="bg-zinc-50 px-2 py-1.5 w-20 font-medium border-r border-zinc-200">공급자</td>
                    <td className="px-2 py-1.5">{q.supplier_name}</td>
                  </tr>
                  <tr className="border-b border-zinc-200">
                    <td className="bg-zinc-50 px-2 py-1.5 font-medium border-r border-zinc-200">사업자번호</td>
                    <td className="px-2 py-1.5 tabular-nums">{q.supplier_business_number}</td>
                  </tr>
                  <tr className="border-b border-zinc-200">
                    <td className="bg-zinc-50 px-2 py-1.5 font-medium border-r border-zinc-200">대표자</td>
                    <td className="px-2 py-1.5">{q.supplier_ceo}</td>
                  </tr>
                  <tr>
                    <td className="bg-zinc-50 px-2 py-1.5 font-medium border-r border-zinc-200">소재지</td>
                    <td className="px-2 py-1.5 text-[10px]">{q.supplier_address}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* 발행일 + 유효기간 + 총액 */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div className="border-2 border-zinc-800 px-3 py-2">
              <p className="text-[10px] text-zinc-500">발행일</p>
              <p className="text-[13px] font-medium">{q.issue_date}</p>
            </div>
            <div className="border-2 border-zinc-800 px-3 py-2">
              <p className="text-[10px] text-zinc-500">유효기간</p>
              <p className="text-[13px] font-medium">~ {validUntilStr}</p>
            </div>
            <div className="border-2 border-zinc-800 px-3 py-2 flex items-center justify-between bg-zinc-50">
              <span className="text-[10px] text-zinc-500">견적 금액</span>
              <span className="text-[16px] font-bold tabular-nums">₩{total.toLocaleString()}</span>
            </div>
          </div>

          {/* 항목 표 */}
          <table className="w-full text-[12px] border-2 border-zinc-800 mt-3">
            <thead>
              <tr className="bg-zinc-100 border-b-2 border-zinc-800">
                <th className="px-2 py-2 border-r border-zinc-300 w-10">번호</th>
                <th className="px-2 py-2 border-r border-zinc-300">품명</th>
                <th className="px-2 py-2 border-r border-zinc-300 w-20">컬러</th>
                <th className="px-2 py-2 border-r border-zinc-300 w-24">사이즈</th>
                <th className="px-2 py-2 border-r border-zinc-300 w-16">수량</th>
                <th className="px-2 py-2 border-r border-zinc-300 w-20">단가</th>
                <th className="px-2 py-2 w-24">금액</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-6 text-zinc-400">등록된 항목이 없습니다.</td></tr>
              ) : items.map((it, i) => (
                <tr key={it.id} className="border-b border-zinc-200">
                  <td className="px-2 py-1.5 border-r border-zinc-200 text-center tabular-nums">{i + 1}</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200">{it.product_name || ''}</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200 text-center">{it.color || ''}</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200 text-center">{it.size_info || ''}</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums">{Number(it.quantity).toLocaleString()}</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200 text-right tabular-nums">{Number(it.unit_price).toLocaleString()}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums font-medium">{Number(it.amount).toLocaleString()}</td>
                </tr>
              ))}
              {items.length > 0 && items.length < 8 && Array.from({ length: 8 - items.length }).map((_, i) => (
                <tr key={`empty-${i}`} className="border-b border-zinc-200">
                  <td className="px-2 py-1.5 border-r border-zinc-200 h-6">&nbsp;</td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5 border-r border-zinc-200"></td>
                  <td className="px-2 py-1.5"></td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* 합계 + 계약금 */}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div className="border border-zinc-300 p-3 text-[11px]">
              <p className="font-semibold mb-2">📌 결제 조건</p>
              {Number(q.deposit_rate) > 0 ? (
                <>
                  <p className="mb-1">• <strong>계약금 {q.deposit_rate}%</strong> 선납 후 작업 시작</p>
                  <p className="mb-1">• 잔금 {(100 - Number(q.deposit_rate)).toFixed(0)}% 납품 시 정산</p>
                </>
              ) : (
                <p className="mb-1">• 납품 시 일시불 결제</p>
              )}
              <p className="text-[10px] text-zinc-500 mt-2 whitespace-pre-line">{q.bank_info}</p>
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
              {Number(q.deposit_rate) > 0 && (
                <>
                  <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-1.5 border-b border-zinc-300 text-[12px] bg-amber-50">
                    <span className="text-amber-700">계약금 ({q.deposit_rate}%)</span>
                    <span className="tabular-nums font-semibold">₩{depositAmount.toLocaleString()}</span>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] gap-x-4 px-3 py-1.5 text-[12px]">
                    <span className="text-zinc-500">잔금</span>
                    <span className="tabular-nums">₩{balance.toLocaleString()}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          {q.notes && (
            <div className="mt-4 text-[12px] text-zinc-600 border-t border-zinc-200 pt-3">
              <p className="text-[10px] text-zinc-500 mb-1">비고</p>
              <p className="whitespace-pre-line">{q.notes}</p>
            </div>
          )}

          <p className="text-center mt-8 text-[13px] font-medium">위와 같이 견적합니다.</p>
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
