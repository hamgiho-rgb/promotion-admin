import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Button, Input, Label, PageHeader, Drawer, Empty, Badge } from '@/components/ui'
import { getCurrentUser, lock, type AppUser } from '@/components/PinGate'

/* ────────────────────────────────────────────────
 * 설정 / 사용자 관리
 * - 모두: 내 정보 조회, 내 PIN 변경
 * - 관리자(함기호)만: 사용자 추가/삭제, 다른 사람 PIN 변경
 * ──────────────────────────────────────────────── */

export default function Settings() {
  const me = getCurrentUser()
  const isAdmin = me?.role === 'admin'

  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<AppUser | null>(null)

  async function load() {
    setLoading(true)
    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .order('role')
      .order('name')
    if (error) {
      alert('불러오기 실패: ' + error.message)
      setLoading(false)
      return
    }
    setUsers((data ?? []) as AppUser[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function handleDelete(u: AppUser) {
    if (!isAdmin) return
    if (u.id === me?.id) return alert('본인 계정은 삭제할 수 없어요.')
    if (u.role === 'admin') {
      const adminCount = users.filter(x => x.role === 'admin').length
      if (adminCount <= 1) return alert('마지막 관리자는 삭제할 수 없어요.')
    }
    if (!confirm(`'${u.name}' 사용자를 삭제할까요?\n다시 PIN으로 로그인할 수 없습니다.`)) return
    const { error } = await supabase.from('app_users').delete().eq('id', u.id)
    if (error) return alert('삭제 실패: ' + error.message)
    load()
  }

  if (!me) {
    return <div className="p-8 text-zinc-500 text-[13px]">로그인 정보를 찾을 수 없어요. 다시 로그인 해주세요.</div>
  }

  return (
    <div>
      <PageHeader
        title="설정"
        description="현재 로그인한 사용자 정보를 보고 PIN 또는 사용자 목록을 관리합니다."
      />

      {/* 내 정보 */}
      <div className="bg-white border border-zinc-200 rounded-2xl p-5 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-zinc-900 flex items-center justify-center text-white font-bold text-[20px]">
            {me.name.slice(0, 1)}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold text-zinc-900">{me.name}</h2>
              <Badge color={me.role === 'admin' ? 'violet' : 'zinc'}>
                {me.role === 'admin' ? '관리자' : '직원'}
              </Badge>
            </div>
            <p className="text-[12px] text-zinc-500 mt-1">현재 로그인 중</p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const u = users.find(x => x.id === me.id)
                if (u) { setEditing(u); setDrawerOpen(true) }
              }}
            >
              내 PIN 변경
            </Button>
            <Button
              variant="ghost"
              onClick={() => { if (confirm('잠그시겠어요?')) lock() }}
            >
              잠금
            </Button>
          </div>
        </div>
      </div>

      {/* 사용자 목록 (관리자만 추가/삭제 가능) */}
      <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
          <div>
            <h3 className="text-[14px] font-semibold text-zinc-900">사용자 목록</h3>
            <p className="text-[11px] text-zinc-500 mt-0.5">
              {isAdmin
                ? '추가·삭제 가능 (관리자 권한)'
                : '관리자만 추가·삭제할 수 있어요. 본인 PIN 변경은 위에서 가능.'}
            </p>
          </div>
          {isAdmin && (
            <Button onClick={() => { setEditing(null); setDrawerOpen(true) }}>＋ 새 사용자</Button>
          )}
        </div>

        {loading ? (
          <div className="p-12 text-center text-[12px] text-zinc-400">불러오는 중…</div>
        ) : users.length === 0 ? (
          <Empty icon="👥" title="등록된 사용자가 없어요" />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
                <th className="px-5 py-3">이름</th>
                <th className="px-5 py-3">권한</th>
                <th className="px-5 py-3">등록일</th>
                <th className="px-5 py-3 text-right">관리</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="border-t border-zinc-100 hover:bg-zinc-50/50">
                  <td className="px-5 py-3 font-medium text-zinc-900">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-700 font-semibold text-[12px]">
                        {u.name.slice(0, 1)}
                      </div>
                      <span>{u.name}</span>
                      {u.id === me.id && <span className="text-[11px] text-zinc-400">(나)</span>}
                    </div>
                  </td>
                  <td className="px-5 py-3">
                    <Badge color={u.role === 'admin' ? 'violet' : 'zinc'}>
                      {u.role === 'admin' ? '관리자' : '직원'}
                    </Badge>
                  </td>
                  <td className="px-5 py-3 text-zinc-500 tabular-nums text-[12px]">
                    {new Date((u as any).created_at || 0).toLocaleDateString('ko-KR')}
                  </td>
                  <td className="px-5 py-3 text-right whitespace-nowrap">
                    {(isAdmin || u.id === me.id) && (
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(u); setDrawerOpen(true) }}>
                        PIN 변경
                      </Button>
                    )}
                    {isAdmin && u.id !== me.id && (
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(u)} className="text-rose-600 hover:bg-rose-50">
                        삭제
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <UserDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        editing={editing}
        currentUser={me}
        isAdmin={isAdmin}
        onSaved={() => { setDrawerOpen(false); load() }}
      />
    </div>
  )
}

/* ────────────────────────────────────────── */

function UserDrawer({
  open, onClose, editing, currentUser, isAdmin, onSaved,
}: {
  open: boolean
  onClose: () => void
  editing: AppUser | null
  currentUser: { id: string; name: string; role: 'admin' | 'staff' }
  isAdmin: boolean
  onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [pin2, setPin2] = useState('')
  const [role, setRole] = useState<'admin' | 'staff'>('staff')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (editing) {
      setName(editing.name)
      setPin('')
      setPin2('')
      setRole(editing.role)
    } else {
      setName('')
      setPin('')
      setPin2('')
      setRole('staff')
    }
    setError(null)
  }, [editing, open])

  const isSelf = editing?.id === currentUser.id

  async function handleSave() {
    setError(null)
    if (!name.trim()) return setError('이름을 입력해주세요.')
    // PIN 변경하는 경우 (또는 신규 등록)
    const wantsPinChange = pin.length > 0 || pin2.length > 0 || !editing
    if (wantsPinChange) {
      if (!/^\d{4}$/.test(pin)) return setError('PIN은 숫자 4자리여야 해요.')
      if (pin !== pin2) return setError('PIN이 일치하지 않아요.')
    }

    setSaving(true)
    let result
    if (editing) {
      const payload: any = { name: name.trim() }
      if (wantsPinChange) payload.pin = pin
      // 권한은 관리자만 변경 가능, 본인이 본인 권한 강등 방지
      if (isAdmin && !isSelf) payload.role = role
      result = await supabase.from('app_users').update(payload).eq('id', editing.id)
    } else {
      // 신규는 관리자만
      if (!isAdmin) { setSaving(false); return setError('관리자만 추가할 수 있어요.') }
      result = await supabase.from('app_users').insert({
        name: name.trim(),
        pin,
        role,
      })
    }
    setSaving(false)
    if (result.error) return setError(result.error.message)
    onSaved()
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `${editing.name} 정보 수정` : '새 사용자 추가'}
      footer={<>
        <Button variant="secondary" onClick={onClose}>취소</Button>
        <Button onClick={handleSave} disabled={saving}>{saving ? '저장 중…' : '저장'}</Button>
      </>}
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">
          {error}
        </div>
      )}
      <div className="space-y-4">
        <div>
          <Label required>이름</Label>
          <Input value={name} onChange={e => setName(e.target.value)} disabled={!isAdmin && !isSelf} />
        </div>

        {isAdmin && !isSelf && (
          <div>
            <Label>권한</Label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setRole('staff')}
                className={`flex-1 px-3 py-2 rounded-lg text-[13px] font-medium border ${
                  role === 'staff'
                    ? 'bg-zinc-900 text-white border-zinc-900'
                    : 'bg-white text-zinc-700 border-zinc-200'
                }`}
              >
                직원
              </button>
              <button
                type="button"
                onClick={() => setRole('admin')}
                className={`flex-1 px-3 py-2 rounded-lg text-[13px] font-medium border ${
                  role === 'admin'
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-zinc-700 border-zinc-200'
                }`}
              >
                관리자
              </button>
            </div>
            <p className="text-[11px] text-zinc-500 mt-1.5">
              관리자: 사용자 추가·삭제 가능 / 직원: 본인 PIN만 변경
            </p>
          </div>
        )}

        <div className="pt-2 border-t border-zinc-100">
          <Label>{editing ? '새 PIN (변경 시에만 입력)' : 'PIN 4자리'}</Label>
          <Input
            type="tel"
            inputMode="numeric"
            maxLength={4}
            value={pin}
            onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </div>
        <div>
          <Label>PIN 한 번 더</Label>
          <Input
            type="tel"
            inputMode="numeric"
            maxLength={4}
            value={pin2}
            onChange={e => setPin2(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
          {pin && pin2 && pin !== pin2 && (
            <p className="text-[11px] text-rose-500 mt-1">PIN이 일치하지 않아요</p>
          )}
        </div>
      </div>
    </Drawer>
  )
}
