import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Invoice, Vendor, Payment } from '@/lib/types'
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
  const [payments, setPayments] = useState<Payment[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)

  useEffect(() => { load() }, [idsParam])

  async function load() {
    if (ids.length === 0) { setLoading(false); return }
    setLoading(true)
    const { data: invs } = await supabase.from('invoices')
      .select('*').in('id', ids).is('deleted_at', null).order('issue_date')
    setInvoices((invs || []) as Invoice[])
    // 거래처 (첫 계산서 기준)
    if (invs && invs.length > 0) {
      const v_id = invs[0].vendor_id
      const { data: v } = await supabase.from('vendors').select('*').eq('id', v_id).single()
      setVendor(v as Vendor)
      // 그 거래처의 모든 입금 내역 (이 계산서들에 연결됐든 일반이든 다)
      const { data: pays } = await supabase.from('payments')
        .select('*').eq('vendor_id', v_id).is('deleted_at', null).order('paid_date', { ascending: false })
      setPayments((pays || []) as Payment[])
    }
    setLoading(false)
  }

  async function addPayment(p: { paid_date: string; amount: number; memo: string; invoice_id: string | null }) {
    if (!vendor) return
    const { error } = await supabase.from('payments').insert({
      vendor_id: vendor.id,
      invoice_id: p.invoice_id,
      paid_date: p.paid_date,
      amount: p.amount,
      memo: p.memo || null,
    })
    if (error) { alert('등록 실패: ' + error.message); return }
    setPaymentModalOpen(false)
    load()
  }

  async function deletePayment(id: string) {
    if (!confirm('이 입금 내역을 삭제할까요?')) return
    const { error } = await supabase.from('payments').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) { alert('삭제 실패: ' + error.message); return }
    load()
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
  const totalPayments = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const outstanding = totalBilled - totalDeposit - totalReceived - totalPayments

  function balance(inv: Invoice) {
    // 이 계산서에 직접 연결된 입금만 차감 (일반 입금은 거래처 전체 잔금에만)
    const directPayments = payments.filter(p => p.invoice_id === inv.id).reduce((s, p) => s + Number(p.amount || 0), 0)
    return Number(inv.total || 0) - Number(inv.deposit_amount || 0) - Number((inv as any).received_amount || 0) - directPayments
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

          {/* 거래처 원장 (통장처럼) — 날짜 | 청구/입금 | 잔금 */}
          <div className="mt-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[14px] font-semibold text-zinc-800">📒 거래처 원장 — 청구·입금 흐름</h3>
              <button
                onClick={() => setPaymentModalOpen(true)}
                className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-medium print:hidden"
              >＋ 입금 등록</button>
            </div>
            {(() => {
              // 청구(계산서) + 입금(payments) 를 한 리스트로 시간순 정렬 + running balance 계산
              type Event = { date: string; kind: 'invoice' | 'payment'; billed: number; received: number; memo: string; id: string; sort: number }
              const events: Event[] = []
              invoices.forEach(inv => events.push({
                date: inv.issue_date || '',
                kind: 'invoice',
                billed: Number(inv.total || 0),
                received: 0,
                memo: `계산서 발행${inv.notes ? ' · ' + inv.notes.replace(/^\[[^\]]+\]\s*/, '').slice(0, 50) : ''}`,
                id: inv.id,
                sort: 0,   // 같은 날짜면 청구가 먼저
              }))
              // 견적서 계약금이 있으면 그것도 계산서와 함께 (같은 날에 −계약금)
              invoices.forEach(inv => {
                if (Number(inv.deposit_amount || 0) > 0) {
                  events.push({
                    date: inv.issue_date || '',
                    kind: 'payment',
                    billed: 0,
                    received: Number(inv.deposit_amount),
                    memo: '견적서 계약금 (선납)',
                    id: `dep-${inv.id}`,
                    sort: 1,
                  })
                }
              })
              payments.forEach(p => events.push({
                date: p.paid_date,
                kind: 'payment',
                billed: 0,
                received: Number(p.amount || 0),
                memo: p.memo || '입금',
                id: p.id,
                sort: 1,
              }))
              events.sort((a, b) => a.date.localeCompare(b.date) || a.sort - b.sort)
              let running = 0
              const rows = events.map(e => {
                running += e.billed - e.received
                return { ...e, balance: running }
              })
              if (rows.length === 0) {
                return (
                  <div className="border border-zinc-200 rounded p-4 text-center text-[12px] text-zinc-400">
                    원장 내역이 없습니다.
                  </div>
                )
              }
              return (
                <table className="w-full border border-zinc-300 text-[12px]">
                  <thead>
                    <tr className="bg-zinc-100 border-b border-zinc-300 text-[11px]">
                      <th className="px-3 py-2 text-left border-r border-zinc-200 w-28">날짜</th>
                      <th className="px-3 py-2 text-left border-r border-zinc-200">내용</th>
                      <th className="px-3 py-2 text-right border-r border-zinc-200 w-28">청구 (+)</th>
                      <th className="px-3 py-2 text-right border-r border-zinc-200 w-28">입금 (−)</th>
                      <th className="px-3 py-2 text-right border-r border-zinc-200 w-32">잔금</th>
                      <th className="px-3 py-2 w-10 print:hidden"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e) => (
                      <tr key={e.id} className={`border-b border-zinc-100 ${e.kind === 'payment' ? 'bg-emerald-50/40' : ''}`}>
                        <td className="px-3 py-2 border-r border-zinc-200 tabular-nums">{e.date}</td>
                        <td className="px-3 py-2 border-r border-zinc-200">
                          <span className={`text-[10px] font-semibold uppercase mr-1.5 ${e.kind === 'invoice' ? 'text-rose-600' : 'text-emerald-600'}`}>
                            {e.kind === 'invoice' ? '청구' : '입금'}
                          </span>
                          {e.memo}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums border-r border-zinc-200">
                          {e.billed > 0 ? <span className="text-rose-700 font-medium">+₩{e.billed.toLocaleString()}</span> : ''}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums border-r border-zinc-200">
                          {e.received > 0 ? <span className="text-emerald-700 font-medium">−₩{e.received.toLocaleString()}</span> : ''}
                        </td>
                        <td className={`px-3 py-2 text-right tabular-nums font-semibold border-r border-zinc-200 ${e.balance > 0 ? 'text-rose-700' : e.balance < 0 ? 'text-blue-700' : 'text-emerald-700'}`}>
                          ₩{e.balance.toLocaleString()}
                        </td>
                        <td className="px-1 py-2 text-center print:hidden">
                          {e.kind === 'payment' && !e.id.startsWith('dep-') && (
                            <button onClick={() => deletePayment(e.id)} className="text-rose-500 hover:text-rose-700 text-[16px]" title="입금 내역 삭제">×</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-zinc-900 text-white">
                      <td colSpan={2} className="px-3 py-2.5 font-semibold">합 계</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-300">+₩{totalBilled.toLocaleString()}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-300">−₩{(totalDeposit + totalPayments + totalReceived).toLocaleString()}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold text-[14px] ${outstanding > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                        ₩{outstanding.toLocaleString()}
                      </td>
                      <td className="print:hidden"></td>
                    </tr>
                  </tfoot>
                </table>
              )
            })()}
          </div>

          {/* 큰 요약 박스 */}
          <div className="grid grid-cols-3 gap-3 mt-6">
            <div className="border border-zinc-300 rounded p-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider">총 청구액</p>
              <p className="text-[20px] font-bold tabular-nums mt-1">₩{totalBilled.toLocaleString()}</p>
            </div>
            <div className="border border-zinc-300 rounded p-4">
              <p className="text-[11px] text-zinc-500 uppercase tracking-wider">받은 금액</p>
              <p className="text-[20px] font-bold tabular-nums mt-1 text-zinc-700">₩{(totalDeposit + totalReceived + totalPayments).toLocaleString()}</p>
              <div className="text-[10px] text-zinc-400 mt-1 space-y-0.5">
                {totalDeposit > 0 && <div>계약금 ₩{totalDeposit.toLocaleString()}</div>}
                {totalPayments > 0 && <div>입금 내역 ₩{totalPayments.toLocaleString()} ({payments.length}건)</div>}
                {totalReceived > 0 && <div>기타 수금 ₩{totalReceived.toLocaleString()}</div>}
              </div>
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

      {/* 입금 등록 모달 */}
      {paymentModalOpen && (
        <PaymentModal
          invoices={invoices}
          defaultAmount={outstanding > 0 ? outstanding : 0}
          onClose={() => setPaymentModalOpen(false)}
          onSubmit={addPayment}
        />
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
 * 입금 등록 모달 — 날짜/금액/메모 + 특정 계산서 연결 선택
 * ───────────────────────────────────────────── */
function PaymentModal({ invoices, defaultAmount, onClose, onSubmit }: {
  invoices: Invoice[]
  defaultAmount: number
  onClose: () => void
  onSubmit: (p: { paid_date: string; amount: number; memo: string; invoice_id: string | null }) => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [paidDate, setPaidDate] = useState(today)
  const [amount, setAmount] = useState<number | ''>(defaultAmount || '')
  const [memo, setMemo] = useState('')
  const [invoiceId, setInvoiceId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  function handleSubmit() {
    const amt = Number(amount) || 0
    if (amt <= 0) { alert('금액을 입력해주세요.'); return }
    if (!paidDate) { alert('입금일을 선택해주세요.'); return }
    setSubmitting(true)
    onSubmit({
      paid_date: paidDate,
      amount: amt,
      memo: memo.trim(),
      invoice_id: invoiceId || null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-100">
          <h2 className="text-[16px] font-semibold text-zinc-900">＋ 입금 등록</h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">받은 입금 내역을 등록합니다</p>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[12px] font-medium text-zinc-700 mb-1">입금일 *</label>
            <input
              type="date"
              value={paidDate}
              onChange={e => setPaidDate(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-zinc-700 mb-1">금액 *</label>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
              placeholder="0"
              autoFocus
              className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[14px] text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {defaultAmount > 0 && (
              <p className="text-[10px] text-zinc-500 mt-1">💡 현재 잔금 ₩{defaultAmount.toLocaleString()} 자동 채워짐</p>
            )}
          </div>
          <div>
            <label className="block text-[12px] font-medium text-zinc-700 mb-1">연결 계산서 (선택)</label>
            <select
              value={invoiceId}
              onChange={e => setInvoiceId(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">— 일반 입금 (특정 계산서 X) —</option>
              {invoices.map(i => (
                <option key={i.id} value={i.id}>
                  {i.issue_date} · ₩{Number(i.total).toLocaleString()}{i.notes ? ` · ${i.notes.slice(0, 30)}` : ''}
                </option>
              ))}
            </select>
            <p className="text-[10px] text-zinc-500 mt-1">특정 계산서 잔금에서 차감하려면 선택. 비워두면 거래처 전체 잔금에서만 차감.</p>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-zinc-700 mb-1">메모</label>
            <input
              type="text"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="예: 1차 입금, 계좌이체 등"
              className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md border border-zinc-300 text-zinc-700 text-[13px] hover:bg-zinc-50">취소</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium disabled:opacity-50">
            {submitting ? '등록 중...' : '등록'}
          </button>
        </div>
      </div>
    </div>
  )
}
