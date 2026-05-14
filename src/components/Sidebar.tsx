import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { lock, getCurrentUser } from '@/components/PinGate'

const SIDEBAR_COLLAPSE_KEY = 'sidebar_collapsed_sections'

function readCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(SIDEBAR_COLLAPSE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch { return new Set() }
}
function saveCollapsed(s: Set<string>) {
  try { localStorage.setItem(SIDEBAR_COLLAPSE_KEY, JSON.stringify(Array.from(s))) } catch {}
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const ICONS = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  customers: 'M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M12.5 7a4 4 0 11-8 0 4 4 0 018 0zM20 8v6M23 11h-6',
  suppliers: 'M3 21V8l9-5 9 5v13M9 21V12h6v9',
  products:  'M20 7L12 3 4 7v10l8 4 8-4V7zM12 22V12M4 7l8 5 8-5',
  cost:      'M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6',
  fabric:    'M3 3h18v18H3zM3 9h18M9 21V9',
  quotation: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M9 13h6M9 17h4',
  incoming:  'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12',
  invoices:  'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6M16 13H8M16 17H8M10 9H8',
  margin:    'M3 3v18h18M7 14l4-4 4 4 6-6',
  import:    'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  settings:  'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h0a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51h0a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v0a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z',
}

const menu = [
  { section: '메인', items: [
    { to: '/', label: '대시보드', icon: ICONS.dashboard },
  ]},
  { section: '거래처', items: [
    { to: '/customers', label: '고객 거래처', icon: ICONS.customers },
    { to: '/suppliers', label: '공급처',      icon: ICONS.suppliers },
  ]},
  { section: '상품 · 원가', items: [
    { to: '/products', label: '상품 관리',   icon: ICONS.products },
    { to: '/cost',     label: '원가계산서',  icon: ICONS.cost     },
    { to: '/fabric',   label: '실 입고 내역', icon: ICONS.fabric  },
  ]},
  { section: '영업 · 운영', items: [
    { to: '/quotations', label: '견적서',         icon: ICONS.quotation },
    { to: '/incoming',   label: '입고내역서',     icon: ICONS.incoming  },
    { to: '/invoices',   label: '계산서·영수증',  icon: ICONS.invoices  },
  ]},
  { section: '분석', items: [
    { to: '/margin',            label: '마진내역서',    icon: ICONS.margin },
    { to: '/payments',          label: '공급처 정산',   icon: ICONS.cost   },
    { to: '/supplier-invoices', label: '공급처 계산서', icon: ICONS.invoices },
  ]},
  { section: '도구', items: [
    { to: '/import', label: '엑셀 가져오기', icon: ICONS.import },
    { to: '/trash', label: '휴지통', icon: 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6M10 11v6M14 11v6' },
    { to: '/logs', label: '변경 이력', icon: 'M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    { to: '/settings', label: '사용자 · 설정', icon: ICONS.settings },
  ]},
]

export default function Sidebar({ onItemClick }: { onItemClick?: () => void }) {
  const me = getCurrentUser()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed())

  function toggleSection(name: string) {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name); else next.add(name)
      saveCollapsed(next)
      return next
    })
  }

  // 현재 경로가 어떤 섹션 안에 있는지 (그 섹션은 자동으로 펼침 유지)
  const activeSections = new Set(
    menu.filter(g => g.items.some(it => it.to === location.pathname || (it.to !== '/' && location.pathname.startsWith(it.to)))).map(g => g.section)
  )
  return (
    <aside className="w-[232px] h-full bg-white border-r border-zinc-200 flex flex-col">
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-zinc-900 flex items-center justify-center">
            <span className="text-white font-bold text-sm tracking-tight">AW</span>
          </div>
          <div>
            <h1 className="text-[15px] font-semibold text-zinc-900 tracking-tight leading-none">프로모션 어드민</h1>
            <p className="text-[11px] text-zinc-500 mt-1 leading-none">
              {me ? `${me.name} · ${me.role === 'admin' ? '관리자' : '직원'}` : '함기호 · 써치'}
            </p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 overflow-y-auto pb-4">
        {menu.map(group => {
          const isCollapsed = collapsed.has(group.section) && !activeSections.has(group.section)
          const hasOnlyOne = group.items.length === 1
          return (
            <div key={group.section} className="mb-1">
              <button
                onClick={() => toggleSection(group.section)}
                className="w-full px-3 pt-3 pb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-zinc-400 hover:text-zinc-700 transition-colors"
              >
                <span>{group.section}</span>
                {!hasOnlyOne && (
                  <span className="text-zinc-300 text-[10px]">{isCollapsed ? '▶' : '▼'}</span>
                )}
              </button>
              {!isCollapsed && (
                <div className="space-y-0.5">
                  {group.items.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === '/'}
                      onClick={onItemClick}
                      className={({ isActive }) =>
                        `flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-colors ${
                          isActive
                            ? 'bg-zinc-900 text-white'
                            : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 active:bg-zinc-200'
                        }`
                      }
                    >
                      <Icon d={item.icon} />
                      <span>{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      <div className="px-3 py-3 border-t border-zinc-100 space-y-2">
        <button
          onClick={() => { if (confirm('잠그시겠어요? 다음에 PIN을 다시 입력해야 합니다.')) lock() }}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <span>잠금</span>
        </button>
        <div className="flex items-center gap-2 px-3 text-[11px] text-zinc-400">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
          <span>실시간 동기화 중</span>
        </div>
      </div>
    </aside>
  )
}
