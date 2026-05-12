import { useEffect, useState, ReactNode } from 'react'
import { supabase } from '@/lib/supabase'

/* ────────────────────────────────────────────────
 * PIN 게이트 (사용자 선택 + 키패드)
 *
 * 흐름:
 *   1) Supabase app_users 에서 사용자 목록 로드
 *   2) 사용자 선택 → PIN 4자리 입력 (키보드 + 화면 키패드)
 *   3) 일치하면 localStorage 에 사용자 정보 저장 → 앱 진입
 *
 * 보안 안내:
 *   클라이언트 사이드 소프트 락. 진짜 보안은 Supabase RLS 가 담당.
 * ──────────────────────────────────────────────── */

const STORAGE_KEY = 'app_user'

export interface AppUser {
  id: string
  name: string
  pin: string
  role: 'admin' | 'staff'
}

export interface SessionUser {
  id: string
  name: string
  role: 'admin' | 'staff'
}

export function getCurrentUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as SessionUser
  } catch {
    return null
  }
}

export function lock() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
  window.location.reload()
}

export default function PinGate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState<boolean>(getCurrentUser() !== null)

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setUnlocked(getCurrentUser() !== null)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  if (unlocked) return <>{children}</>

  return <PinScreen onSuccess={() => setUnlocked(true)} />
}

/* ────────────────────────────────────────── */

function PinScreen({ onSuccess }: { onSuccess: () => void }) {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [error, setError] = useState(false)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    supabase
      .from('app_users')
      .select('*')
      .order('role', { ascending: true })  // admin first
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          setLoadError(error.message)
          setLoading(false)
          return
        }
        setUsers((data ?? []) as AppUser[])
        // 사용자가 1명이면 자동 선택
        if (data && data.length === 1) setSelectedUserId(data[0].id)
        setLoading(false)
      })
  }, [])

  const selectedUser = users.find(u => u.id === selectedUserId) || null

  function appendDigit(d: string) {
    if (pin.length >= 4) return
    setError(false)
    const next = pin + d
    setPin(next)
    if (next.length === 4) verifyPin(next)
  }

  function backspace() {
    setError(false)
    setPin(pin.slice(0, -1))
  }

  function verifyPin(entered: string) {
    if (!selectedUser) return
    if (entered === selectedUser.pin) {
      try {
        const session: SessionUser = {
          id: selectedUser.id,
          name: selectedUser.name,
          role: selectedUser.role,
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
      } catch {}
      setTimeout(onSuccess, 150)
    } else {
      setError(true)
      setShake(true)
      setTimeout(() => {
        setPin('')
        setShake(false)
      }, 500)
    }
  }

  // 키보드 입력도 받기
  useEffect(() => {
    if (!selectedUser) return
    function onKey(e: KeyboardEvent) {
      if (e.key >= '0' && e.key <= '9') appendDigit(e.key)
      else if (e.key === 'Backspace') backspace()
      else if (e.key === 'Escape') {
        setSelectedUserId(null)
        setPin('')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUser, pin])

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-zinc-950 px-4 py-8">
      <div className="w-full max-w-sm">
        {/* 로고 / 타이틀 */}
        <div className="text-center mb-6">
          <div className="inline-flex w-12 h-12 rounded-2xl bg-zinc-900 border border-zinc-800 items-center justify-center mb-4">
            <span className="text-white font-bold text-sm tracking-tight">AW</span>
          </div>
          <h1 className="text-[18px] font-semibold text-white tracking-tight">프로모션 어드민</h1>
          {selectedUser && (
            <p className="text-[12px] text-zinc-500 mt-1.5">
              {selectedUser.name} · PIN 4자리 입력
            </p>
          )}
          {!selectedUser && !loading && users.length > 0 && (
            <p className="text-[12px] text-zinc-500 mt-1.5">사용자를 선택하세요</p>
          )}
        </div>

        {loading ? (
          <p className="text-center text-zinc-600 text-[12px] py-8">불러오는 중…</p>
        ) : loadError ? (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-[12px] text-rose-300">
            <p className="font-semibold mb-1">사용자 목록을 불러올 수 없어요</p>
            <p className="opacity-80">{loadError}</p>
            <p className="mt-2 opacity-60">
              app_users 테이블이 만들어졌는지 확인해주세요. (supabase-add-app-users.sql)
            </p>
          </div>
        ) : users.length === 0 ? (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 text-[12px] text-amber-200 text-center">
            등록된 사용자가 없어요. SQL을 실행했는지 확인해주세요.
          </div>
        ) : !selectedUser ? (
          <UserPicker users={users} onSelect={setSelectedUserId} />
        ) : (
          <PinPad
            pin={pin}
            error={error}
            shake={shake}
            onDigit={appendDigit}
            onBackspace={backspace}
            onChangeUser={() => { setSelectedUserId(null); setPin('') }}
            multipleUsers={users.length > 1}
          />
        )}

        <p className="mt-6 text-[11px] text-zinc-600 text-center leading-relaxed">
          이 페이지는 비공개입니다.<br />
          PIN을 모르면 함기호에게 문의하세요.
        </p>
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20%, 60% { transform: translateX(-8px); }
          40%, 80% { transform: translateX(8px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  )
}

function UserPicker({ users, onSelect }: { users: AppUser[]; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {users.map(u => (
        <button
          key={u.id}
          onClick={() => onSelect(u.id)}
          className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800 transition-colors text-left"
        >
          <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-white font-semibold text-[14px]">
            {u.name.slice(0, 1)}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-medium text-white truncate">{u.name}</div>
            <div className="text-[11px] text-zinc-500">
              {u.role === 'admin' ? '관리자' : '직원'}
            </div>
          </div>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-zinc-600">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      ))}
    </div>
  )
}

function PinPad({
  pin, error, shake, onDigit, onBackspace, onChangeUser, multipleUsers,
}: {
  pin: string
  error: boolean
  shake: boolean
  onDigit: (d: string) => void
  onBackspace: () => void
  onChangeUser: () => void
  multipleUsers: boolean
}) {
  return (
    <div>
      {/* 4자리 표시 */}
      <div className={`flex justify-center gap-3 mb-3 ${shake ? 'animate-shake' : ''}`}>
        {[0, 1, 2, 3].map(i => (
          <div
            key={i}
            className={`w-14 h-16 rounded-xl border-2 flex items-center justify-center text-[24px] text-white transition-colors ${
              error
                ? 'border-rose-500 bg-zinc-900'
                : pin[i]
                ? 'border-zinc-500 bg-zinc-800'
                : 'border-zinc-800 bg-zinc-900'
            }`}
          >
            {pin[i] ? '•' : ''}
          </div>
        ))}
      </div>

      <div className="h-5 text-center mb-3">
        {error && <p className="text-[12px] text-rose-400">잘못된 PIN입니다</p>}
      </div>

      {/* 키패드 */}
      <div className="grid grid-cols-3 gap-2">
        {['1','2','3','4','5','6','7','8','9'].map(d => (
          <KeypadButton key={d} onClick={() => onDigit(d)}>{d}</KeypadButton>
        ))}
        <KeypadButton onClick={multipleUsers ? onChangeUser : () => {}} disabled={!multipleUsers} mute>
          {multipleUsers ? '사용자' : ''}
        </KeypadButton>
        <KeypadButton onClick={() => onDigit('0')}>0</KeypadButton>
        <KeypadButton onClick={onBackspace} mute>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 4H8l-7 8 7 8h13a2 2 0 002-2V6a2 2 0 00-2-2zM18 9l-6 6M12 9l6 6" />
          </svg>
        </KeypadButton>
      </div>
    </div>
  )
}

function KeypadButton({
  onClick, children, mute, disabled,
}: {
  onClick: () => void
  children: ReactNode
  mute?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`h-16 rounded-xl text-[22px] font-medium transition-colors flex items-center justify-center select-none ${
        disabled
          ? 'bg-zinc-950 border border-zinc-900 text-zinc-800 cursor-default'
          : mute
          ? 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:bg-zinc-800 active:bg-zinc-700'
          : 'bg-zinc-800 border border-zinc-700 text-white hover:bg-zinc-700 active:bg-zinc-600'
      }`}
    >
      {children}
    </button>
  )
}
