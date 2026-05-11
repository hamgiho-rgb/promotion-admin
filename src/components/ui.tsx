// 재사용 UI 컴포넌트들 (버튼, 입력, 모달 등)
import { ReactNode, ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, useState, useEffect, useRef } from 'react'

/* ───── 버튼 ───── */
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
}
export function Button({ variant = 'primary', size = 'md', className = '', ...rest }: BtnProps) {
  const base = 'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = { sm: 'px-3 py-1.5 text-[12px]', md: 'px-4 py-2 text-[13px]' }
  const variants = {
    primary: 'bg-zinc-900 text-white hover:bg-zinc-800',
    secondary: 'bg-white text-zinc-900 border border-zinc-200 hover:bg-zinc-50',
    ghost: 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900',
    danger: 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200',
  }
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...rest} />
}

/* ───── 입력 (모바일에선 16px 폰트로 iOS 줌 방지) ───── */
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full px-3 py-2.5 sm:py-2 text-[16px] sm:text-[13px] bg-white border border-zinc-200 rounded-lg outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-colors placeholder:text-zinc-400 ${className}`}
      {...rest}
    />
  )
}

export function Select({ className = '', children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full px-3 py-2.5 sm:py-2 text-[16px] sm:text-[13px] bg-white border border-zinc-200 rounded-lg outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-colors ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full px-3 py-2.5 sm:py-2 text-[16px] sm:text-[13px] bg-white border border-zinc-200 rounded-lg outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-colors placeholder:text-zinc-400 resize-y ${className}`}
      {...rest}
    />
  )
}

/* ───── 인라인 편집용 Input (한글 IME 안전) ─────
 * 표 안에서 칸에 직접 타이핑하면 매 키스트로크마다 DB 업데이트 → 리렌더 → 한글 조합 깨짐
 * 해결: 로컬 상태로 타이핑, 포커스 잃을 때(blur)나 Enter 키 누를 때 커밋
 */
interface InlineInputProps {
  value: string | number
  onCommit: (val: string) => void
  type?: 'text' | 'number'
  step?: string
  className?: string
}
export function InlineInput({ value, onCommit, type = 'text', step, className = '' }: InlineInputProps) {
  const [local, setLocal] = useState(String(value ?? ''))
  const composingRef = useRef(false)

  // 외부에서 값이 바뀌면 동기화 (단, 입력 중이 아닐 때만)
  useEffect(() => {
    setLocal(String(value ?? ''))
  }, [value])

  function commit() {
    if (String(value ?? '') !== local) onCommit(local)
  }

  return (
    <input
      type={type}
      step={step}
      value={local}
      onChange={e => setLocal(e.target.value)}
      onCompositionStart={() => { composingRef.current = true }}
      onCompositionEnd={() => { composingRef.current = false }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter' && !composingRef.current) {
          e.currentTarget.blur()
        }
      }}
      className={`w-full px-3 py-2.5 sm:py-2 text-[16px] sm:text-[13px] bg-white border border-zinc-200 rounded-lg outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100 transition-colors placeholder:text-zinc-400 ${className}`}
    />
  )
}

/* ───── 라벨 ───── */
export function Label({ children, required }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-[12px] font-medium text-zinc-700 mb-1.5">
      {children}
      {required && <span className="text-rose-500 ml-0.5">*</span>}
    </label>
  )
}

/* ───── 페이지 헤더 ───── */
export function PageHeader({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4">
      <div>
        <h1 className="text-[22px] sm:text-[26px] font-bold tracking-tight text-zinc-900">{title}</h1>
        {description && <p className="text-[12px] sm:text-[13px] text-zinc-600 mt-1 sm:mt-1.5">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  )
}

/* ───── 우측 슬라이드 패널 (드로어) — 모바일 전체화면 ───── */
export function Drawer({ open, onClose, title, children, footer, width = 'md' }: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  width?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  if (!open) return null
  // 모바일에서는 항상 전체화면, 데스크탑에서만 width 적용
  const widths = {
    sm: 'sm:w-[400px]',
    md: 'sm:w-[520px]',
    lg: 'sm:w-[800px]',
    xl: 'sm:w-[1100px]',
  }
  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="hidden sm:block flex-1 bg-zinc-900/30 backdrop-blur-[2px]" onClick={onClose} />
      <aside className={`w-full ${widths[width]} max-w-full h-full bg-white shadow-2xl flex flex-col animate-slide-in`}>
        <header className="px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-100 flex items-center justify-between">
          <h2 className="text-[15px] sm:text-[16px] font-semibold text-zinc-900">{title}</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-700 text-2xl leading-none w-10 h-10 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 active:bg-zinc-200">
            ×
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </div>
        {footer && <footer className="px-4 sm:px-6 py-3 sm:py-4 border-t border-zinc-100 flex items-center justify-end gap-2 flex-wrap">{footer}</footer>}
      </aside>
      <style>{`
        @keyframes slide-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .animate-slide-in { animation: slide-in 0.2s ease-out; }
      `}</style>
    </div>
  )
}

export function Empty({ icon = '✨', title, description, action }: { icon?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="py-16 text-center">
      <div className="w-12 h-12 rounded-2xl bg-zinc-100 mx-auto mb-3 flex items-center justify-center text-xl">{icon}</div>
      <p className="text-[14px] font-semibold text-zinc-900">{title}</p>
      {description && <p className="text-[12px] text-zinc-500 mt-1 max-w-sm mx-auto">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Badge({ children, color = 'zinc' }: { children: ReactNode; color?: 'zinc' | 'blue' | 'green' | 'amber' | 'rose' | 'violet' }) {
  const colors = {
    zinc:   'bg-zinc-100 text-zinc-700',
    blue:   'bg-blue-50 text-blue-700',
    green:  'bg-emerald-50 text-emerald-700',
    amber:  'bg-amber-50 text-amber-700',
    rose:   'bg-rose-50 text-rose-700',
    violet: 'bg-violet-50 text-violet-700',
  }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium ${colors[color]}`}>{children}</span>
}

/* ───── 체크박스 (테이블 다중선택용) ───── */
interface CheckboxProps {
  checked: boolean
  indeterminate?: boolean
  onChange: (next: boolean) => void
  ariaLabel?: string
  className?: string
}
export function Checkbox({ checked, indeterminate = false, onChange, ariaLabel, className = '' }: CheckboxProps) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked
  }, [indeterminate, checked])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      onClick={e => e.stopPropagation()}
      aria-label={ariaLabel}
      className={`w-4 h-4 rounded border-zinc-300 text-zinc-900 focus:ring-2 focus:ring-zinc-200 cursor-pointer accent-zinc-900 ${className}`}
    />
  )
}

/* ───── 다중선택 액션바 (상단 sticky) ───── */
export function BulkBar({ count, onClear, onDelete, label = '항목' }: {
  count: number
  onClear: () => void
  onDelete: () => void
  label?: string
}) {
  if (count === 0) return null
  return (
    <div className="sticky top-0 z-10 -mx-3 sm:-mx-4 px-3 sm:px-4 py-2 mb-3 bg-zinc-900 text-white flex items-center gap-2 rounded-lg shadow-sm">
      <span className="text-[12px] font-medium">
        {count}건 선택됨
      </span>
      <button
        onClick={onClear}
        className="text-[11px] text-zinc-300 hover:text-white underline-offset-2 hover:underline"
      >
        선택 해제
      </button>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium bg-rose-600 hover:bg-rose-700 rounded-md transition-colors"
          title={`선택한 ${label} 일괄 삭제`}
        >
          🗑️ 선택 삭제 ({count})
        </button>
      </div>
    </div>
  )
}
