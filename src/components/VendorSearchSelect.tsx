import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Vendor } from '@/lib/types'

/* ─────────────────────────────────────────────
 * 거래처 검색 가능한 드롭다운 (필터/선택용 공용)
 *
 * 사용:
 *   <VendorSearchSelect
 *     value={vendorFilter}              // 'all' | vendorId
 *     vendors={vendors}
 *     onChange={(v) => setVendorFilter(v)}
 *     allLabel="모든 거래처"
 *     placeholder="거래처 검색..."
 *   />
 *
 * 동작:
 *   - 클릭하면 패널 열림 (검색창 + 거래처 목록)
 *   - 즉시 필터링, ↑↓ 키 이동, Enter 선택
 *   - 바깥 클릭 시 닫힘
 *   - React Portal 로 body 에 띄움 (테이블 셀 안에서도 안 잘림)
 * ───────────────────────────────────────────── */

interface Props {
  value: string                          // 'all' 또는 vendor id
  vendors: Vendor[]
  onChange: (value: string) => void
  allLabel?: string                      // 전체 선택 라벨 (없으면 표시 X)
  placeholder?: string
  className?: string
}

export default function VendorSearchSelect({
  value,
  vendors,
  onChange,
  allLabel,
  placeholder = '검색...',
  className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = vendors.find(v => v.id === value) || null
  const isAll = allLabel && value === 'all'

  // 검색 필터링
  const filtered = vendors.filter(v => {
    if (!search) return true
    const q = search.toLowerCase()
    const hay = `${v.name} ${(v as any).company_name || ''}`.toLowerCase()
    return hay.includes(q)
  })

  // "전체" 옵션 포함된 통합 리스트
  const items: { id: string; label: string; sub?: string }[] = []
  if (allLabel) items.push({ id: 'all', label: allLabel })
  filtered.forEach(v => items.push({
    id: v.id,
    label: v.name,
    sub: (v as any).company_name || undefined,
  }))

  // 외부 클릭 닫기
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      const t = e.target as Node
      if (buttonRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 열릴 때 위치 측정 + 검색창 포커스
  useEffect(() => {
    if (!open) { setSearch(''); setActiveIdx(0); return }
    if (buttonRef.current) {
      const r = buttonRef.current.getBoundingClientRect()
      setPanelPos({ top: r.bottom + 4, left: r.left, width: Math.max(r.width, 240) })
    }
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  // 스크롤/리사이즈 시 닫기 (단, 패널 내부 스크롤은 무시)
  useEffect(() => {
    if (!open) return
    function close(e: Event) {
      if (panelRef.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(items.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const it = items[activeIdx]
      if (it) { onChange(it.id); setOpen(false) }
    }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full px-3 py-2 rounded-md border border-zinc-300 bg-white text-left text-[13px] flex items-center justify-between hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-blue-500 ${className}`}
      >
        <span className={`truncate ${selected || isAll ? 'text-zinc-900' : 'text-zinc-400'}`}>
          {isAll ? allLabel : selected ? selected.name : '거래처 선택'}
          {selected && (selected as any).company_name && (
            <span className="text-zinc-400 text-[11px] ml-1">({(selected as any).company_name})</span>
          )}
        </span>
        <span className={`text-zinc-400 text-[10px] ml-2 transition-transform ${open ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {open && panelPos && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: panelPos.top, left: panelPos.left, width: panelPos.width, zIndex: 100 }}
          className="bg-white border border-zinc-200 rounded-lg shadow-xl overflow-hidden"
        >
          <div className="p-2 border-b border-zinc-100">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setActiveIdx(0) }}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              className="w-full px-2.5 py-1.5 rounded border border-zinc-200 text-[12px] focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {items.length === 0 ? (
              <div className="p-4 text-center text-[12px] text-zinc-400">검색 결과 없음</div>
            ) : items.map((it, idx) => (
              <button
                key={it.id}
                type="button"
                onClick={() => { onChange(it.id); setOpen(false) }}
                onMouseEnter={() => setActiveIdx(idx)}
                className={`w-full px-3 py-2 text-left text-[12.5px] transition-colors ${
                  idx === activeIdx ? 'bg-blue-50' : 'hover:bg-zinc-50'
                } ${value === it.id ? 'font-semibold text-blue-700' : 'text-zinc-700'}`}
              >
                <div className="flex items-center justify-between gap-2 min-w-0">
                  <span className="truncate">{it.label}</span>
                  {value === it.id && <span className="text-blue-600 flex-shrink-0">✓</span>}
                </div>
                {it.sub && <div className="text-[10px] text-zinc-400 truncate">{it.sub}</div>}
              </button>
            ))}
          </div>
          <div className="px-3 py-1.5 bg-zinc-50 border-t border-zinc-100 text-[10px] text-zinc-500">
            ↑↓ 이동 · Enter 선택 · Esc 닫기
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
