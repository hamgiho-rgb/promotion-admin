import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/lib/types'
import { Button, Input, Label, Drawer, Select } from '@/components/ui'

/* ─────────────────────────────────────────────
 * 공급처 선택기 + 인라인 등록
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
 *   - 드롭다운 맨 아래 "+ 새 공급처 등록" 옵션
 *   - 누르면 우측 드로어 슬라이드 → 이름/분류/전화/메모 입력 → 저장
 *   - 저장되면 자동으로 그 공급처 선택됨
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

const ADD_NEW_VALUE = '__add_new__'

interface Props {
  value: string | null
  suppliers: Vendor[]
  onChange: (id: string | null) => void
  onSuppliersChanged: () => void  // 새 공급처 등록 후 호출 (부모가 재로드)
  className?: string
}

export default function SupplierPicker({ value, suppliers, onChange, onSuppliersChanged, className }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)

  function handleSelect(v: string) {
    if (v === ADD_NEW_VALUE) {
      setDrawerOpen(true)
    } else {
      onChange(v || null)
    }
  }

  return (
    <>
      <Select
        value={value || ''}
        onChange={e => handleSelect(e.target.value)}
        className={className}
      >
        <option value="">— 미지정 —</option>
        {suppliers.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
        <option disabled>──────────</option>
        <option value={ADD_NEW_VALUE}>＋ 새 공급처 등록</option>
      </Select>

      <NewSupplierDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={(newId) => {
          setDrawerOpen(false)
          onSuppliersChanged()
          onChange(newId)
        }}
      />
    </>
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
