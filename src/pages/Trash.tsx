import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Empty, Badge } from '@/components/ui'
import {
  TABLE_LABEL,
  TRASH_RETENTION_DAYS,
  type TrashableTable,
  cleanupOldTrash,
  daysRemaining,
  hardDelete,
  hardDeleteMany,
  restore,
  restoreMany,
} from '@/lib/trash'
import { fmtKRDateTime } from '@/lib/datetime'
import { logAction } from '@/lib/activityLog'

interface TrashRow {
  id: string
  deleted_at: string
  label: string
  meta?: string
}

const TABS: TrashableTable[] = ['vendors', 'products', 'invoices', 'incoming', 'quotations', 'supplier_invoices']

export default function Trash() {
  const [tab, setTab] = useState<TrashableTable>('vendors')
  const [rows, setRows] = useState<TrashRow[]>([])
  const [loading, setLoading] = useState(true)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [cleanupMsg, setCleanupMsg] = useState<string | null>(null)

  async function loadCounts() {
    const result: Record<string, number> = {}
    await Promise.all(TABS.map(async t => {
      const { count } = await supabase.from(t).select('id', { count: 'exact', head: true }).not('deleted_at', 'is', null)
      result[t] = count || 0
    }))
    setCounts(result)
  }

  async function loadTab(t: TrashableTable) {
    setLoading(true)
    setSelected(new Set())
    let query = supabase.from(t).select('*').not('deleted_at', 'is', null).order('deleted_at', { ascending: false })

    const { data } = await query
    const result: TrashRow[] = (data ?? []).map((r: any) => {
      let label = r.name || r.code || r.id.slice(0, 8)
      let meta = ''
      if (t === 'vendors') {
        label = r.name
        meta = `${r.vendor_type === 'customer' ? '고객' : '공급처'}${r.company_name ? ' · ' + r.company_name : ''}`
      } else if (t === 'products') {
        label = `${r.code || ''} ${r.name || ''}`.trim()
        meta = r.color || ''
      } else if (t === 'invoices') {
        label = `${r.issue_date || ''}`
        meta = `₩${Number(r.total || 0).toLocaleString()}`
      } else if (t === 'incoming') {
        label = `${r.period || ''} ${r.brand || ''}`.trim()
        meta = r.producer || ''
      } else if (t === 'quotations') {
        label = `${r.issue_date || ''}`
        meta = `₩${Number(r.total || 0).toLocaleString()}`
      } else if (t === 'supplier_invoices') {
        label = `${r.period || ''}`
        meta = `₩${Number(r.total || 0).toLocaleString()}`
      }
      return { id: r.id, deleted_at: r.deleted_at, label, meta }
    })
    setRows(result)
    setLoading(false)
  }

  async function init() {
    // 페이지 진입 시 30일 지난 거 자동 정리
    const cleaned = await cleanupOldTrash()
    if (cleaned.length > 0) {
      const total = cleaned.reduce((s, c) => s + c.count, 0)
      setCleanupMsg(`🧹 ${TRASH_RETENTION_DAYS}일이 지난 ${total}건이 자동 영구 삭제되었습니다.`)
    }
    await loadCounts()
    await loadTab(tab)
  }

  useEffect(() => { init() }, [])
  useEffect(() => { loadTab(tab) }, [tab])

  function toggleSel(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  function toggleAll() {
    if (selected.size === rows.length) setSelected(new Set())
    else setSelected(new Set(rows.map(r => r.id)))
  }

  async function handleRestore(id: string) {
    const r = rows.find(x => x.id === id)
    if (!r) return
    if (!confirm(`'${r.label}' 을(를) 복구할까요?`)) return
    await restore(tab, id)
    await loadCounts()
    await loadTab(tab)
  }
  async function handleRestoreSelected() {
    if (selected.size === 0) return
    if (!confirm(`선택한 ${selected.size}건을 복구할까요?`)) return
    await restoreMany(tab, Array.from(selected))
    await loadCounts()
    await loadTab(tab)
  }
  async function handleHardDelete(id: string) {
    const r = rows.find(x => x.id === id)
    if (!r) return
    if (!confirm(`'${r.label}' 을(를) 영구 삭제할까요?\n복구할 수 없습니다.`)) return
    await hardDelete(tab, id)
    await loadCounts()
    await loadTab(tab)
  }
  async function handleHardDeleteSelected() {
    if (selected.size === 0) return
    if (!confirm(`선택한 ${selected.size}건을 영구 삭제할까요?\n복구할 수 없습니다.`)) return
    const ids = Array.from(selected)
    await hardDeleteMany(tab, ids)
    logAction({ action: 'hard_delete', entity_type: tab.replace(/s$/, '') as any, summary: `${TABLE_LABEL[tab]} ${ids.length}건 영구 삭제`, details: { count: ids.length } })
    await loadCounts()
    await loadTab(tab)
  }
  async function handleEmpty() {
    if (rows.length === 0) return
    if (!confirm(`${TABLE_LABEL[tab]} 휴지통의 ${rows.length}건을 모두 영구 삭제할까요?\n복구할 수 없습니다.`)) return
    const ids = rows.map(r => r.id)
    await hardDeleteMany(tab, ids)
    logAction({ action: 'hard_delete', entity_type: tab.replace(/s$/, '') as any, summary: `${TABLE_LABEL[tab]} 휴지통 비움 (${ids.length}건)`, details: { count: ids.length } })
    await loadCounts()
    await loadTab(tab)
  }

  const totalTrash = Object.values(counts).reduce((s, n) => s + n, 0)

  return (
    <div>
      {/* 그라데이션 헤더 — 휴지통 톤 (잿빛) */}
      <div className="mb-5 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 px-4 sm:px-6 pt-5 pb-6 bg-gradient-to-br from-zinc-700 via-zinc-800 to-zinc-900 text-white rounded-b-3xl">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">TRASH</p>
            <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight">🗑️ 휴지통</h1>
            <p className="text-[12px] text-zinc-400 mt-1">
              삭제한 항목은 {TRASH_RETENTION_DAYS}일 동안 여기에 보관되고, 그 후 자동으로 영구 삭제됩니다.
            </p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">총 보관</div>
            <div className="text-[26px] sm:text-[32px] font-bold tabular-nums">{totalTrash.toLocaleString()}건</div>
          </div>
        </div>
        {cleanupMsg && (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-400/20 text-amber-100 text-[12px] border border-amber-300/30">
            {cleanupMsg}
          </div>
        )}
      </div>

      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        {/* 탭 */}
        <div className="px-4 pt-3 flex items-center gap-1 border-b border-zinc-100 flex-wrap">
          {TABS.map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative px-3 py-2 text-[12px] font-medium transition-colors ${tab === t ? 'text-zinc-900' : 'text-zinc-500 hover:text-zinc-800'}`}
            >
              <span className="flex items-center gap-1.5">
                {TABLE_LABEL[t]}
                {counts[t] > 0 && (
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${tab === t ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
                    {counts[t]}
                  </span>
                )}
              </span>
              {tab === t && <span className="absolute left-0 right-0 -bottom-px h-0.5 bg-zinc-900" />}
            </button>
          ))}
        </div>

        {/* 액션 바 */}
        {rows.length > 0 && (
          <div className="px-4 py-2 bg-zinc-50/50 border-b border-zinc-100 flex items-center gap-3 flex-wrap">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={selected.size === rows.length && rows.length > 0}
                onChange={toggleAll}
                className="rounded"
              />
              <span className="text-[12px] text-zinc-600">전체 선택 ({rows.length}건)</span>
            </label>
            {selected.size > 0 && (
              <>
                <Button size="sm" variant="secondary" onClick={handleRestoreSelected}>↩ {selected.size}건 복구</Button>
                <Button size="sm" variant="ghost" onClick={handleHardDeleteSelected} className="text-rose-600 hover:bg-rose-50">🗑 {selected.size}건 영구삭제</Button>
              </>
            )}
            <Button size="sm" variant="ghost" onClick={handleEmpty} className="text-rose-600 hover:bg-rose-50 ml-auto">휴지통 비우기</Button>
          </div>
        )}

        {loading ? (
          <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중…</div>
        ) : rows.length === 0 ? (
          <Empty icon="✨" title={`${TABLE_LABEL[tab]} 휴지통이 비어있어요`} description="삭제한 항목이 여기로 모입니다." />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase text-zinc-500 border-b border-zinc-100">
                <th className="px-4 py-2 w-8"></th>
                <th className="px-4 py-2">항목</th>
                <th className="px-4 py-2">정보</th>
                <th className="px-4 py-2">삭제일</th>
                <th className="px-4 py-2">자동 삭제까지</th>
                <th className="px-4 py-2 text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const days = daysRemaining(r.deleted_at)
                return (
                  <tr key={r.id} className={`border-b border-zinc-50 hover:bg-zinc-50/50 ${selected.has(r.id) ? 'bg-zinc-50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSel(r.id)} className="rounded" />
                    </td>
                    <td className="px-4 py-2.5 font-medium text-zinc-900">{r.label}</td>
                    <td className="px-4 py-2.5 text-zinc-500 text-[12px]">{r.meta}</td>
                    <td className="px-4 py-2.5 text-zinc-500 text-[12px] tabular-nums">
                      {fmtKRDateTime(r.deleted_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      {days <= 3
                        ? <Badge color="rose">{days}일</Badge>
                        : days <= 7
                        ? <Badge color="amber">{days}일</Badge>
                        : <span className="text-[12px] text-zinc-500 tabular-nums">{days}일</span>}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => handleRestore(r.id)} className="text-emerald-700 hover:bg-emerald-50">↩ 복구</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleHardDelete(r.id)} className="text-rose-600 hover:bg-rose-50">영구삭제</Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
