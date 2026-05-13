import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor, CostItem } from '@/lib/types'
import { Button, Input, Textarea, Label, PageHeader, Drawer, Empty, Badge } from '@/components/ui'
import { exportSheet, rowsToSheet } from '@/lib/exportXlsx'
import FlatImportButton from '@/components/FlatImportButton'

/* ───── 공급처 (원단·부자재·공임을 사오는 곳) ───── */
const CATEGORY_OPTIONS = [
  { value: 'fabric',     label: '원단',       color: 'blue' as const },
  { value: 'rib',        label: '립',         color: 'amber' as const },
  { value: 'print',      label: '나염/프린트', color: 'violet' as const },
  { value: 'embroidery', label: '자수',       color: 'rose' as const },
  { value: 'accessory',  label: '부자재',     color: 'amber' as const },
  { value: 'washing',    label: '워싱',       color: 'blue' as const },
  { value: 'label',      label: '라벨',       color: 'zinc' as const },
  { value: 'labor',      label: '공임',       color: 'green' as const },
  { value: 'package',    label: '포장',       color: 'rose' as const },
  { value: 'etc',        label: '기타',       color: 'zinc' as const },
]

function getCategory(memo: string | null) {
  if (!memo) return null
  const tag = memo.match(/^\[([^\]]+)\]/)?.[1]
  return CATEGORY_OPTIONS.find(c => c.label === tag) || null
}
function setCategoryTag(memo: string | null, label: string | null) {
  const cleaned = (memo || '').replace(/^\[[^\]]+\]\s*/, '')
  return label ? `[${label}] ${cleaned}`.trim() : cleaned
}

/* 메모에서 "품목: A, B, C" 파싱 */
function parseItems(memo: string | null): string[] {
  if (!memo) return []
  const m = memo.match(/품목\s*:\s*(.+?)(?=$|\n)/)
  if (!m) return []
  return m[1].split(',').map(s => s.trim()).filter(Boolean)
}
/* 메모에 품목 리스트 다시 쓰기 (기존 품목 줄 교체) */
function setItemsInMemo(memo: string, items: string[]): string {
  // 카테고리 태그는 따로 관리되므로 여기는 본문만 다룸
  // "품목: ..." 줄을 제거 후, items 가 있으면 끝에 새로 붙임
  let body = memo.replace(/\s*\|\s*품목\s*:[^\n]*/g, '').replace(/품목\s*:[^\n]*/g, '').trim()
  if (items.length === 0) return body
  return body ? `${body} | 품목: ${items.join(', ')}` : `품목: ${items.join(', ')}`
}

type Tab = 'all' | 'contacts' | 'materials' | 'catalog'

interface SupplierStats {
  materialCount: number
  productCount: number
}

export default function Suppliers() {
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [statsMap, setStatsMap] = useState<Map<string, SupplierStats>>(new Map())
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<Vendor | null>(null)
  const [materialDrawer, setMaterialDrawer] = useState<Vendor | null>(null)
  const [mergingFrom, setMergingFrom] = useState<Vendor | null>(null)

  async function load() {
    setLoading(true)
    const [{ data: vData }, { data: cData }] = await Promise.all([
      supabase.from('vendors').select('*').eq('vendor_type', 'supplier').order('name'),
      supabase.from('cost_items').select('supplier_id, product_id'),
    ])
    setVendors(vData ?? [])

    const map = new Map<string, SupplierStats & { productSet: Set<string> }>()
    ;(vData ?? []).forEach(v => map.set(v.id, { materialCount: 0, productCount: 0, productSet: new Set() }))
    ;(cData ?? []).forEach((c: any) => {
      if (!c.supplier_id) return
      const s = map.get(c.supplier_id)
      if (!s) return
      s.materialCount += 1
      if (c.product_id) s.productSet.add(c.product_id)
    })
    const cleanMap = new Map<string, SupplierStats>()
    map.forEach((v, k) => cleanMap.set(k, { materialCount: v.materialCount, productCount: v.productSet.size }))
    setStatsMap(cleanMap)
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(v: Vendor) {
    if (!confirm(`'${v.name}' 공급처를 삭제할까요?`)) return
    const { error } = await supabase.from('vendors').delete().eq('id', v.id)
    if (error) return alert('삭제 실패: ' + error.message)
    load()
  }

  /** 공급처 병합 — fromVendor의 모든 참조를 toVendor로 옮기고 fromVendor 삭제 */
  async function mergeVendor(fromVendor: Vendor, toVendor: Vendor) {
    if (fromVendor.id === toVendor.id) return alert('같은 공급처입니다.')
    if (!confirm(
`'${fromVendor.name}'의 모든 데이터를 '${toVendor.name}'로 합칠까요?

- ${fromVendor.name}에 딸린 원가 재료·공급처 계산서 모두 ${toVendor.name}로 옮겨집니다.
- 옮긴 뒤 '${fromVendor.name}' 공급처는 삭제됩니다.
- 되돌릴 수 없어요.`
    )) return

    const updates = [
      supabase.from('cost_items').update({ supplier_id: toVendor.id }).eq('supplier_id', fromVendor.id),
      supabase.from('supplier_invoices').update({ supplier_id: toVendor.id }).eq('supplier_id', fromVendor.id),
    ]
    const results = await Promise.all(updates)
    const failed = results.filter(r => r.error)
    if (failed.length > 0) {
      alert('일부 업데이트 실패: ' + failed.map(f => f.error?.message).join(', '))
      return
    }

    const { error } = await supabase.from('vendors').delete().eq('id', fromVendor.id)
    if (error) {
      alert(`데이터는 옮겨졌지만 ${fromVendor.name} 삭제 실패: ${error.message}`)
    } else {
      alert(`✅ '${fromVendor.name}' → '${toVendor.name}' 병합 완료`)
    }
    setMergingFrom(null)
    load()
  }

  const filtered = vendors.filter(v => !search || v.name.toLowerCase().includes(search.toLowerCase()))

  // 카테고리별 통계
  const byCategory = new Map<string, number>()
  filtered.forEach(v => {
    const cat = getCategory(v.memo)
    const key = cat?.label || '기타'
    byCategory.set(key, (byCategory.get(key) || 0) + 1)
  })

  function handleExport() {
    const data = rowsToSheet(filtered, [
      { key: 'name', label: '공급처명' },
      { key: 'memo', label: '분류', format: (v: string) => getCategory(v)?.label || '' },
      { key: 'business_number', label: '사업자번호' },
      { key: 'ceo_name', label: '대표자' },
      { key: 'phone', label: '전화' },
      { key: 'email', label: '이메일' },
      { key: 'address', label: '주소' },
      { key: 'bank_info', label: '계좌정보' },
      { key: 'memo', label: '취급 품목', format: (v: string) => parseItems(v).join(', ') },
      { key: 'id', label: '원가계산서 사용수', format: (id: string) => statsMap.get(id)?.materialCount || 0 },
      { key: 'id', label: '사용 상품수', format: (id: string) => statsMap.get(id)?.productCount || 0 },
    ])
    exportSheet(data, '공급처', '공급처')
  }

  return (
    <div>
      {/* 그라데이션 헤더 — 공급처는 보라색 톤 */}
      <div className="mb-5 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 px-4 sm:px-6 pt-5 pb-6 bg-gradient-to-br from-violet-700 via-violet-800 to-zinc-900 text-white rounded-b-3xl">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-violet-200 mb-1">SUPPLIERS</p>
            <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight">공급처 관리</h1>
            <p className="text-[12px] text-violet-100/80 mt-1">원단·부자재·공임·포장 등을 사오는 거래처 · 클릭하면 취급 재료 보기</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="secondary" onClick={handleExport} className="bg-white/10 hover:bg-white/20 text-white border-white/20">📥 엑셀</Button>
            <FlatImportButton entity="suppliers" onImported={load} />
            <Button onClick={() => { setEditing(null); setDrawerOpen(true) }} className="bg-white text-violet-900 hover:bg-violet-50">＋ 새 공급처</Button>
          </div>
        </div>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10 text-[12px] text-violet-50">
          🏭 총 <span className="font-bold">{filtered.length}곳</span>의 공급처
        </div>
      </div>

      {/* 통계 카드 — 컬러 강조 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatCard label="총 공급처" value={`${filtered.length}개`} hint="등록된 공급처" onClick={() => setTab('all')} accent="zinc" />
        <StatCard label="원단·립" value={`${(byCategory.get('원단') || 0) + (byCategory.get('립') || 0)}곳`} hint="원단/립 분류" onClick={() => setTab('materials')} accent="blue" />
        <StatCard label="가공" value={`${(byCategory.get('나염/프린트') || 0) + (byCategory.get('자수') || 0) + (byCategory.get('워싱') || 0)}곳`} hint="나염·자수·워싱" onClick={() => setTab('materials')} accent="violet" />
        <StatCard label="공임·기타" value={`${(byCategory.get('공임') || 0) + (byCategory.get('포장') || 0) + (byCategory.get('라벨') || 0) + (byCategory.get('부자재') || 0)}곳`} hint="공임·포장·라벨·부자재" onClick={() => setTab('materials')} accent="amber" />
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        {/* 탭 */}
        <div className="px-4 pt-3 flex items-center justify-between gap-3 border-b border-zinc-100 flex-wrap">
          <div className="flex gap-1">
            <TabBtn active={tab === 'all'} onClick={() => setTab('all')}>전체 정보</TabBtn>
            <TabBtn active={tab === 'contacts'} onClick={() => setTab('contacts')}>연락처만</TabBtn>
            <TabBtn active={tab === 'materials'} onClick={() => setTab('materials')}>취급 재료</TabBtn>
            <TabBtn active={tab === 'catalog'} onClick={() => setTab('catalog')}>품목 카탈로그</TabBtn>
          </div>
          <div className="w-56 pb-3">
            <Input value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          vendors.length === 0 ? (
            <Empty icon="🏭" title="등록된 공급처가 없어요" action={<Button onClick={() => { setEditing(null); setDrawerOpen(true) }}>＋ 등록</Button>} />
          ) : <Empty icon="🔍" title="검색 결과가 없습니다" />
        ) : tab === 'all' ? (
          <AllTable vendors={filtered} statsMap={statsMap} onEdit={(v) => { setEditing(v); setDrawerOpen(true) }} onDelete={handleDelete} onShowMaterials={setMaterialDrawer} onMerge={setMergingFrom} />
        ) : tab === 'contacts' ? (
          <ContactsTable vendors={filtered} />
        ) : tab === 'materials' ? (
          <MaterialsTable vendors={filtered} statsMap={statsMap} onShowMaterials={setMaterialDrawer} />
        ) : (
          <CatalogView vendors={filtered} onShowMaterials={setMaterialDrawer} />
        )}
      </div>

      <SupplierDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        editing={editing}
        onSaved={() => { setDrawerOpen(false); load() }}
      />

      <MaterialDetailDrawer
        vendor={materialDrawer}
        onClose={() => setMaterialDrawer(null)}
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
 * 공급처 병합 모달 — 원본의 데이터를 대상으로 이동 후 원본 삭제
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
          <h2 className="text-[16px] font-semibold text-zinc-900">🔗 공급처 병합</h2>
          <p className="text-[12px] text-zinc-500 mt-0.5">중복 등록된 공급처를 하나로 합칩니다.</p>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="bg-rose-50 border border-rose-200 rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-wider text-rose-700 font-semibold mb-1">이 공급처 (없어집니다)</p>
            <p className="text-[14px] font-bold text-zinc-900">{from.name}</p>
            {from.company_name && <p className="text-[11px] text-zinc-500 mt-0.5">{from.company_name}</p>}
          </div>

          <div className="text-center text-[18px] text-zinc-400">↓</div>

          <div>
            <Label>합칠 대상 공급처</Label>
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
              <p className="text-[10px] uppercase tracking-wider text-emerald-700 font-semibold mb-1">합쳐질 곳 (남아있을 공급처)</p>
              <p className="text-[14px] font-bold text-zinc-900">{target.name}</p>
              <p className="text-[11px] text-zinc-600 mt-2">
                '{from.name}'에 딸린 원가 재료·공급처 계산서가 '{target.name}'로 이동된 뒤 '{from.name}' 공급처는 삭제됩니다.
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
function AllTable({ vendors, statsMap, onEdit, onDelete, onShowMaterials, onMerge }: {
  vendors: Vendor[]; statsMap: Map<string, SupplierStats>; onEdit: (v: Vendor) => void; onDelete: (v: Vendor) => void; onShowMaterials: (v: Vendor) => void; onMerge: (v: Vendor) => void
}) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
          <th className="px-4 py-3">공급처명</th>
          <th className="px-4 py-3">분류</th>
          <th className="px-4 py-3">사업자번호</th>
          <th className="px-4 py-3">대표자</th>
          <th className="px-4 py-3">연락처</th>
          <th className="px-4 py-3 text-right">취급 재료</th>
          <th className="px-4 py-3 text-right">관리</th>
        </tr>
      </thead>
      <tbody>
        {vendors.map(v => {
          const cat = getCategory(v.memo)
          const stats = statsMap.get(v.id)
          return (
            <tr key={v.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-900">
                <button onClick={() => onShowMaterials(v)} className="hover:underline">{v.name}</button>
              </td>
              <td className="px-4 py-3">{cat ? <Badge color={cat.color}>{cat.label}</Badge> : <span className="text-zinc-400">—</span>}</td>
              <td className="px-4 py-3 text-zinc-600">{v.business_number || '—'}</td>
              <td className="px-4 py-3 text-zinc-600">{v.ceo_name || '—'}</td>
              <td className="px-4 py-3 text-zinc-600">{v.phone || '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">
                <button onClick={() => onShowMaterials(v)} className="hover:underline">{stats?.materialCount || 0}건</button>
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <Button size="sm" variant="ghost" onClick={() => onMerge(v)} title="다른 공급처와 합치기" className="text-violet-600 hover:bg-violet-50 hover:text-violet-700">🔗 합치기</Button>
                <Button size="sm" variant="ghost" onClick={() => onEdit(v)}>수정</Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(v)} className="text-rose-600 hover:bg-rose-50">삭제</Button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ───── 탭 2: 연락처만 ───── */
function ContactsTable({ vendors }: { vendors: Vendor[] }) {
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
          <th className="px-4 py-3">공급처명</th>
          <th className="px-4 py-3">분류</th>
          <th className="px-4 py-3">대표자</th>
          <th className="px-4 py-3">전화</th>
          <th className="px-4 py-3">이메일</th>
          <th className="px-4 py-3">주소</th>
        </tr>
      </thead>
      <tbody>
        {vendors.map(v => {
          const cat = getCategory(v.memo)
          return (
            <tr key={v.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-900">{v.name}</td>
              <td className="px-4 py-3">{cat ? <Badge color={cat.color}>{cat.label}</Badge> : '—'}</td>
              <td className="px-4 py-3 text-zinc-700">{v.ceo_name || '—'}</td>
              <td className="px-4 py-3 text-zinc-700">
                {v.phone ? <a href={`tel:${v.phone}`} className="hover:underline">{v.phone}</a> : '—'}
              </td>
              <td className="px-4 py-3 text-zinc-700">
                {v.email ? <a href={`mailto:${v.email}`} className="hover:underline">{v.email}</a> : '—'}
              </td>
              <td className="px-4 py-3 text-zinc-600 text-[12px]">{v.address || '—'}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ───── 탭 3: 취급 재료 ───── */
function MaterialsTable({ vendors, statsMap, onShowMaterials }: {
  vendors: Vendor[]; statsMap: Map<string, SupplierStats>; onShowMaterials: (v: Vendor) => void
}) {
  const sorted = [...vendors].sort((a, b) =>
    (statsMap.get(b.id)?.materialCount || 0) - (statsMap.get(a.id)?.materialCount || 0)
  )
  return (
    <table className="w-full text-[13px]">
      <thead>
        <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
          <th className="px-4 py-3">공급처명</th>
          <th className="px-4 py-3">분류</th>
          <th className="px-4 py-3 text-right">취급 재료</th>
          <th className="px-4 py-3 text-right">사용 상품</th>
          <th className="px-4 py-3 text-right">상세</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map(v => {
          const cat = getCategory(v.memo)
          const stats = statsMap.get(v.id)
          return (
            <tr key={v.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
              <td className="px-4 py-3 font-medium text-zinc-900">
                <button onClick={() => onShowMaterials(v)} className="hover:underline">{v.name}</button>
              </td>
              <td className="px-4 py-3">{cat ? <Badge color={cat.color}>{cat.label}</Badge> : '—'}</td>
              <td className="px-4 py-3 text-right tabular-nums">{stats?.materialCount || 0}건</td>
              <td className="px-4 py-3 text-right tabular-nums">{stats?.productCount || 0}개 상품</td>
              <td className="px-4 py-3 text-right">
                <Button size="sm" variant="ghost" onClick={() => onShowMaterials(v)}>요약 보기</Button>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/* ───── 탭 4: 품목 카탈로그 (공급처별 취급 품목 카드) ───── */
function CatalogView({ vendors, onShowMaterials }: {
  vendors: Vendor[]
  onShowMaterials: (v: Vendor) => void
}) {
  const [catFilter, setCatFilter] = useState<string>('원단')
  const [itemSearch, setItemSearch] = useState('')

  // 카테고리별 카운트
  const catCounts = new Map<string, number>()
  vendors.forEach(v => {
    const cat = getCategory(v.memo)?.label || '기타'
    catCounts.set(cat, (catCounts.get(cat) || 0) + 1)
  })
  const availableCats = CATEGORY_OPTIONS.filter(c => catCounts.has(c.label))

  // 필터 적용
  const filtered = vendors
    .filter(v => {
      const cat = getCategory(v.memo)?.label
      if (catFilter !== '전체' && cat !== catFilter) return false
      if (itemSearch.trim()) {
        const items = parseItems(v.memo)
        const search = itemSearch.trim().toLowerCase()
        return items.some(it => it.toLowerCase().includes(search)) || v.name.toLowerCase().includes(search)
      }
      return true
    })
    .map(v => ({ vendor: v, items: parseItems(v.memo) }))
    .filter(x => x.items.length > 0)  // 품목 없는 곳은 숨김 (검색하면 헷갈리니까)
    .sort((a, b) => b.items.length - a.items.length)

  // 검색어 하이라이트 도우미
  const highlight = itemSearch.trim().toLowerCase()

  return (
    <div className="p-4">
      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setCatFilter('전체')}
            className={`px-3 py-1.5 rounded-md text-[12px] font-medium border ${
              catFilter === '전체' ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200'
            }`}
          >
            전체 ({vendors.filter(v => parseItems(v.memo).length > 0).length})
          </button>
          {availableCats.map(c => (
            <button
              key={c.label}
              onClick={() => setCatFilter(c.label)}
              className={`px-3 py-1.5 rounded-md text-[12px] font-medium border ${
                catFilter === c.label ? 'bg-zinc-900 text-white border-zinc-900' : 'bg-white text-zinc-700 border-zinc-200'
              }`}
            >
              {c.label} ({catCounts.get(c.label) || 0})
            </button>
          ))}
        </div>
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder=""
            value={itemSearch}
            onChange={e => setItemSearch(e.target.value)}
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <Empty icon="🔍" title={itemSearch ? '검색 결과가 없어요' : '품목이 등록된 공급처가 없어요'} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {filtered.map(({ vendor, items }) => {
            const cat = getCategory(vendor.memo)
            const matchingItems = highlight
              ? items.filter(it => it.toLowerCase().includes(highlight))
              : items
            return (
              <div key={vendor.id} className="bg-white border border-zinc-200 rounded-2xl overflow-hidden hover:border-zinc-300 transition-colors">
                <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
                  <button onClick={() => onShowMaterials(vendor)} className="text-left flex-1 hover:underline">
                    <div className="font-semibold text-[14px] text-zinc-900">{vendor.name}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {cat && <Badge color={cat.color}>{cat.label}</Badge>}
                      <span className="text-[11px] text-zinc-500">{items.length}개 품목</span>
                      {vendor.phone && (
                        <a href={`tel:${vendor.phone}`} className="text-[11px] text-blue-600 hover:underline ml-1">{vendor.phone}</a>
                      )}
                    </div>
                  </button>
                </div>
                <div className="p-3">
                  <ul className="flex flex-wrap gap-1.5">
                    {items.map((it, i) => {
                      const isMatch = highlight && it.toLowerCase().includes(highlight)
                      return (
                        <li
                          key={i}
                          className={`inline-flex items-center px-2.5 py-1 rounded-md text-[12px] border ${
                            isMatch
                              ? 'bg-amber-50 border-amber-300 text-amber-900 font-semibold'
                              : 'bg-zinc-50 border-zinc-200 text-zinc-700'
                          }`}
                        >
                          {it}
                        </li>
                      )
                    })}
                  </ul>
                  {highlight && matchingItems.length > 0 && (
                    <p className="text-[11px] text-amber-700 mt-2">
                      📌 '{itemSearch}' 일치 {matchingItems.length}개
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ───── 취급 재료 상세 드로어 ───── */
function MaterialDetailDrawer({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!vendor) return
    setLoading(true)
    supabase
      .from('cost_items')
      .select('*, product:products(name, code)')
      .eq('supplier_id', vendor.id)
      .then(({ data }) => {
        const items = (data ?? []).map((c: any) => ({
          ...c,
          product_name: c.product?.code ? `${c.product.code} · ${c.product.name}` : (c.product?.name || '—'),
        }))
        setItems(items)
        setLoading(false)
      })
  }, [vendor])

  if (!vendor) return null

  const cat = getCategory(vendor.memo)
  const totalSubtotal = items.reduce((s, i) => s + Number(i.subtotal || 0), 0)
  const uniqueProducts = new Set(items.map(i => i.product_id).filter(Boolean)).size
  const catalogItems = parseItems(vendor.memo)

  return (
    <Drawer open={!!vendor} onClose={onClose} title={`${vendor.name} · 취급 재료`} width="lg">
      {loading ? (
        <p className="text-center text-zinc-400 py-12 text-[13px]">불러오는 중...</p>
      ) : (
        <>
          <div className="bg-zinc-50 rounded-xl p-4 mb-5 text-[12px] space-y-1">
            {cat && <div className="mb-2"><Badge color={cat.color}>{cat.label}</Badge></div>}
            <div className="flex gap-3"><span className="text-zinc-500 w-20">사업자번호</span><span>{vendor.business_number || '—'}</span></div>
            <div className="flex gap-3"><span className="text-zinc-500 w-20">대표자</span><span>{vendor.ceo_name || '—'}</span></div>
            <div className="flex gap-3"><span className="text-zinc-500 w-20">전화</span><span>{vendor.phone || '—'}</span></div>
            <div className="flex gap-3"><span className="text-zinc-500 w-20">주소</span><span>{vendor.address || '—'}</span></div>
          </div>

          {catalogItems.length > 0 && (
            <div className="mb-5">
              <div className="flex items-baseline justify-between mb-2">
                <h3 className="text-[13px] font-semibold text-zinc-900">취급 품목 카탈로그</h3>
                <span className="text-[11px] text-zinc-500">{catalogItems.length}개 · 과거 사용 이력 기반</span>
              </div>
              <ul className="border border-zinc-200 rounded-xl overflow-hidden grid grid-cols-2 sm:grid-cols-3 divide-zinc-100">
                {catalogItems.map((it, i) => (
                  <li key={i} className="px-3 py-2 text-[12px] text-zinc-700 border-b border-l border-zinc-100 -ml-px -mb-px bg-white hover:bg-zinc-50 flex items-center gap-2">
                    <span className="text-zinc-400 tabular-nums text-[10px]">{String(i + 1).padStart(2, '0')}</span>
                    <span className="truncate">{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">취급 재료</p>
              <p className="text-[22px] font-bold text-zinc-900 mt-1 tabular-nums">{items.length}건</p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">사용 상품</p>
              <p className="text-[22px] font-bold text-zinc-900 mt-1 tabular-nums">{uniqueProducts}개</p>
            </div>
            <div className="bg-white border border-zinc-200 rounded-2xl p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">합계</p>
              <p className="text-[20px] font-bold text-zinc-900 mt-1 tabular-nums">₩{Math.round(totalSubtotal).toLocaleString()}</p>
            </div>
          </div>

          <div>
            <h3 className="text-[13px] font-semibold text-zinc-900 mb-2">상품별 사용 내역</h3>
            {items.length === 0 ? (
              <div className="border border-dashed border-zinc-200 rounded-xl p-6 text-center text-[12px] text-zinc-400">
                원가계산서에서 이 공급처가 사용되지 않았어요
              </div>
            ) : (
              <div className="border border-zinc-200 rounded-xl overflow-hidden">
                <table className="w-full text-[12px]">
                  <thead className="bg-zinc-50">
                    <tr>
                      <th className="px-3 py-2 text-left">상품</th>
                      <th className="px-3 py-2 text-left">재료</th>
                      <th className="px-3 py-2 text-right">단가</th>
                      <th className="px-3 py-2 text-right">요척</th>
                      <th className="px-3 py-2 text-right">소계</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(it => (
                      <tr key={it.id} className="border-t border-zinc-100">
                        <td className="px-3 py-2 text-zinc-700 text-[11px]">{it.product_name}</td>
                        <td className="px-3 py-2">{it.item_name}</td>
                        <td className="px-3 py-2 text-right tabular-nums">₩{Number(it.unit_price).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(it.yards).toFixed(3)}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums">₩{Math.round(Number(it.subtotal || 0)).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </Drawer>
  )
}

function SupplierDrawer({ open, onClose, editing, onSaved }: {
  open: boolean; onClose: () => void; editing: Vendor | null; onSaved: () => void
}) {
  const [form, setForm] = useState<Partial<Vendor>>({})
  const [category, setCategory] = useState<string | null>(null)
  const [memo, setMemo] = useState('')
  const [items, setItems] = useState<string[]>([])
  const [itemInput, setItemInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (editing) {
      setForm(editing)
      const cat = getCategory(editing.memo)
      setCategory(cat?.label || null)
      setItems(parseItems(editing.memo))
      // 품목 부분을 제외한 메모 본문만 추출
      const bodyOnly = (editing.memo || '')
        .replace(/^\[[^\]]+\]\s*/, '')
        .replace(/\s*\|\s*품목\s*:[^\n]*/g, '')
        .replace(/품목\s*:[^\n]*/g, '')
        .trim()
      setMemo(bodyOnly)
    } else { setForm({}); setCategory(null); setMemo(''); setItems([]) }
    setItemInput(''); setError(null); setDirty(false)
  }, [editing, open])

  function update<K extends keyof Vendor>(k: K, v: Vendor[K]) { setForm(prev => ({ ...prev, [k]: v })); setDirty(true) }

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
    if (!form.name?.trim()) return setError('공급처명은 필수입니다.')
    setSaving(true); setError(null)
    const memoWithItems = setItemsInMemo(memo, items)
    const payload = {
      name: form.name.trim(),
      vendor_type: 'supplier' as const,
      business_number: form.business_number?.trim() || null,
      ceo_name: form.ceo_name?.trim() || null,
      address: form.address?.trim() || null,
      phone: form.phone?.trim() || null,
      email: form.email?.trim() || null,
      bank_info: form.bank_info?.trim() || null,
      memo: setCategoryTag(memoWithItems, category) || null,
      size_system: [],
    }
    const result = editing
      ? await supabase.from('vendors').update(payload).eq('id', editing.id)
      : await supabase.from('vendors').insert(payload)
    setSaving(false)
    if (result.error) return setError(result.error.message)
    setDirty(false); onSaved()
  }

  return (
    <Drawer open={open} onClose={onClose} title={editing ? '공급처 수정' : '새 공급처 등록'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>취소</Button>
        <Button onClick={handleSave} disabled={saving || !dirty}>{saving ? '저장 중...' : '저장'}</Button>
      </>}
    >
      {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">{error}</div>}
      <div className="space-y-4">
        <div><Label required>공급처명</Label><Input value={form.name || ''} onChange={e => update('name', e.target.value)} /></div>
        <div>
          <Label>분류</Label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_OPTIONS.map(c => (
              <button key={c.value} type="button"
                onClick={() => { setCategory(category === c.label ? null : c.label); setDirty(true) }}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${category === c.label ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
                {c.label}
              </button>
            ))}
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
        <div>
          <Label>취급 품목 <span className="text-zinc-400 font-normal">({items.length}개)</span></Label>
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
        <div><Label>메모</Label><Textarea rows={3} value={memo} onChange={e => { setMemo(e.target.value); setDirty(true) }} /></div>
      </div>
    </Drawer>
  )
}
