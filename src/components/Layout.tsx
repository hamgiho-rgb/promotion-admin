import { ReactNode, useState, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'

export default function Layout({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const location = useLocation()

  // 페이지 이동 시 모바일 메뉴 자동 닫기
  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  return (
    <div className="flex h-screen bg-zinc-50">
      {/* 데스크탑 사이드바 (lg 이상에서만) */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* 모바일 슬라이드 사이드바 */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          <div
            className="flex-1 bg-zinc-900/40 backdrop-blur-[2px]"
            onClick={() => setMobileOpen(false)}
          />
          <div className="w-[280px] h-full bg-white shadow-2xl animate-slide-in-left">
            <Sidebar onItemClick={() => setMobileOpen(false)} />
          </div>
          <style>{`
            @keyframes slide-in-left { from { transform: translateX(-100%); } to { transform: translateX(0); } }
            .animate-slide-in-left { animation: slide-in-left 0.2s ease-out; }
          `}</style>
        </div>
      )}

      <main className="flex-1 overflow-y-auto flex flex-col">
        {/* 모바일 상단 헤더 (lg 미만에서만) */}
        <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-zinc-200 flex items-center px-3 py-2.5 gap-3">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-zinc-100 active:bg-zinc-200"
            aria-label="메뉴 열기"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-zinc-900 flex items-center justify-center">
              <span className="text-white font-bold text-xs">AW</span>
            </div>
            <span className="text-[14px] font-semibold text-zinc-900">프로모션 어드민</span>
          </div>
        </header>

        <div className="px-4 sm:px-6 lg:px-10 py-5 lg:py-8 max-w-[1400px] mx-auto w-full">
          {children}
        </div>
      </main>
    </div>
  )
}
