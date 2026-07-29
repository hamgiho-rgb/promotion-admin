import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Payment, Vendor, Invoice } from '@/lib/types'
import { Button, Input, PageHeader, Empty, Badge, Label } from '@/components/ui'
import VendorSearchSelect from '@/components/VendorSearchSelect'
import { exportSheet } from '@/lib/exportXlsx'

/* ─────────────────────────────────────────────
 * 입금 관리 페이지 — 모든 거래처 입금 내역 통합
 * - 거래처/날짜/메모 검색·필터
 * - 인라인 등록/수정/삭제
 * - 월별·거래처별 합계
 * - 엑셀 다운로드
 * ───────────────────────────────────────────── */

export default function Payments() {
  const navigate = useNavigate()
  const [payments, setPayments] = useState<Payment[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [vendorFilter, setVendorFilter] = useState<string>('all')
  const [monthFilter, setMonthFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Payment | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: pays }, { data: vends }, { data: invs }] = await Promise.all([
      supabase.from('payments').select('*').is('deleted_at', null).order('paid_date', { ascending: false }),
      supabase.from('vendors').select('*').eq('vendor_type', 'customer').is('deleted_at', null).order('name'),
      supabase.from('invoices').select('id, vendor_id, issue_date, total, notes').is('deleted_at', null).order('issue_date', { ascending: false }),
    ])
    setPayments((pays || []) as Payment[])
    setVendors((vends || []) as Vendor[])
    setInvoices((invs || []) as Invoice[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function vendorName(id: string) { return vendors.find(v => v.id === id)?.name || '—' }

  async function handleDelete(id: string) {
    if (!confirm('이 입금 내역을 삭제할까요?')) return
    const { error } = await supabase.from('payments').update({ deleted_at: new Date().toISOString() }).eq('id', id)
    if (error) { alert('삭제 실패: ' + error.message); return }
    load()
  }

  function openEdit(p: Payment) {
    setEditing(p)
    setModalOpen(true)
  }

  function openNew() {
    setEditing(null)
    setModalOpen(true)
  }

  async function handleSave(p: { vendor_id: string; paid_date: string; amount: number; memo: string; invoice_id: string | null }) {
    if (editing) {
      const { error } = await supabase.from('payments').update({
        vendor_id: p.vendor_id,
        paid_date: p.paid_date,
        amount: p.amount,
        memo: p.memo || null,
        invoice_id: p.invoice_id,
      }).eq('id', editing.id)
      if (error) { alert('수정 실패: ' + error.message); return }
    } else {
      const { error } = await supabase.from('payments').insert({
        vendor_id: p.vendor_id,
        paid_date: p.paid_date,
        amount: p.amount,
        memo: p.memo || null,
        invoice_id: p.invoice_id,
      })
      if (error) { alert('등록 실패: ' + error.message); return }
    }
    setModalOpen(false)
    setEditing(null)
    load()
  }

  // 데이터에 있는 월 목록
  const allMonths = Array.from(new Set(payments.map(p => p.paid_date.slice(0, 7)))).sort((a, b) => b.localeCompare(a))

  const filtered = payments.filter(p => {
    if (vendorFilter !== 'all' && p.vendor_id !== vendorFilter) return false
    if (monthFilter !== 'all' && !p.paid_date.startsWith(monthFilter)) return false
    if (search) {
      const s = search.toLowerCase()
      const vName = vendorName(p.vendor_id).toLowerCase()
      const memo = (p.memo || '').toLowerCase()
      if (!vName.includes(s) && !memo.includes(s)) return false
    }
    return true
  })

  const totalFiltered = filtered.reduce((s, p) => s + Number(p.amount || 0), 0)
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const thisMonthTotal = payments.filter(p => p.paid_date.startsWith(thisMonth)).reduce((s, p) => s + Number(p.amount || 0), 0)
  const thisYearTotal = payments.filter(p => p.paid_date.startsWith(String(now.getFullYear()))).reduce((s, p) => s + Number(p.amount || 0), 0)

  // 거래처별 합계 (top)
  const byVendor = new Map<string, number>()
  filtered.forEach(p => byVendor.set(p.vendor_id, (byVendor.get(p.vendor_id) || 0) + Number(p.amount || 0)))
  const topVendors = Array.from(byVendor.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5)

  function exportToExcel() {
    const rows: any[][] = []
    rows.push(['입금일', '거래처', '금액', '메모', '연결 계산서'])
    for (const p of filtered) {
      const inv = invoices.find(i => i.id === p.invoice_id)
      rows.push([
        p.paid_date,
        vendorName(p.vendor_id),
        Number(p.amount),
        p.memo || '',
        inv ? `${inv.issue_date} · ₩${Number(inv.total || 0).toLocaleString()}` : '',
      ])
    }
    rows.push([])
    rows.push(['', '합계', totalFiltered])
    exportSheet(rows, '입금내역', '입금내역')
  }

  return (
    <div>
      <PageHeader
        title="입금 관리"
        description="모든 거래처의 입금 내역을 한 화면에서 관리합니다."
        action={<>
          <Button variant="secondary" onClick={exportToExcel} disabled={filtered.length === 0}>📥 엑셀 내보내기</Button>
          <Button onClick={openNew}>＋ 새 입금 등록</Button>
        </>}
      />

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="이번 달 입금" value={`₩${thisMonthTotal.toLocaleString()}`} hint={thisMonth} accent="blue" />
        <StatCard label={`${now.getFullYear()}년 누적`} value={`₩${thisYearTotal.toLocaleString()}`} accent="violet" />
        <StatCard label="필터 합계" value={`₩${totalFiltered.toLocaleString()}`} hint={`${filtered.length}건`} accent="green" />
        <StatCard label="전체 입금 건수" value={`${payments.length}건`} hint={`${vendors.length}개 거래처`} accent="amber" />
      </div>

      {/* 거래처별 TOP 5 */}
      {topVendors.length > 0 && (
        <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden mb-4">
          <div className="px-4 py-2.5 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
            <h3 className="text-[13px] font-semibold text-zinc-800">🏢 거래처별 입금 합계 (TOP 5)</h3>
            <span className="text-[11px] text-zinc-500">필터된 결과 기준</span>
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {topVendors.map(([vId, amt], i) => (
                <tr key={vId} className="border-b border-zinc-50 last:border-b-0">
                  <td className="px-4 py-2 text-zinc-400 w-6 tabular-nums">{i + 1}</td>
                  <td className="px-2 py-2">
                    <button onClick={() => setVendorFilter(vId)} className="hover:underline text-zinc-800 font-medium">
                      {vendorName(vId)}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">₩{amt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 필터 + 리스트 */}
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        <div className="p-3 border-b border-zinc-100 flex items-center gap-3 flex-wrap">
          <div className="w-56">
            <VendorSearchSelect
              value={vendorFilter}
              vendors={vendors}
              onChange={setVendorFilter}
              allLabel="모든 거래처"
              placeholder="🔍 거래처 검색"
            />
          </div>
          <div className="w-36">
            <select
              value={monthFilter}
              onChange={e => setMonthFilter(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] bg-white"
            >
              <option value="all">전체 기간</option>
              {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[200px] max-w-md">
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="🔍 거래처명 / 메모 검색" />
          </div>
          <span className="text-[12px] text-zinc-500 ml-auto">
            {filtered.length}건 · <span className="font-semibold text-emerald-700 tabular-nums">₩{totalFiltered.toLocaleString()}</span>
          </span>
        </div>

        {loading ? (
          <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <Empty icon="💰" title={payments.length === 0 ? '등록된 입금 내역이 없어요' : '검색 결과가 없습니다'}
            description={payments.length === 0 ? '＋ 새 입금 등록 버튼으로 시작하세요.' : '필터를 조정해보세요.'} />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500 border-b border-zinc-100">
                <th className="px-4 py-2.5 w-28">입금일</th>
                <th className="px-4 py-2.5">거래처</th>
                <th className="px-4 py-2.5">메모</th>
                <th className="px-4 py-2.5">연결 계산서</th>
                <th className="px-4 py-2.5 text-right w-32">금액</th>
                <th className="px-4 py-2.5 text-right w-20">관리</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const inv = invoices.find(i => i.id === p.invoice_id)
                return (
                  <tr key={p.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                    <td className="px-4 py-2 tabular-nums text-zinc-700">{p.paid_date}</td>
                    <td className="px-4 py-2 font-medium text-zinc-900">{vendorName(p.vendor_id)}</td>
                    <td className="px-4 py-2 text-zinc-600 text-[12px]">{p.memo || '—'}</td>
                    <td className="px-4 py-2 text-[11px] text-zinc-500">
                      {inv ? (
                        <button
                          onClick={() => navigate(`/invoices?edit=${inv.id}`)}
                          className="hover:underline text-blue-600"
                          title="이 계산서 편집으로 이동"
                        >
                          {inv.issue_date} · ₩{Number(inv.total).toLocaleString()}
                        </button>
                      ) : <Badge color="zinc">일반 입금</Badge>}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums font-semibold text-emerald-700">
                      ₩{Number(p.amount).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => openEdit(p)} className="text-blue-500 hover:text-blue-700 px-1" title="수정">✎</button>
                      <button onClick={() => handleDelete(p.id)} className="text-rose-500 hover:text-rose-700 text-[16px] px-1" title="삭제">×</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="bg-zinc-900 text-white">
                <td colSpan={4} className="px-4 py-3 font-semibold">합 계</td>
                <td className="px-4 py-3 text-right tabular-nums font-bold">₩{totalFiltered.toLocaleString()}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>

      {modalOpen && (
        <PaymentModal
          initial={editing}
          vendors={vendors}
          invoices={invoices}
          defaultVendorId={vendorFilter !== 'all' ? vendorFilter : ''}
          onClose={() => { setModalOpen(false); setEditing(null) }}
          onSubmit={handleSave}
        />
      )}
    </div>
  )
}

function StatCard({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: 'blue'|'green'|'amber'|'violet' }) {
  const colors = {
    blue: 'from-blue-50 to-white border-blue-100',
    green: 'from-emerald-50 to-white border-emerald-100',
    amber: 'from-amber-50 to-white border-amber-100',
    violet: 'from-violet-50 to-white border-violet-100',
  }
  const bg = accent ? `bg-gradient-to-br ${colors[accent]}` : 'bg-white border-zinc-200'
  return (
    <div className={`border rounded-2xl p-4 ${bg}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="text-[22px] font-bold text-zinc-900 mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-[11px] text-zinc-500 mt-0.5">{hint}</p>}
    </div>
  )
}

/* 입금 등록/수정 모달 */
function PaymentModal({ initial, vendors, invoices, defaultVendorId, onClose, onSubmit }: {
  initial: Payment | null
  vendors: Vendor[]
  invoices: Invoice[]
  defaultVendorId?: string
  onClose: () => void
  onSubmit: (p: { vendor_id: string; paid_date: string; amount: number; memo: string; invoice_id: string | null }) => void
}) {
  const isEdit = !!initial
  const today = new Date().toISOString().slice(0, 10)
  const [vendorId, setVendorId] = useState<string>(initial?.vendor_id || defaultVendorId || '')
  const [paidDate, setPaidDate] = useState(initial?.paid_date || today)
  const [amount, setAmount] = useState<number | ''>(initial ? Number(initial.amount) : '')
  const [memo, setMemo] = useState(initial?.memo || '')
  const [invoiceId, setInvoiceId] = useState<string>(initial?.invoice_id || '')
  const [submitting, setSubmitting] = useState(false)

  const vendorInvoices = vendorId ? invoices.filter(i => i.vendor_id === vendorId) : []

  function handleSubmit() {
    if (!vendorId) { alert('거래처를 선택해주세요.'); return }
    const amt = Number(amount) || 0
    if (amt <= 0) { alert('금액을 입력해주세요.'); return }
    if (!paidDate) { alert('입금일을 선택해주세요.'); return }
    setSubmitting(true)
    onSubmit({
      vendor_id: vendorId,
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
          <h2 className="text-[16px] font-semibold text-zinc-900">{isEdit ? '✎ 입금 내역 수정' : '＋ 새 입금 등록'}</h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">{isEdit ? '입금 내역을 수정합니다' : '받은 입금 내역을 등록합니다'}</p>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <Label required>거래처</Label>
            <VendorSearchSelect
              value={vendorId || 'all'}
              vendors={vendors}
              onChange={v => { if (v !== 'all') setVendorId(v); setInvoiceId('') }}
              placeholder="🔍 거래처 검색"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label required>입금일</Label>
              <input
                type="date"
                value={paidDate}
                onChange={e => setPaidDate(e.target.value)}
                className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <Label required>금액</Label>
              <input
                type="number"
                value={amount}
                onChange={e => setAmount(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="0"
                className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[14px] text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div>
            <Label>연결 계산서 (선택)</Label>
            <select
              value={invoiceId}
              onChange={e => setInvoiceId(e.target.value)}
              disabled={!vendorId}
              className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            >
              <option value="">— 일반 입금 (특정 계산서 없음) —</option>
              {vendorInvoices.map(i => (
                <option key={i.id} value={i.id}>
                  {i.issue_date} · ₩{Number(i.total).toLocaleString()}{i.notes ? ` · ${i.notes.slice(0, 30)}` : ''}
                </option>
              ))}
            </select>
            {!vendorId && <p className="text-[10px] text-zinc-500 mt-1">거래처를 먼저 선택하면 그 거래처의 계산서 목록이 뜹니다.</p>}
          </div>
          <div>
            <Label>메모</Label>
            <input
              type="text"
              value={memo}
              onChange={e => setMemo(e.target.value)}
              placeholder="예: 1차 입금, 계좌이체, 5월분 결제"
              className="w-full px-3 py-2 rounded-md border border-zinc-300 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-md border border-zinc-300 text-zinc-700 text-[13px] hover:bg-zinc-50">취소</button>
          <button onClick={handleSubmit} disabled={submitting} className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[13px] font-medium disabled:opacity-50">
            {submitting ? '저장 중...' : (isEdit ? '수정 저장' : '등록')}
          </button>
        </div>
      </div>
    </div>
  )
}
