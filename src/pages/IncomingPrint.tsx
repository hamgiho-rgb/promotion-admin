import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Incoming, IncomingItem, Vendor } from '@/lib/types'

/* ─────────────────────────────────────────────
 * 입고내역서 출력 페이지 — A4 인쇄용
 * URL: /incoming/:id/print
 * ───────────────────────────────────────────── */

const SUMMARY_RE = /^(합\s*계|소\s*계|총\s*계|계|total|sum)$/i
const NOTE_RE = /(위\s*품목|상기\s*품목|이상.*(출고|입고).*함|위\s*내역)/i

function isSummaryItem(it: { product_code?: string | null; product_name?: string | null }) {
  const code = (it.product_code || '').toString().trim()
  const name = (it.product_name || '').toString().trim()
  return SUMMARY_RE.test(code) || SUMMARY_RE.test(name) || NOTE_RE.test(code) || NOTE_RE.test(name)
}

export default function IncomingPrint() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [inc, setInc] = useState<Incoming | null>(null)
  const [items, setItems] = useState<IncomingItem[]>([])
  const [vendor, setVendor] = useState<Vendor | null>(null)

  useEffect(() => {
    if (!id) return
    ;(async () => {
      const { data: incData } = await supabase.from('incoming').select('*').eq('id', id).single()
      if (!incData) return
      setInc(incData as Incoming)
      const [{ data: itemData }, { data: vData }] = await Promise.all([
        supabase.from('incoming_items').select('*').eq('incoming_id', id),
        supabase.from('vendors').select('*').eq('id', incData.vendor_id).single(),
      ])
      const cleanItems = (itemData ?? []).filter(it => !isSummaryItem(it))
      // 정렬: 납기일 → 박스번호 → 품번
      cleanItems.sort((a: any, b: any) => {
        if (a.delivery_date !== b.delivery_date) return (a.delivery_date || '').localeCompare(b.delivery_date || '')
        if ((a.carton_no || 0) !== (b.carton_no || 0)) return (a.carton_no || 0) - (b.carton_no || 0)
        return (a.product_code || '').localeCompare(b.product_code || '')
      })
      setItems(cleanItems as IncomingItem[])
      setVendor(vData as Vendor)
    })()
  }, [id])

  if (!inc) {
    return <div className="p-12 text-center text-zinc-500">불러오는 중…</div>
  }

  // 거래처 사이즈 시스템 (없으면 라인에 들어있는 사이즈들 자동 수집)
  const sizeColumns = (() => {
    if (vendor?.size_system && vendor.size_system.length > 0) return vendor.size_system
    const set = new Set<string>()
    items.forEach(it => Object.keys(it.sizes || {}).forEach(k => set.add(k)))
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  })()

  // 합계
  const sizeTotals: Record<string, number> = {}
  let grandTotal = 0
  items.forEach(it => {
    Object.entries(it.sizes || {}).forEach(([sz, n]) => {
      const num = Number(n) || 0
      sizeTotals[sz] = (sizeTotals[sz] || 0) + num
    })
    grandTotal += Number(it.total_quantity || 0)
  })

  return (
    <div className="bg-zinc-100 min-h-screen py-8 print:bg-white print:py-0">
      {/* 인쇄 시 숨김 */}
      <div className="max-w-[900px] mx-auto mb-4 px-4 print:hidden flex items-center justify-between">
        <button onClick={() => navigate('/incoming')} className="text-[13px] text-zinc-600 hover:text-zinc-900 flex items-center gap-1">
          ← 목록으로
        </button>
        <div className="flex gap-2">
          <button onClick={() => window.print()} className="px-4 py-2 bg-zinc-900 text-white rounded-lg text-[13px] font-medium hover:bg-zinc-700">
            🖨️ 인쇄
          </button>
        </div>
      </div>

      <div className="max-w-[900px] mx-auto bg-white p-10 shadow-sm print:shadow-none print:p-0 print:max-w-none">
        {/* 제목 */}
        <h1 className="text-center text-[28px] font-bold tracking-[0.3em] mb-6">입 고 내 역 서</h1>

        {/* 거래처 + 기간 */}
        <div className="grid grid-cols-2 gap-4 mb-3">
          <div className="border-2 border-zinc-800 px-4 py-3">
            <span className="text-[11px] text-zinc-500 mr-2">받는 거래처</span>
            <span className="text-[16px] font-bold">{vendor?.name || '—'} 귀하</span>
          </div>
          <div className="border-2 border-zinc-800 px-4 py-3 flex items-center justify-between">
            <span className="text-[11px] text-zinc-500">기간</span>
            <span className="text-[16px] font-bold tabular-nums">{inc.period || ''}</span>
          </div>
        </div>

        {/* 메모 (있을 때만) */}
        {inc.notes && (
          <div className="border border-zinc-300 px-3 py-2 text-[11px] text-zinc-600 mb-3">
            {inc.notes}
          </div>
        )}

        {/* 표 */}
        <table className="w-full text-[11px] border-2 border-zinc-800">
          <thead>
            <tr className="bg-zinc-100 border-b-2 border-zinc-800">
              <th className="px-2 py-2 border-r border-zinc-300 w-20">날짜</th>
              <th className="px-2 py-2 border-r border-zinc-300 w-10">C/T</th>
              <th className="px-2 py-2 border-r border-zinc-300 w-24">품번</th>
              <th className="px-2 py-2 border-r border-zinc-300">품명</th>
              {sizeColumns.map(sz => (
                <th key={sz} className="px-1 py-2 border-r border-zinc-300 w-12 tabular-nums">{sz}</th>
              ))}
              <th className="px-2 py-2 w-14 bg-zinc-200">합계</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={4 + sizeColumns.length + 1} className="text-center py-6 text-zinc-400">입고 라인이 없습니다.</td></tr>
            ) : items.map(it => (
              <tr key={it.id} className="border-b border-zinc-200">
                <td className="px-2 py-1 border-r border-zinc-200 text-center tabular-nums">{it.delivery_date || ''}</td>
                <td className="px-2 py-1 border-r border-zinc-200 text-center tabular-nums">{it.carton_no || ''}</td>
                <td className="px-2 py-1 border-r border-zinc-200 font-mono text-[10px]">{it.product_code || ''}</td>
                <td className="px-2 py-1 border-r border-zinc-200">{it.product_name || ''}</td>
                {sizeColumns.map(sz => {
                  const n = Number((it.sizes as any)?.[sz] || 0)
                  return (
                    <td key={sz} className={`px-1 py-1 border-r border-zinc-200 text-right tabular-nums ${n === 0 ? 'text-zinc-300' : ''}`}>
                      {n > 0 ? n : ''}
                    </td>
                  )
                })}
                <td className="px-2 py-1 text-right tabular-nums font-medium bg-zinc-50">{Number(it.total_quantity).toLocaleString()}</td>
              </tr>
            ))}
            {/* 합계 행 */}
            {items.length > 0 && (
              <tr className="bg-zinc-100 border-t-2 border-zinc-800 font-bold">
                <td colSpan={4} className="px-2 py-2 text-center">합 계</td>
                {sizeColumns.map(sz => (
                  <td key={sz} className="px-1 py-2 border-l border-zinc-300 text-right tabular-nums">
                    {sizeTotals[sz] > 0 ? sizeTotals[sz].toLocaleString() : ''}
                  </td>
                ))}
                <td className="px-2 py-2 text-right tabular-nums bg-zinc-200">{grandTotal.toLocaleString()}</td>
              </tr>
            )}
          </tbody>
        </table>

        {/* 풋터 */}
        <div className="grid grid-cols-2 gap-6 mt-6 text-[11px]">
          <div className="border border-zinc-300 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">총 박스 수</div>
            <div className="text-[14px] font-bold tabular-nums">{items.length} 박스</div>
          </div>
          <div className="border border-zinc-300 px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1">총 입고 수량</div>
            <div className="text-[14px] font-bold tabular-nums">{grandTotal.toLocaleString()} 장</div>
          </div>
        </div>

        <p className="text-center mt-8 text-[12px] text-zinc-600">위와 같이 입고되었음을 확인합니다.</p>
      </div>
    </div>
  )
}
