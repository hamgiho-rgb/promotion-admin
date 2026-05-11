import { useMemo, useState } from 'react'

/**
 * 테이블 다중선택 hook
 * - selected: 선택된 ID Set
 * - toggle(id): 단건 토글
 * - toggleAll(ids): 모든 항목 토글 (전체 선택/해제)
 * - allSelected: 현재 ids가 전부 선택됐는지
 * - someSelected: 일부만 선택됐는지 (indeterminate용)
 * - clear: 선택 초기화
 * - count: 선택 개수
 */
export function useBulkSelect() {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const api = useMemo(() => ({
    selected,
    has: (id: string) => selected.has(id),
    toggle(id: string) {
      setSelected(prev => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    },
    setAll(ids: string[]) {
      setSelected(new Set(ids))
    },
    toggleAll(ids: string[]) {
      setSelected(prev => {
        const allOn = ids.length > 0 && ids.every(id => prev.has(id))
        if (allOn) {
          // 전부 켜져있으면 → 전체 해제 (단, 화면 밖 선택은 유지)
          const next = new Set(prev)
          ids.forEach(id => next.delete(id))
          return next
        }
        // 일부/전부 꺼져있으면 → 전체 켜기
        const next = new Set(prev)
        ids.forEach(id => next.add(id))
        return next
      })
    },
    clear() { setSelected(new Set()) },
    count: selected.size,
  }), [selected])

  return api
}
