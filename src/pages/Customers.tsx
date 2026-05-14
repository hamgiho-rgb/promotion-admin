import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor, Invoice, InvoiceItem, Product } from '@/lib/types'
import { Button, Input, Textarea, Label, PageHeader, Drawer, Empty, Badge } from '@/components/ui'
import SizePicker from '@/components/SizePicker'
import { exportSheet, rowsToSheet } from '@/lib/exportXlsx'
import FlatImportButton from '@/components/FlatImportButton'
import { softDelete } from '@/lib/trash'

/* 메모에서 "품목: A, B, C" 파싱 */
function parseItems(memo: string | null | undefined): string[] {
  if (!memo) return []
  const m = memo.match(/품목\s*:\s*(.+?)(?=$|\n)/)
  if (!m) return []
  return m[1].split(',').map(s => s.trim()).filter(Boolean)
}
/* 메모에 품목 리스트 다시 쓰기 */
function setItemsInMemo(memo: string, items: string[]): string {
  let body = memo.replace(/\s*\|\s*품목\s*:[^\n]*/g, '').replace(/품목\s*:[^\n]*/g, '').trim()
  if (items.length === 0) return body
  return body ? `${body} | 품목: ${items.join(', ')}` : `품목: ${items.join(', ')}`
}

type Tab = 'all' | 'contacts' | 'sales'

interface VendorStats {
  thisMonthRevenue: number
  thisMonthCount: number
  ytdRevenue: number
  ytdCount: number
  productCount: number
}

/* ───── 고객 거래처 (내가 납품하는 브랜드) ───── */
export default function Customers() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [statsMap, setStatsMap] = useState<Map<string, VendorStats>>(new Map())
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [salesDrawerVendor, setSalesDrawerVendor] = useState<Vendor | null>(null)
  const [mergingFrom, setMergingFrom] = useState<Vendor | null>(null)  // 병합 모달 — 원본(없어질 거래처)

  async function load() {
    setLoading(true)
    const today = new Date()
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
    const thisYear = String(today.getFullYear())

    const [{ data: vData }, { data: invData }, { data: prodData }] = await Promise.all([
      supabase.from('vendors').select('*').eq('vendor_type', 'customer').is('deleted_at', null).order('name'),
      supabase.from('invoices').select('vendor_id, issue_date, total').is('deleted_at', null),
      supabase.from('products').select('vendor_id').is('deleted_at', null),
    ])
    setVendors(vData ?? [])

    const map = new Map<string, VendorStats>()
    ;(vData ?? []).forEach(v => {
      map.set(v.id, { thisMonthRevenue: 0, thisMonthCount: 0, ytdRevenue: 0, ytdCount: 0, productCount: 0 })
    })
    ;(invData ?? []).forEach((inv: any) => {
      const s = map.get(inv.vendor_id)
      if (!s) return
      const total = Number(inv.total || 0)
      if (inv.issue_date?.startsWith(thisYear)) {
        s.ytdRevenue += total
        s.ytdCount += 1
        if (inv.issue_date?.startsWith(thisMonth)) {
          s.thisMonthRevenue += total
          s.thisMonthCount += 1
        }
      }
    })
    ;(prodData ?? []).forEach((p: any) => {
      const s = map.get(p.vendor_id)
      if (s) s.productCount += 1
    })
    setStatsMap(map)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(v: Vendor) {
    if (!confirm(`'${v.name}' 거래처를 휴지통으로 옮길까요?\n30일 안에 휴지통에서 복구할 수 있어요.`)) return
    const { error } = await softDelete('vendors', v.id)
    if (error) return alert('삭제 실패: ' + error.message)
    load()
  }

  /**
   * 거래처 병합: fromVendor의 모든 참조를 toVendor로 옮기고 fromVendor 삭제.
   * 영향 받는 테이블: products, incoming, invoices, quotations, cost_items(supplier_id), supplier_invoices(supplier_id)
   */
  async function mergeVendor(fromVendor: Vendor, toVendor: Vendor) {
    if (fromVendor.id === toVendor.id) return alert('같은 거래처입니다.')
    if (!confirm(
`'${fromVendor.name}'의 모든 데이터를 '${toVendor.name}'로 합칠까요?

- ${fromVendor.name}에 딸린 상품·입고·계산서·견적서·원가 모두 ${toVendor.name}로 옮겨집니다.
- 옮긴 뒤 '${fromVendor.name}' 거래처는 삭제됩니다.
- 되돌릴 수 없어요.`
    )) return

    // 1) 참조 업데이트 (각 테이블 vendor_id 또는 supplier_id를 to로 변경)
    const updates = [
      supabase.from('products').update({ vendor_id: toVendor.id }).eq('vendor_id', fromVendor.id),
      supabase.from('incoming').update({ vendor_id: toVendor.id }).eq('vendor_id', fromVendor.id),
      supabase.from('invoices').update({ vendor_id: toVendor.id }).eq('vendor_id', fromVendor.id),
      supabase.from('quotations').update({ vendor_id: toVendor.id }).eq('vendor_id', fromVendor.id),
      supabase.from('cost_items').update({ supplier_id: toVendor.id }).eq('supplier_id', fromVendor.id),
      supabase.from('supplier_invoices').update({ supplier_id: toVendor.id }).eq('supplier_id', fromVendor.id),
    ]
    const results = await Promise.all(updates)
    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      alert('일부 업데이트 실패: ' + failed.map(f => f.error?.message).join(', '))
      return
    }

    // 2) 원본 vendor 삭제 — 이제 참조가 모두 옮겨졌으니 안전
    const { error } = await supabase.from('vendors').delete().eq('id', fromVendor.id)
    if (error) {
      alert(`데이터는 옮겨졌지만 ${fromVendor.name} 삭제 실패: ${error.message}\n수동으로 삭제하거나 다시 시도해주세요.`)
    } else {
      alert(`✅ '${fromVendor.name}' → '${toVendor.name}' 병합 완료`)
    }
    setMergingFrom(null)
    load()
  }

  const filtered = vendors.filter(v => !search || v.name.toLowerCase().includes(search.toLowerCase()))

  // 매출 합계
  const totalThisMonth = filtered.reduce((s, v) => s + (statsMap.get(v.id)?.thisMonthRevenue || 0), 0)
  const totalYtd = filtered.reduce((s, v) => s + (statsMap.get(v.id)?.ytdRevenue || 0), 0)

  function handleExport() {
    const data = rowsToSheet(filtered, [
      { key: 'name', label: '거래처명' },
      { key: 'business_number', label: '사업자번호' },
      { key: 'ceo_name', label: '대표자' },
      { key: 'phone', label: '전화' },
      { key: 'email', label: '이메일' },
      { key: 'address', label: '주소' },
      { key: 'bank_info', label: '계좌정보' },
      { key: 'size_system', label: '사이즈 체계', format: (v: string[]) => (v || []).join(', ') },
      { key: 'memo', label: '취급 상품', format: (_v, r) => parseItems(r.memo).join(', ') },
      { key: 'id', label: '이번 달 매출', format: (id: string) => statsMap.get(id)?.thisMonthRevenue || 0 },
      { key: 'id', label: '올해 누적', format: (id: string) => statsMap.get(id)?.ytdRevenue || 0 },
      { key: 'id', label: '등록 상품수', format: (id: string) => statsMap.get(id)?.productCount || 0 },
    ])
    exportSheet(data, '고객거래처', '고객거래처')
  }

  // 최고 매출 거래처 (이번 달)
  const topVendor = [...filtered].sort((a, b) => (statsMap.get(b.id)?.thisMonthRevenue || 0) - (statsMap.get(a.id)?.thisMonthRevenue || 0))[0]
  const topVendorAmount = topVendor ? (statsMap.get(topVendor.id)?.thisMonthRevenue || 0) : 0

  return (
    <div>
      {/* 그라데이션 헤더 — 이번 달 매출 강조 */}
      <div className="mb-5 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 px-4 sm:px-6 pt-5 pb-6 bg-gradient-to-br from-emerald-700 via-emerald-800 to-zinc-900 text-white rounded-b-3xl">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-emerald-200 mb-1">CUSTOMERS</p>
            <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight">고객 거래처</h1>
            <p className="text-[12px] text-emerald-100/80 mt-1">내가 상품을 납품하는 브랜드 · 거래처별 매출 상세 보기</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={handleExport} className="bg-white/10 hover:bg-white/20 text-white border-white/20">📥 엑셀</Button>
            <FlatImportButton entity="customers" onImported={load} />
            <Button onClick={() => { setEditing(null); setDrawerOpen(true) }} className="bg-white text-emerald-900 hover:bg-emerald-50">＋ 새 거래처</Button>
          </div>
        </div>
        {topVendor && topVendorAmount > 0 && (
          <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-[12px] text-emerald-50">
            👑 이번 달 최고 매출: <span className="font-bold">{topVendor.name}</span> · ₩{topVendorAmount.toLocaleString()}
          </div>
        )}
      </div>

      {/* 통계 카드 — 컬러 강조 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="총 거래처" value={`${filtered.length}개`} hint="고객 등록 수" onClick={() => setTab('all')} accent="zinc" />
        <StatCard label="이번 달 매출" value={`₩${totalThisMonth.toLocaleString()}`} hint="전체 거래처 합계" onClick={() => setTab('sales')} accent="green" />
        <StatCard label="올해 누적 매출" value={`₩${totalYtd.toLocaleString()}`} hint={`${new Date().getFullYear()}년`} onClick={() => setTab('sales')} accent="blue" />
        <StatCard label="평균 거래처당" value={filtered.length ? `₩${Math.round(totalYtd / filtered.length).toLocaleString()}` : '₩0'} hint="올해 기준" onClick={() => setTab('sales')} accent="violet" />
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        {/* 탭 */}
        <div className="px-4 pt-3 flex items-center justify-between gap-3 border-b border-zinc-100 flex-wrap">
          <div className="flex gap-1">
            <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>전체 정보</TabBtn>
            <TabBtn active={tab === 'contacts'} onClick={() => setTab('contacts')}>연락처만</TabBtn>
            <TabBtn active={tab === 'sales'} onClick={() => setTab('sales')}>매출 요약</TabBtn>
          </div>
          <div className="w-56 pb-3">
            <Input value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          vendors.length === 0 ? (
            <Empty icon="🏢" title="아직 등록된 고객 거래처가 없어요" action={<Button onClick={() => { setEditing(null); setDrawerOpen(true) }}>＋ 등록</Button>} />
          ) : <Empty icon="🔍" title="검색 결과가 없습니다" />
        ) : tab === 'all' ? (
          <AllTable vendors={filtered} statsMap={statsMap} onEdit={(v) => { setEditing(v); setDrawerOpen(true) }} onDelete={handleDelete} onShowSales={setSalesDrawerVendor} onMerge={setMergingFrom} />
        ) : tab === 'contacts' ? (
          <ContactsTable vendors={filtered} />
        ) : (
          <SalesTable vendors={filtered} statsMap={statsMap} onShowSales={setSalesDrawerVendor} />
        )}
      </div>

      <CustomerDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        editing={editing}
        onSaved={() => { setDrawerOpen(false); load() }}
      />

      <SalesDetailDrawer
        vendor={salesDrawerVendor}
        onClose={() => setSalesDrawerVendor(null)}
      />

      <MergeVendorModal
        from={mergingFrom}
        candidates={vendors.filter(v => v.id !== mergingFrom?.id)}
        onClose={() => setMergingFrom(null)}
        onConfirm={(to) => mergingFrom && mergeVendor(mergingFrom, to)}
      />
    </div>
  )
}

/* ─────────────────────────────────────────────
 * 거래처 병합 모달
 * 원본(from)의 데이터를 대상(to)으로 이동 후 원본 삭제
 * ───────────────────────────────────────────── */
function MergeVendorModal({ from, candidates, onClose, onConfirm }: {
  from: Vendor | null
  candidates: Vendor[]
  onClose: () => void
  onConfirm: (to: Vendor) => void
}) {
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string>('')
  useEffect(() => { setSelectedId(''); setSearch('') }, [from?.id])
  if (!from) return null

  const filtered = candidates.filter(v => !search || v.name.toLowerCase().includes(search.toLowerCase()))
  const target = candidates.find(v => v.id === selectedId)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-zinc-900/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-100">
          <h2 className="text-[16px] font-semibold text-zinc-900">🔗 거래처 병합</h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">중복 등록된 거래처를 하나로 합칩니다.</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-wider text-rose-700 font-semibold mb-1">이 거래처 (없어집니다)</p>
            <p className="text-[14px] font-bold text-zinc-900">{from.name}</p>
            {from.company_name && <p className="text-[11px] text-zinc-500 mt-0.5">{from.company_name}</p>}
          </div>

          <div className="text-center text-[18px] text-zinc-400">↓</div>

          <div>
            <Label>합칠 대상 거래처</Label>
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="이름으로 검색" />
            <div className="mt-2 border border-zinc-200 rounded-lg max-h-56 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-[12px] text-zinc-400 text-center py-6">검색 결과 없음</p>
              ) : filtered.map(v => (
                <button
                  key={v.id}
                  onClick={() => setSelectedId(v.id)}
                  className={`w-full text-left px-3 py-2 border-b border-zinc-100 last:border-b-0 transition-colors ${selectedId === v.id ? 'bg-emerald-50 border-emerald-200' : 'hover:bg-zinc-50'}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-medium text-zinc-900">{v.name}</p>
                      {v.company_name && <p className="text-[11px] text-zinc-500">{v.company_name}</p>}
                    </div>
                    {selectedId === v.id && <span className="text-emerald-600 text-[14px]">✓</span>}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {target && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">합쳐질 곳 (남아있을 거래처)</p>
              <p className="text-[14px] font-bold text-zinc-900">{target.name}</p>
              <p className="text-[11px] text-zinc-600 mt-2">
                '{from.name}'의 상품·입고·계산서·견적서·원가 모두 '{target.name}'로 이동된 뒤 '{from.name}' 거래처는 삭제됩니다.
              </p>
            </div>
          )}
        </div>
        <div className="px-5 py-3 border-t border-zinc-100 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button onClick={() => target && onConfirm(target)} disabled={!target}>합치기</Button>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, hint, onClick, accent }: { label: string; value: string; hint?: string; onClick?: () => void; accent?: 'zinc' | 'blue' | 'green' | 'amber' | 'violet' }) {
  const palettes = {
    zinc:   { bg: 'from-zinc-50 to-white border-zinc-200',           hover: 'hover:border-zinc-400 hover:from-zinc-100',           text: 'text-zinc-900' },
    blue:   { bg: 'from-blue-50 to-white border-blue-100',           hover: 'hover:border-blue-300 hover:from-blue-100',           text: 'text-blue-900' },
    green:  { bg: 'from-emerald-50 to-white border-emerald-100',     hover: 'hover:border-emerald-300 hover:from-emerald-100',     text: 'text-emerald-900' },
    amber:  { bg: 'from-amber-50 to-white border-amber-100',         hover: 'hover:border-amber-300 hover:from-amber-100',         text: 'text-amber-900' },
    violet: { bg: 'from-violet-50 to-white border-violet-100',       hover: 'hover:border-violet-300 hover:from-violet-100',       text: 'text-violet-900' },
  }
  const p = accent ? palettes[accent] : null
  const baseClass = p
    ? `bg-gradient-to-br ${p.bg} ${onClick ? `cursor-pointer transition-colors ${p.hover}` : ''}`
    : `bg-white border-zinc-200 ${onClick ? 'hover:border-zinc-400 hover:bg-zinc-50/50 cursor-pointer transition-colors' : ''}`
  const inner = (
    <div className={`border rounded-2xl p-4 text-left ${baseClass}`}>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className={`text-[20px] font-bold mt-1 tabular-nums ${p?.text || 'text-zinc-900'}`}>{value}</p>
      {hint && <p className="text-[11px] text-zinc-500 mt-1 flex items-center justify-between"><span>{hint}</span>{onClick && <span className="text-zinc-400">→</span>}</p>}
    </div>
  )
  return onClick ? <button onClick={onClick} className="block w-full">{inner}</button> : inner
}

function TabBtn({ children, active, onClick }: { children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-2.5 text-[13px] font-medium transition-colors ${
        active ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'
      }`}
    >
      {children}
      {active && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-zinc-900" />}
    </button>
  )
}

/* ───── 탭 1: 전체 정보 ───── */
function AllTable({ vendors, statsMap, onEdit, onDelete, onShowSales, onMerge }: {
  vendors: Vendor[]; statsMap: Map<string, VendorStats>; onEdit: (v: Vendor) => void; onDelete: (v: Vendor) => void; onShowSales: (v: Vendor) => void; onMerge: (v: Vendor) => void
}) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
          <th className="px-4 py-3">거래처명</th>
          <th className="px-4 py-3">사업자번호</th>
          <th className="px-4 py-3">대표자</th>
          <th className="px-4 py-3">연락처</th>
          <th className="px-4 py-3">사이즈 체계</th>
          <th className="px-4 py-3 text-right">이번 달 매출</th>
          <th className="px-4 py-3 text-right">관리</th>
        </tr>
      </thead>
      <tbody>
        {vendors.map(v => {
          const stats = statsMap.get(v.id)
          return (
            <tr key={v.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-900">
                <button onClick={() => onShowSales(v)} className="hover:underline">{v.name}</button>
                {v.company_name && <div className="text-[11px] text-zinc-500 font-normal mt-0.5">{v.company_name}</div>}
              </td>
              <td className="px-4 py-3 text-zinc-600">{v.business_number || '—'}</td>
              <td className="px-4 py-3 text-zinc-600">{v.ceo_name || '—'}</td>
              <td className="px-4 py-3 text-zinc-600">{v.phone || '—'}</td>
              <td className="px-4 py-3">
                {v.size_system && v.size_system.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {v.size_system.slice(0, 5).map((s, i) => (
                      <span key={i} className="inline-flex items-center justify-center min-w-[26px] px-1.5 py-0.5 bg-zinc-100 rounded text-[11px] font-medium text-zinc-700">{s}</span>
                    ))}
                    {v.size_system.length > 5 && <span className="text-[11px] text-zinc-500 self-center">+{v.size_system.length - 5}</span>}
                  </div>
                ) : <span className="text-amber-600 text-[12px]">⚠ 미설정</span>}
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">
                <button onClick={() => onShowSales(v)} className="hover:underline">₩{(stats?.thisMonthRevenue || 0).toLocaleString()}</button>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => onMerge(v)} title="다른 거래처와 합치기 — 중복 등록된 경우 사용" className="text-violet-600 hover:bg-violet-50 hover:text-violet-700">🔗 합치기</Button>
                <Button size="sm" variant="ghost" onClick={() => onEdit(v)}>수정</Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(v)} className="text-rose-600 hover:bg-rose-50 hover:text-rose-700">삭제</Button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function ContactsTable({ vendors }: { vendors: Vendor[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
          <th className="px-4 py-3">거래처명</th>
          <th className="px-4 py-3">대표자</th>
          <th className="px-4 py-3">전화</th>
          <th className="px-4 py-3">이메일</th>
          <th className="px-4 py-3">주소</th>
        </tr>
      </thead>
      <tbody>
        {vendors.map(v => (
          <tr key={v.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
            <td className="px-4 py-3 font-medium text-zinc-900">
              {v.name}
              {v.company_name && <div className="text-[11px] text-zinc-500 font-normal mt-0.5">{v.company_name}</div>}
            </td>
            <td className="px-4 py-3 text-zinc-700">{v.ceo_name || '—'}</td>
            <td className="px-4 py-3 text-zinc-700">{v.phone ? <a href={`tel:${v.phone}`} className="hover:underline">{v.phone}</a> : '—'}</td>
            <td className="px-4 py-3 text-zinc-700">{v.email ? <a href={`mailto:${v.email}`} className="hover:underline">{v.email}</a> : '—'}</td>
            <td className="px-4 py-3 text-zinc-600 text-[12px]">{v.address || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function SalesTable({ vendors, statsMap, onShowSales }: {
  vendors: Vendor[]; statsMap: Map<string, VendorStats>; onShowSales: (v: Vendor) => void
}) {
  const sorted = [...vendors].sort((a, b) => (statsMap.get(b.id)?.thisMonthRevenue || 0) - (statsMap.get(a.id)?.thisMonthRevenue || 0))
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
          <th className="px-4 py-3">거래처명</th>
          <th className="px-4 py-3 text-right">이번 달 매출</th>
          <th className="px-4 py-3 text-right">이번 달 건수</th>
          <th className="px-4 py-3 text-right">올해 누적</th>
          <th className="px-4 py-3 text-right">등록 상품</th>
          <th className="px-4 py-3 text-right">상세</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(v => {
          const stats = statsMap.get(v.id)
          return (
            <tr key={v.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-900">
                <button onClick={() => onShowSales(v)} className="hover:underline">{v.name}</button>
                {v.company_name && <div className="text-[11px] text-zinc-500 font-normal mt-0.5">{v.company_name}</div>}
              </td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums">₩{(stats?.thisMonthRevenue || 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{stats?.thisMonthCount || 0}건</td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-600">₩{(stats?.ytdRevenue || 0).toLocaleString()}</td>
              <td className="px-4 py-3 text-right tabular-nums text-zinc-600">{stats?.productCount || 0}개</td>
              <td className="px-4 py-3 text-right">
                <Button size="sm" variant="ghost" onClick={() => onShowSales(v)}>요약 보기</Button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SalesDetailDrawer({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [items, setItems] = useState<InvoiceItem[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!vendor) return
    setLoading(true)
    Promise.all([
      supabase.from('invoices').select('*').eq('vendor_id', vendor.id).order('issue_date', { ascending: false }),
      supabase.from('products').select('*').eq('vendor_id', vendor.id).order('name'),
    ]).then(async ([{ data: invs }, { data: prods }]) => {
      setInvoices(invs ?? [])
      setProducts(prods ?? [])
      if (invs && invs.length > 0) {
        const ids = invs.map(i => i.id)
        const { data: its } = await supabase.from('invoice_items').select('*').in('invoice_id', ids)
        setItems(its ?? [])
      } else setItems([])
      setLoading(false)
    })
  }, [vendor])

  if (!vendor) return null

  const today = new Date()
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`
  const thisYear = String(today.getFullYear())
  const thisMonthInvs = invoices.filter(i => i.issue_date?.startsWith(thisMonth))
  const ytdInvs = invoices.filter(i => i.issue_date?.startsWith(thisYear))
  const thisMonthRevenue = thisMonthInvs.reduce((s, i) => s + Number(i.total || 0), 0)
  const ytdRevenue = ytdInvs.reduce((s, i) => s + Number(i.total || 0), 0)

  const thisMonthIds = new Set(thisMonthInvs.map(i => i.id))
  const productAgg = new Map<string, { name: string; quantity: number; revenue: number }>()
  items.filter(it => thisMonthIds.has(it.invoice_id)).forEach(it => {
    const key = it.product_id || it.product_name || ''
    if (!productAgg.has(key)) productAgg.set(key, { name: it.product_name || '—', quantity: 0, revenue: 0 })
    const p = productAgg.get(key)!
    p.quantity += Number(it.quantity || 0)
    p.revenue += Number(it.amount || 0)
  })
  const productList = Array.from(productAgg.values()).sort((a, b) => b.revenue - a.revenue)

  const catalogItems = parseItems(vendor.memo)

  return (
    <Drawer open={!!vendor} onClose={onClose} title={`${vendor.name} · 매출 요약`} width="lg">
      {loading ? <p className="text-center text-zinc-400 py-12 text-[13px]">불러오는 중...</p> : (
        <>
          <div className="bg-zinc-50 rounded-xl p-4 mb-5 text-[12px] space-y-1">
            <div className="flex gap-3"><span className="text-zinc-500 w-20">사업자번호</span><span>{vendor.business_number || '—'}</span></div>
            <div className="flex gap-3"><span className="text-zinc-500 w-20">대표자</span><span>{vendor.ceo_name || '—'}</span></div>
            <div className="flex gap-3"><span className="text-zinc-500 w-20">전화</span><span>{vendor.phone || '—'}</span></div>
          </div>

          {catalogItems.length > 0 && (
            <div className="mb-5">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-[13px] font-semibold text-zinc-900">취급 상품 카탈로그</h3>
                <span className="text-[11px] text-zinc-500">{catalogItems.length}개 · 과거 납품 이력 기반</span>
              </div>
              <ul className="border border-zinc-200 rounded-xl overflow-hidden grid grid-cols-2 sm:grid-cols-3">
                {catalogItems.map((it, i) => (
                  <li key={i} className="px-3 py-2 text-[12px] text-zinc-700 border-b border-l border-zinc-100 -ml-px -mb-px bg-white hover:bg-zinc-50 flex items-center gap-2">
                    <span className="text-zinc-400 tabular-nums text-[10px]">{String(i + 1).padStart(2, '0')}</span>
                    <span className="truncate">{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">이번 달 매출</p>
              <p className="text-[22px] font-bold text-zinc-900 mt-1 tabular-nums">₩{thisMonthRevenue.toLocaleString()}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{thisMonthInvs.length}건</p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">올해 누적</p>
              <p className="text-[22px] font-bold text-zinc-900 mt-1 tabular-nums">₩{ytdRevenue.toLocaleString()}</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">{ytdInvs.length}건</p>
            </div>
          </div>
          {productList.length > 0 && (
            <div className="mb-5">
              <h3 className="text-[13px] font-semibold text-zinc-900 mb-2">이번 달 상품별 납품</h3>
              <div className="border border-zinc-200 rounded-xl overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-zinc-50"><tr><th className="px-3 py-2 text-left">상품</th><th className="px-3 py-2 text-right">수량</th><th className="px-3 py-2 text-right">매출</th></tr></thead>
                  <tbody>
                    {productList.map((p, i) => (
                      <tr key={i} className="border-t border-zinc-100">
                        <td className="px-3 py-2">{p.name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.quantity.toLocaleString()}장</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">₩{p.revenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <div>
            <h3 className="text-[13px] font-semibold text-zinc-900 mb-2">최근 계산서 ({invoices.length})</h3>
            {invoices.length === 0 ? <p className="text-[12px] text-zinc-400 text-center py-4">없음</p> : (
              <div className="border border-zinc-200 rounded-xl overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-zinc-50"><tr><th className="px-3 py-2 text-left">발행일</th><th className="px-3 py-2 text-right">금액</th></tr></thead>
                  <tbody>
                    {invoices.slice(0, 10).map(i => (
                      <tr key={i.id} className="border-t border-zinc-100">
                        <td className="px-3 py-2 tabular-nums">{i.issue_date}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">₩{Number(i.total).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <p className="text-[10px] text-zinc-400 mt-3">상품 {products.length}개 등록됨</p>
        </>
      )}
    </Drawer>
  )
}

function CustomerDrawer({ open, onClose, editing, onSaved }: {
  open: boolean; onClose: () => void; editing: Vendor | null; onSaved: () => void
}) {
  const [form, setForm] = useState<Partial<Vendor>>({})
  const [sizes, setSizes] = useState<string[]>([])
  const [items, setItems] = useState<string[]>([])
  const [itemInput, setItemInput] = useState('')
  const [memoBody, setMemoBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (editing) {
      setForm(editing)
      setSizes(editing.size_system || [])
      setItems(parseItems(editing.memo))
      const body = (editing.memo || '')
        .replace(/\s*\|\s*품목\s*:[^\n]*/g, '')
        .replace(/품목\s*:[^\n]*/g, '')
        .trim()
      setMemoBody(body)
    } else {
      setForm({}); setSizes([]); setItems([]); setMemoBody('')
    }
    setItemInput(''); setError(null); setDirty(false)
  }, [editing, open])

  function update<K extends keyof Vendor>(k: K, v: Vendor[K]) {
    setForm(prev => ({ ...prev, [k]: v })); setDirty(true)
  }
  function changeSizes(s: string[]) { setSizes(s); setDirty(true) }
  function addItem() {
    const v = itemInput.trim()
    if (!v) return
    if (items.includes(v)) { setItemInput(''); return }
    setItems([...items, v]); setItemInput(''); setDirty(true)
  }
  function removeItem(idx: number) {
    setItems(items.filter((_, i) => i !== idx)); setDirty(true)
  }

  async function handleSave() {
    if (!form.name?.trim()) return setError('거래처명은 필수입니다.')
    setSaving(true); setError(null)
    const finalMemo = setItemsInMemo(memoBody, items)
    const payload = {
      name: form.name.trim(),
      vendor_type: 'customer' as const,
      business_number: form.business_number?.trim() || null,
      ceo_name: form.ceo_name?.trim() || null,
      address: form.address?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      bank_info: form.bank_info?.trim() || null,
      company_name: form.company_name?.trim() || null,
      memo: finalMemo || null,
      size_system: sizes,
    }
    const result = editing
      ? await supabase.from('vendors').update(payload).eq('id', editing.id)
      : await supabase.from('vendors').insert(payload)
    setSaving(false)
    if (result.error) return setError(result.error.message)
    setDirty(false); onSaved()
  }

  function handleClose() {
    if (dirty && !confirm('저장하지 않은 변경 사항이 있어요. 정말 닫을까요?')) return
    onClose()
  }

  return (
    <Drawer open={open} onClose={handleClose} title={editing ? '고객 거래처 수정' : '새 고객 거래처 등록'} width="lg"
      footer={<>
        {dirty && <span className="text-[11px] text-amber-600 mr-auto">● 변경 사항 있음</span>}
        {!dirty && editing && <span className="text-[11px] text-emerald-600 mr-auto">✓ 저장됨</span>}
        <Button variant="secondary" onClick={handleClose}>취소</Button>
        <Button onClick={handleSave} disabled={saving || !dirty}>{saving ? '저장 중...' : '저장'}</Button>
      </>}
    >
      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">{error}</div>}
      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3">
          <div><Label required>브랜드명</Label><Input value={form.name || ''} onChange={e => update('name', e.target.value)} /></div>
          <div>
            <Label>회사명 <span className="text-zinc-400 font-normal">(세금계산서용)</span></Label>
            <Input value={form.company_name || ''} onChange={e => update('company_name', e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>사업자번호</Label><Input value={form.business_number || ''} onChange={e => update('business_number', e.target.value)} /></div>
          <div><Label>대표자</Label><Input value={form.ceo_name || ''} onChange={e => update('ceo_name', e.target.value)} /></div>
        </div>
        <div><Label>주소</Label><Input value={form.address || ''} onChange={e => update('address', e.target.value)} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>전화번호</Label><Input value={form.phone || ''} onChange={e => update('phone', e.target.value)} /></div>
          <div><Label>이메일</Label><Input value={form.email || ''} onChange={e => update('email', e.target.value)} /></div>
        </div>
        <div><Label>계좌정보</Label><Input value={form.bank_info || ''} onChange={e => update('bank_info', e.target.value)} /></div>
        <div className="pt-2 border-t border-zinc-100">
          <Label>사이즈 체계</Label>
          <p className="text-[11px] text-zinc-500 mb-2.5">이 거래처가 사용하는 사이즈를 선택해주세요.</p>
          <SizePicker value={sizes} onChange={changeSizes} />
        </div>
        <div className="pt-2 border-t border-zinc-100">
          <Label>취급 상품 <span className="text-zinc-400 font-normal">({items.length}개)</span></Label>
          <p className="text-[11px] text-zinc-500 mb-2">이 거래처에 납품하는 상품/스타일을 가등록 해두면 견적·계산서에서 빠르게 선택할 수 있어요.</p>
          <div className="flex gap-2 mb-2">
            <Input
              value={itemInput}
              onChange={e => setItemInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addItem() } }}
            />
            <Button type="button" variant="secondary" onClick={addItem}>추가</Button>
          </div>
          {items.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-50 rounded-lg border border-zinc-200">
              {items.map((it, i) => (
                <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-white border border-zinc-300 text-[12px]">
                  {it}
                  <button type="button" onClick={() => removeItem(i)} className="text-zinc-400 hover:text-rose-500 ml-0.5">×</button>
                </span>
              ))}
            </div>
          )}
        </div>
        <div><Label>메모</Label><Textarea rows={3} value={memoBody} onChange={e => { setMemoBody(e.target.value); setDirty(true) }} /></div>
      </div>
    </Drawer>
  )
}
