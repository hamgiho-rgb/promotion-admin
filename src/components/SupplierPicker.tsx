import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/lib/types'
import { Button, Input, Label, Drawer } from '@/components/ui'

/* ─────────────────────────────────────────────
 * 공급처 선택기 — 검색 가능한 커스텀 dropdown
 *
 * 사용:
 *   <SupplierPicker
 *     value={item.supplier_id}
 *     suppliers={suppliers}
 *     onChange={id => updateItem(item.id, { supplier_id: id })}
 *     onSuppliersChanged={() => reloadSuppliers()}
 *   />
 *
 * 동작:
 *   - 트리거 클릭 → 패널 열림 (검색창 + 리스트)
 *   - 타이핑으로 즉시 필터링
 *   - 화살표 키로 이동, Enter로 선택
 *   - 맨 아래 "+ 새 공급처 등록" → 우측 드로어
 * ───────────────────────────────────────────── */

const CATEGORIES = [
  { value: '원단', label: '원단', color: 'blue' },
  { value: '립', label: '립', color: 'amber' },
  { value: '나염/프린트', label: '나염/프린트', color: 'violet' },
  { value: '자수', label: '자수', color: 'rose' },
  { value: '부자재', label: '부자재', color: 'amber' },
  { value: '워싱', label: '워싱', color: 'blue' },
  { value: '라벨', label: '라벨', color: 'zinc' },
  { value: '공임', label: '공임', color: 'green' },
  { value: '포장', label: '포장', color: 'rose' },
  { value: '기타', label: '기타', color: 'zinc' },
]

interface Props {
  value: string | null
  suppliers: Vendor[]
  onChange: (id: string | null) => void
  onSuppliersChanged: () => void
  className?: string
}

export default function SupplierPicker({ value, suppliers, onChange, onSuppliersChanged, className }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = suppliers.find(s => s.id === value) || null

  // 검색 필터 + 분류 정보 포함
  const filtered = suppliers.filter(s => {
    if (!search) return true
    const q = search.toLowerCase()
    const hay = `${s.name} ${(s as any).company_name || ''} ${s.memo || ''}`.toLowerCase()
    return hay.includes(q)
  })

  // 외부 클릭 감지
  useEffect(() => {
    if (!open) return
    function handler(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // 열릴 때 검색창 포커스 + 검색 초기화
  useEffect(() => {
    if (open) {
      setSearch('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  function pick(id: string | null) {
    onChange(id)
    setOpen(false)
  }

  function getCategoryTag(memo: string | null): string {
    if (!memo) return ''
    const m = memo.match(/^\[([^\]]+)\]/)
    return m?.[1] || ''
  }

  return (
    <div className="relative" ref={wrapRef}>
      {/* 트리거 */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full text-left px-2 py-1.5 bg-white border border-zinc-200 rounded-lg outline-none hover:border-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-colors flex items-center justify-between gap-1 ${className || 'text-[13px]'}`}
      >
        <span className={`truncate ${selected ? 'text-zinc-900' : 'text-zinc-400'}`}>
          {selected ? selected.name : '— 미지정 —'}
        </span>
        <span className="text-zinc-400 text-[10px] flex-shrink-0">▼</span>
      </button>

      {/* 드롭다운 패널 */}
      {open && (
        <div className="absolute z-30 mt-1 left-0 right-0 min-w-[240px] bg-white border border-zinc-300 rounded-lg shadow-lg overflow-hidden">
          {/* 검색창 */}
          <div className="p-2 border-b border-zinc-100">
            <input
              ref={inputRef}
              value={search}
              onChange={e => { setSearch(e.target.value); setActiveIdx(0) }}
              onKeyDown={e => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length)) }
                else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)) }
                else if (e.key === 'Enter') {
                  e.preventDefault()
                  if (activeIdx === 0) pick(null)
                  else if (filtered[activeIdx - 1]) pick(filtered[activeIdx - 1].id)
                }
                else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
              }}
              placeholder="🔍 공급처명 / 분류 / 메모 검색"
              className="w-full px-2.5 py-1.5 text-[12px] bg-zinc-50 border border-zinc-200 rounded outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-100"
            />
          </div>

          {/* 리스트 */}
          <div className="max-h-64 overflow-y-auto">
            {/* 미지정 옵션 */}
            <button
              type="button"
              onClick={() => pick(null)}
              onMouseEnter={() => setActiveIdx(0)}
              className={`w-full text-left px-3 py-1.5 text-[12px] text-zinc-400 italic ${activeIdx === 0 ? 'bg-zinc-100' : 'hover:bg-zinc-50'} ${value === null ? 'font-semibold' : ''}`}
            >
              — 미지정 —
            </button>

            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-[12px] text-zinc-400 text-center">검색 결과 없음</p>
            ) : filtered.map((s, i) => {
              const cat = getCategoryTag(s.memo)
              const isActive = activeIdx === i + 1
              const isSelected = value === s.id
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pick(s.id)}
                  onMouseEnter={() => setActiveIdx(i + 1)}
                  className={`w-full text-left px-3 py-1.5 text-[12px] ${isActive ? 'bg-zinc-100' : 'hover:bg-zinc-50'} ${isSelected ? 'bg-emerald-50 font-semibold' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate">{s.name}</span>
                    {cat && <span className="text-[9px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-600 flex-shrink-0">{cat}</span>}
                  </div>
                </button>
              )
            })}
          </div>

          {/* 새 공급처 등록 */}
          <button
            type="button"
            onClick={() => { setOpen(false); setDrawerOpen(true) }}
            className="w-full text-left px-3 py-2 text-[12px] text-blue-700 hover:bg-blue-50 border-t border-zinc-200 font-medium"
          >
            ＋ 새 공급처 등록
          </button>
        </div>
      )}

      <NewSupplierDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={(newId) => {
          setDrawerOpen(false)
          onSuppliersChanged()
          onChange(newId)
        }}
      />
    </div>
  )
}

function NewSupplierDrawer({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  const [phone, setPhone] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName(''); setCategory(null); setPhone(''); setMemo(''); setError(null)
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) return setError('공급처명은 필수입니다.')
    setSaving(true)
    const finalMemo = category
      ? (memo.trim() ? `[${category}] ${memo.trim()}` : `[${category}]`)
      : (memo.trim() || null)

    const { data, error } = await supabase
      .from('vendors')
      .insert({
        name: name.trim(),
        vendor_type: 'supplier',
        phone: phone.trim() || null,
        memo: finalMemo,
        size_system: [],
      })
      .select()
      .single()

    setSaving(false)
    if (error) return setError(error.message)
    reset()
    onCreated(data.id)
  }

  function handleClose() {
    if (name || category || phone || memo) {
      if (!confirm('입력한 내용이 사라져요. 닫을까요?')) return
    }
    reset()
    onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="새 공급처 등록 (간편)"
      width="sm"
      footer={<>
        <Button variant="secondary" onClick={handleClose}>취소</Button>
        <Button onClick={handleSave} disabled={saving || !name.trim()}>
          {saving ? '저장 중…' : '저장하고 선택'}
        </Button>
      </>}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <div>
          <Label required>공급처명</Label>
          <Input value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label>분류</Label>
          <div className="flex flex-wrap gap-1.5">
            {CATEGORIES.map(c => (
              <button
                key={c.value}
                type="button"
                onClick={() => setCategory(category === c.value ? null : c.value)}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium ${
                  category === c.value
                    ? 'bg-zinc-900 text-white'
                    : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
                }`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <Label>전화번호</Label>
          <Input value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div>
          <Label>메모</Label>
          <Input value={memo} onChange={e => setMemo(e.target.value)} />
          <p className="text-[11px] text-zinc-500 mt-1.5">
            사업자번호, 주소, 계좌 등은 나중에 [공급처] 페이지에서 추가할 수 있어요.
          </p>
        </div>
      </div>
    </Drawer>
  )
}
