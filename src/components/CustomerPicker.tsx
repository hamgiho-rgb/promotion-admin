import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { Vendor } from '@/lib/types'
import { Button, Input, Label, Drawer, Select } from '@/components/ui'

/* ─────────────────────────────────────────────
 * 고객 거래처 선택기 + 인라인 등록 (Products 페이지용)
 * ───────────────────────────────────────────── */

const ADD_NEW_VALUE = '__add_new__'

interface Props {
  value: string | null
  customers: Vendor[]
  onChange: (id: string | null) => void
  onCustomersChanged: () => void
  className?: string
}

export default function CustomerPicker({ value, customers, onChange, onCustomersChanged, className }: Props) {
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
        <option value="">— 선택 —</option>
        {customers.map(c => (
          <option key={c.id} value={c.id}>{c.name}{c.company_name ? ` (${c.company_name})` : ''}</option>
        ))}
        <option disabled>──────────</option>
        <option value={ADD_NEW_VALUE}>＋ 새 고객 거래처 등록</option>
      </Select>

      <NewCustomerDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onCreated={(newId) => {
          setDrawerOpen(false)
          onCustomersChanged()
          onChange(newId)
        }}
      />
    </>
  )
}

function NewCustomerDrawer({ open, onClose, onCreated }: {
  open: boolean
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const [name, setName] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [phone, setPhone] = useState('')
  const [businessNumber, setBusinessNumber] = useState('')
  const [memo, setMemo] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setName(''); setCompanyName(''); setPhone(''); setBusinessNumber(''); setMemo(''); setError(null)
  }

  async function handleSave() {
    setError(null)
    if (!name.trim()) return setError('거래처명(브랜드명)은 필수입니다.')
    setSaving(true)
    const { data, error } = await supabase
      .from('vendors')
      .insert({
        name: name.trim(),
        company_name: companyName.trim() || null,
        vendor_type: 'customer',
        phone: phone.trim() || null,
        business_number: businessNumber.trim() || null,
        memo: memo.trim() || null,
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
    if (name || companyName || phone || businessNumber || memo) {
      if (!confirm('입력한 내용이 사라져요. 닫을까요?')) return
    }
    reset()
    onClose()
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="새 고객 거래처 등록 (간편)"
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
          <Label required>브랜드명</Label>
          <Input value={name} onChange={e => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <Label>회사명 (모회사)</Label>
          <Input value={companyName} onChange={e => setCompanyName(e.target.value)} />
          <p className="text-[11px] text-zinc-500 mt-1.5">예: 브랜드 '마크니'의 회사 '쿨파인더'</p>
        </div>
        <div>
          <Label>사업자번호</Label>
          <Input value={businessNumber} onChange={e => setBusinessNumber(e.target.value)} />
        </div>
        <div>
          <Label>전화번호</Label>
          <Input value={phone} onChange={e => setPhone(e.target.value)} />
        </div>
        <div>
          <Label>메모</Label>
          <Input value={memo} onChange={e => setMemo(e.target.value)} />
          <p className="text-[11px] text-zinc-500 mt-1.5">
            주소, 계좌, 사이즈 체계 등은 나중에 [고객 거래처] 페이지에서 추가.
          </p>
        </div>
      </div>
    </Drawer>
  )
}
