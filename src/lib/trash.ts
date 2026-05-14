import { supabase } from './supabase'

/* ─────────────────────────────────────────────
 * 휴지통(soft delete) 유틸
 * - softDelete: 진짜로 안 지우고 deleted_at 만 채움
 * - restore: deleted_at = null 로 복구
 * - hardDelete: 영구 삭제 (휴지통 안에서만)
 * - cleanupOldTrash: 30일 지난 휴지통 항목 자동 영구삭제
 * ───────────────────────────────────────────── */

export type TrashableTable = 'vendors' | 'products' | 'incoming' | 'invoices' | 'quotations' | 'supplier_invoices'

export const TRASH_RETENTION_DAYS = 30

/** 단일 행 soft delete */
export async function softDelete(table: TrashableTable, id: string) {
  return supabase.from(table).update({ deleted_at: new Date().toISOString() }).eq('id', id)
}

/** 여러 행 soft delete */
export async function softDeleteMany(table: TrashableTable, ids: string[]) {
  if (ids.length === 0) return { error: null }
  return supabase.from(table).update({ deleted_at: new Date().toISOString() }).in('id', ids)
}

/** 복구 */
export async function restore(table: TrashableTable, id: string) {
  return supabase.from(table).update({ deleted_at: null }).eq('id', id)
}

/** 여러 행 복구 */
export async function restoreMany(table: TrashableTable, ids: string[]) {
  if (ids.length === 0) return { error: null }
  return supabase.from(table).update({ deleted_at: null }).in('id', ids)
}

/** 영구 삭제 (한 행) */
export async function hardDelete(table: TrashableTable, id: string) {
  return supabase.from(table).delete().eq('id', id)
}

/** 영구 삭제 (여러 행) */
export async function hardDeleteMany(table: TrashableTable, ids: string[]) {
  if (ids.length === 0) return { error: null }
  return supabase.from(table).delete().in('id', ids)
}

/** 30일 지난 휴지통 항목 자동 영구삭제 — 페이지 진입 시 한 번 호출 */
export async function cleanupOldTrash(): Promise<{ table: TrashableTable; count: number }[]> {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const tables: TrashableTable[] = ['vendors', 'products', 'incoming', 'invoices', 'quotations', 'supplier_invoices']
  const results: { table: TrashableTable; count: number }[] = []
  for (const t of tables) {
    const { count } = await supabase.from(t).select('id', { count: 'exact', head: true }).lt('deleted_at', cutoff)
    if (count && count > 0) {
      await supabase.from(t).delete().lt('deleted_at', cutoff)
      results.push({ table: t, count })
    }
  }
  return results
}

/** 휴지통 통계 (각 테이블별 휴지통 건수) */
export async function getTrashCounts(): Promise<Record<TrashableTable, number>> {
  const tables: TrashableTable[] = ['vendors', 'products', 'incoming', 'invoices', 'quotations', 'supplier_invoices']
  const counts: Record<string, number> = {}
  await Promise.all(tables.map(async t => {
    const { count } = await supabase.from(t).select('id', { count: 'exact', head: true }).not('deleted_at', 'is', null)
    counts[t] = count || 0
  }))
  return counts as Record<TrashableTable, number>
}

/** 남은 보존 일수 계산 */
export function daysRemaining(deletedAt: string): number {
  const deleted = new Date(deletedAt).getTime()
  const expires = deleted + TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000
  const remaining = Math.ceil((expires - Date.now()) / (24 * 60 * 60 * 1000))
  return Math.max(0, remaining)
}

/** 테이블별 한글 라벨 */
export const TABLE_LABEL: Record<TrashableTable, string> = {
  vendors: '거래처',
  products: '상품',
  incoming: '입고내역서',
  invoices: '계산서',
  quotations: '견적서',
  supplier_invoices: '공급처 계산서',
}
