import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Input, Select, Empty, Badge } from '@/components/ui'
import { ACTION_LABEL, ACTION_COLOR, ENTITY_LABEL, type LogAction, type EntityType } from '@/lib/activityLog'
import { fmtKRDateTime } from '@/lib/datetime'

interface ActivityLog {
  id: string
  actor_name: string | null
  action: LogAction
  entity_type: EntityType
  entity_id: string | null
  entity_label: string | null
  summary: string | null
  details: any
  created_at: string
}

export default function ActivityLogs() {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [actorFilter, setActorFilter] = useState<string>('all')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [entityFilter, setEntityFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    const { data } = await supabase.from('activity_logs').select('*').order('created_at', { ascending: false }).limit(500)
    setLogs((data ?? []) as ActivityLog[])
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  // 필터링
  const filtered = logs.filter(l => {
    if (actorFilter !== 'all' && l.actor_name !== actorFilter) return false
    if (actionFilter !== 'all' && l.action !== actionFilter) return false
    if (entityFilter !== 'all' && l.entity_type !== entityFilter) return false
    if (search) {
      const s = search.toLowerCase()
      const hay = `${l.actor_name || ''} ${l.entity_label || ''} ${l.summary || ''}`.toLowerCase()
      if (!hay.includes(s)) return false
    }
    return true
  })

  // 액터 목록 (필터용)
  const actors = Array.from(new Set(logs.map(l => l.actor_name).filter(Boolean))) as string[]

  // 통계
  const todayCount = logs.filter(l => {
    const d = new Date(l.created_at).getTime()
    return Date.now() - d < 24 * 60 * 60 * 1000
  }).length
  const dangerCount = logs.filter(l => ['hard_delete', 'merge', 'bulk_delete'].includes(l.action)).length

  return (
    <div>
      {/* 그라데이션 헤더 — 로그는 차분한 잿빛 */}
      <div className="mb-5 -mx-4 -mt-4 sm:-mx-6 sm:-mt-6 px-4 sm:px-6 pt-5 pb-6 bg-gradient-to-br from-zinc-800 via-slate-800 to-zinc-900 text-white rounded-b-3xl">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wider text-zinc-400 mb-1">ACTIVITY LOG</p>
            <h1 className="text-[24px] sm:text-[28px] font-bold tracking-tight">📋 변경 이력</h1>
            <p className="text-[12px] text-zinc-300/80 mt-1">누가 / 언제 / 무엇을 했는지 모두 기록 · 최근 500건까지</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] uppercase tracking-wider text-zinc-400 mb-1">총 기록</div>
            <div className="text-[26px] sm:text-[32px] font-bold tabular-nums">{logs.length.toLocaleString()}</div>
            <div className="text-[12px] text-zinc-400 mt-0.5">오늘 {todayCount}건</div>
          </div>
        </div>
        {dangerCount > 0 && (
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-400/20 text-rose-100 text-[12px] border border-rose-300/30">
            🔻 위험 작업 (병합 / 영구삭제 / 대량삭제) 총 {dangerCount}건
          </div>
        )}
      </div>

      {/* 필터 */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-3 mb-4 flex items-center gap-2 flex-wrap">
        <Select value={actorFilter} onChange={e => setActorFilter(e.target.value)} className="w-32">
          <option value="all">모든 사용자</option>
          {actors.map(a => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select value={actionFilter} onChange={e => setActionFilter(e.target.value)} className="w-36">
          <option value="all">모든 작업</option>
          {Object.entries(ACTION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <Select value={entityFilter} onChange={e => setEntityFilter(e.target.value)} className="w-36">
          <option value="all">모든 대상</option>
          {Object.entries(ENTITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </Select>
        <div className="flex-1 min-w-[200px]">
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="요약 / 대상 검색" />
        </div>
        <span className="text-[11px] text-zinc-500 ml-auto">{filtered.length}건</span>
      </div>

      {/* 표 */}
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중…</div>
        ) : filtered.length === 0 ? (
          <Empty icon="📋" title="기록된 이력이 없어요" description="앞으로 일어나는 변경 사항이 여기에 자동 기록됩니다." />
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10px] font-semibold uppercase text-zinc-500 border-b border-zinc-100">
                <th className="px-4 py-2 w-40">시간</th>
                <th className="px-4 py-2 w-24">사용자</th>
                <th className="px-4 py-2 w-24">작업</th>
                <th className="px-4 py-2 w-28">대상</th>
                <th className="px-4 py-2">요약</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => (
                <tr key={l.id} className="border-b border-zinc-50 hover:bg-zinc-50/40">
                  <td className="px-4 py-2 text-zinc-500 tabular-nums">{fmtKRDateTime(l.created_at)}</td>
                  <td className="px-4 py-2 text-zinc-700">{l.actor_name || '—'}</td>
                  <td className="px-4 py-2"><Badge color={ACTION_COLOR[l.action] || 'zinc'}>{ACTION_LABEL[l.action] || l.action}</Badge></td>
                  <td className="px-4 py-2 text-zinc-600">
                    {ENTITY_LABEL[l.entity_type] || l.entity_type}
                    {l.entity_label && <div className="text-[10px] text-zinc-500 mt-0.5">{l.entity_label}</div>}
                  </td>
                  <td className="px-4 py-2 text-zinc-700">{l.summary || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
