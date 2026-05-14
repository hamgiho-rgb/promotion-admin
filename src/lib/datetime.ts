/* ─────────────────────────────────────────────
 * 한국시간(KST, Asia/Seoul) 명시 처리 유틸
 *
 * 원칙:
 * - DB는 timestamptz(UTC)로 저장 (Supabase 기본)
 * - 화면 표시 + 사용자 입력 변환은 모두 한국시간 기준
 * - JavaScript의 toISOString()은 UTC라서 위험 → 절대 .slice(0,10)으로 날짜 뽑지 말 것
 * - 대신 toKRDate(date) 사용
 * ───────────────────────────────────────────── */

/** Date 객체 → "YYYY-MM-DD" 한국 날짜 (시스템 timezone 무관) */
export function toKRDate(d: Date): string {
  // Asia/Seoul 기준 ko-KR 포맷 → "2026. 5. 14." 같은 형태 → 분해해서 ISO 형태로
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d)
  const y = parts.find(p => p.type === 'year')!.value
  const m = parts.find(p => p.type === 'month')!.value
  const day = parts.find(p => p.type === 'day')!.value
  return `${y}-${m}-${day}`
}

/** 오늘의 한국 날짜 "YYYY-MM-DD" */
export function todayKR(): string {
  return toKRDate(new Date())
}

/** Date → "YYYY.MM" 한국 기준 (입고 period 형식) */
export function toKRPeriod(d: Date): string {
  const iso = toKRDate(d)
  return iso.slice(0, 7).replace('-', '.')
}

/** 이번 달 한국 기준 "YYYY-MM" */
export function thisMonthKR(): string {
  return todayKR().slice(0, 7)
}

/** Date → "YYYY-MM" 한국 기준 */
export function toKRMonth(d: Date): string {
  return toKRDate(d).slice(0, 7)
}

/** ISO 타임스탬프 또는 Date → 한국시간 표시 "2026-05-14 13:39" */
export function fmtKRDateTime(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d).replace(/\. /g, '-').replace(/\.$/, '').replace(' -', ' ')
}

/** ISO 타임스탬프 또는 Date → 한국 날짜 표시 "2026-05-14" */
export function fmtKRDate(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (isNaN(d.getTime())) return ''
  return toKRDate(d)
}

/** ISO 타임스탬프 → "2026년 5월 14일 (목)" 친근한 표시 */
export function fmtKRDateLong(value: string | Date | null | undefined): string {
  if (!value) return ''
  const d = typeof value === 'string' ? new Date(value) : value
  if (isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(d)
}

/** 지금 시점의 ISO 타임스탬프 (DB 저장용) — 그냥 toISOString() OK (UTC 저장) */
export function nowISO(): string {
  return new Date().toISOString()
}

/** N일 전 한국 날짜 "YYYY-MM-DD" */
export function daysAgoKR(n: number): string {
  const d = new Date(Date.now() - n * 24 * 60 * 60 * 1000)
  return toKRDate(d)
}

/** 한국 날짜 두 개 사이 일수 */
export function daysBetween(a: Date | string, b: Date | string): number {
  const da = typeof a === 'string' ? new Date(a) : a
  const db = typeof b === 'string' ? new Date(b) : b
  return Math.floor((db.getTime() - da.getTime()) / (24 * 60 * 60 * 1000))
}
