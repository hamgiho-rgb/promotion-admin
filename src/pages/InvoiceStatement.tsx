import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Invoice, Vendor } from '@/lib/types'
import { exportSheet } from '@/lib/exportXlsx'

/* ─────────────────────────────────────────────
 * 거래처 통합 정산서
 * URL: /invoices/statement?ids=id1,id2,id3
 * - 여러 계산서(5월+6월 등) 한 화면에 합산
 * - 각 계산서마다 받은 금액 입력 → 잔금 자동 계산
 * - 인쇄 / 엑셀 다운로드
 * ───────────────────────────────────────────── */

export default function InvoiceStatement() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const idsParam = params.get('ids') || ''
  const ids = idsParam.split(',').filter(Boolean)

  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [vendor, setVendor] = useState<Vendor | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => { load() }, [idsParam])

  async function load() {
    if (ids.length === 0) { setLoading(false); return }
    setLoading(true)
    const { data: invs } = await supabase.from('invoices')
      .select('*').in('id', ids).is('deleted_at', null).order('issue_date')
    setInvoices((invs || []) as Invoice[])
    // 거래처 (첫 계산서 기준)
    if (invs && invs.length > 0) {
      const { data: v } = await supabase.from('vendors').select('*').eq('id', invs[0].vendor_id).single()
      setVendor(v as Vendor)
    }
    setLoading(false)
  }

  async function updateReceived(invoiceId: string, value: number) {
    setSavingId(invoiceId)
    const { error } = await supabase.from('invoices').update({ received_amount: value }).eq('id', invoiceId)
    setSavingId(null)
    if (error) { alert('수정 실패: ' + error.message); return }
    setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, received_amount: value } : i))
  }

  if (loading) return <div className="p-10 text-center text-zinc-400">불러오는 중...</div>
  if (invoices.length === 0) return (
    <div className="p-10 text-center text-rose-600">
      정산서로 묶을 계산서가 없어요. 계산서 페이지에서 여러 건 선택 후 다시 시도해주세요.
    </div>
  )

  // 거래처 다양하면 경고
  const vendorIds = Array.from(new Set(invoices.map(i => i.vendor_id)))
  const sameVendor = vendorIds.length === 1

  const totalBilled = invoices.reduce((s, i) => s + Number(i.total || 0), 0)
  const totalDeposit = invoices.reduce((s, i) => s + Number(i.deposit_amount || 0), 0)
  const totalReceived = invoices.reduce((s, i) => s + Number((i as any).received_amount || 0), 0)
  const outstanding = totalBilled - totalDeposit - totalReceived

  function balance(inv: Invoice) {
    return Number(inv.total || 0) - Number(inv.deposit_amount || 0) - Number((inv as any).received_amount || 0)
  }

  function exportToExcel() {
    const rows: any[][] = []
    rows.push(['정 산 서'])
    rows.push([])
    rows.push(['거래처', vendor?.name || '—', '회사명', vendor?.company_name || ''])
    rows.push(['작성일', new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' })])
    rows.push(['계산서 수', invoices.length])
    rows.push([])
    rows.push(['발행일', '계산서 메모/기간', '청구 금액', '계약금', '수금액', '잔금'])
    for (const inv of invoices) {
      rows.push([
        inv.issue_date || '',
        (inv.notes || '').slice(0, 50),
        Number(inv.total || 0),
        Number(inv.deposit_amount || 0),
        Number((inv as any).received_amount || 0),
        balance(inv),
      ])
    }
    rows.push([])
    rows.push(['', '합계', totalBilled, totalDeposit, totalReceived, outstanding])
    const fname = `정산서_${vendor?.name || '거래처'}`
    exportSheet(rows, '정산서', fname)
  }

  const today = new Date().toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="bg-zinc-100 min-h-screen py-8 print:bg-white print:py-0">
      {/* 상단 액션 바 (인쇄 시 숨김) */}
      <div className="max-w-[900px] mx-auto mb-4 flex items-center justify-between print:hidden">
        <button onClick={() => navigate('/invoices')} className="text-[13px] text-zinc-600 hover:text-zinc-900">
          ← 계산서 목록으로
        </button>
        <div className="flex gap-2">
          <button
            onClick={exportToExcel}
            className="px-4 py-2 bg-violet-600 text-white rounded-lg text-[13px] font-medium hover:bg-violet-700"
          >
            📥 엑셀 다운로드
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-[13px] font-medium hover:bg-zinc-800"
          >
            🖨️ 인쇄 / PDF 저장
          </button>
        </div>
      </div>

      {!sameVendor && (
        <div className="max-w-[900px] mx-auto mb-4 p-3 rounded-lg bg-amber-50 border border-amber-300 text-[12px] text-amber-800 print:hidden">
          ⚠ 선택한 계산서들의 거래처가 서로 다릅니다 ({vendorIds.length}곳). 한 거래처씩 정산서를 만드는 것을 권장합니다.
        </div>
      )}

      {/* 인쇄 영역 */}
      <div className="max-w-[900px] mx-auto bg-white shadow-sm print:shadow-none">
        <div className="p-10 print:p-8" style={{ fontFamily: "'Pretendard','맑은 고딕',sans-serif" }}>
          <h1 className="text-center text-2xl font-bold tracking-wider mb-1">정 산 서</h1>
          <p className="text-center text-[12px] text-zinc-500 mb-8">{today}</p>

          {/* 거래처 정보 */}
          <table className="w-full border border-zinc-300 text-[12px] mb-6">
            <tbody>
              <tr className="border-b border-zinc-200">
                <td className="bg-zinc-50 px-3 py-2 w-24 font-medium border-r border-zinc-200">거래처</td>
                <td className="px-3 py-2">
                  {vendor?.name || '—'}
                  {vendor?.company_name && <span className="text-zinc-500"> ({vendor.company_name})</span>}
                </td>
                <td className="bg-zinc-50 px-3 py-2 w-24 font-medium border-l border-r border-zinc-200">계산서 수</td>
                <td className="px-3 py-2 text-right tabular-nums">{invoices.length}건</td>
              </tr>
              {vendor?.address && (
                <tr>
                  <td className="bg-zinc-50 px-3 py-2 font-medium border-r border-zinc-200">주소</td>
                  <td className="px-3 py-2 text-[11px]" colSpan={3}>{vendor.address}</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 계산서별 정산표 */}
          <table className="w-full border border-zinc-300 text-[12px] mb-6">
            <thead>
              <tr className="bg-zinc-100 border-b border-zinc-300 text-[11px]">
                <th className="px-3 py-2 text-left border-r border-zinc-200 w-24">발행일</th>
                <th className="px-3 py-2 text-left border-r border-zinc-200">계산서 메모/기간</th>
                <th className="px-3 py-2 text-right border-r border-zinc-200 w-28">청구 금액</th>
                <th className="px-3 py-2 text-right border-r border-zinc-200 w-24">계약금</th>
                <th className="px-3 py-2 text-right border-r border-zinc-200 w-28">수금액</th>
                <th className="px-3 py-2 text-right w-28">잔금</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const bal = balance(inv)
                return (
                  <tr key={inv.id} className="border-b border-zinc-100">
                    <td className="px-3 py-2 border-r border-zinc-200 tabular-nums">{inv.issue_date}</td>
                    <td className="px-3 py-2 border-r border-zinc-200 text-[11px]">
                      {(inv.notes || '').replace(/^\[[^\]]+\]\s*/, '').slice(0, 80) || '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums border-r border-zinc-200">₩{Number(inv.total || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums border-r border-zinc-200 text-zinc-600">
                      {Number(inv.deposit_amount || 0) > 0 ? `₩${Number(inv.deposit_amount).toLocaleString()}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums border-r border-zinc-200">
                      {/* 인쇄 시에는 값만 보이고, 화면에서는 input */}
                      <span className="print:inline hidden">₩{Number((inv as any).received_amount || 0).toLocaleString()}</span>
                      <input
                        type="number"
                        defaultValue={Number((inv as any).received_amount || 0) || ''}
                        onBlur={e => {
                          const val = Number(e.target.value) || 0
                          if (val !== Number((inv as any).received_amount || 0)) updateReceived(inv.id, val)
                        }}
                        placeholder="0"
                        disabled={savingId === inv.id}
                        className="print:hidden w-full text-right border border-zinc-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
                      />
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-semibold ${bal > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      ₩{bal.toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-100 border-t-2 border-zinc-300 font-semibold">
                <td colSpan={2} className="px-3 py-2.5 text-right">합 계</td>
                <td className="px-3 py-2.5 text-right tabular-nums">₩{totalBilled.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-zinc-600">₩{totalDeposit.toLocaleString()}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">₩{totalReceived.toLocaleString()}</td>
                <td className={`px-3 py-2.5 text-right tabular-nums text-[14px] ${outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  ₩{outstanding.toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>

          {/* 큰 요약 박스 */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="border border-zinc-300 rounded p-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider">총 청구액</p>
              <p className="text-[20px] font-bold tabular-nums mt-1">₩{totalBilled.toLocaleString()}</p>
            </div>
            <div className="border border-zinc-300 rounded p-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider">받은 금액</p>
              <p className="text-[20px] font-bold tabular-nums mt-1 text-zinc-700">₩{(totalDeposit + totalReceived).toLocaleString()}</p>
              {totalDeposit > 0 && <p className="text-[10px] text-zinc-400 mt-1">계약금 ₩{totalDeposit.toLocaleString()} + 수금 ₩{totalReceived.toLocaleString()}</p>}
            </div>
            <div className={`border rounded p-4 ${outstanding > 0 ? 'border-rose-300 bg-rose-50' : 'border-emerald-300 bg-emerald-50'}`}>
              <p className={`text-[11px] uppercase tracking-wider ${outstanding > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                {outstanding > 0 ? '잔금 (미수)' : outstanding < 0 ? '초과 수령' : '완납'}
              </p>
              <p className={`text-[22px] font-bold tabular-nums mt-1 ${outstanding > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                ₩{outstanding.toLocaleString()}
              </p>
            </div>
          </div>

          {vendor?.bank_info && (
            <p className="text-[11px] text-zinc-600 mt-6">
              <strong>입금 계좌:</strong> {vendor.bank_info}
            </p>
          )}
          <p className="text-center text-[10px] text-zinc-400 mt-6">위 금액을 청구합니다.</p>
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 12mm; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
    </div>
  )
}
