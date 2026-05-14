import { supabase } from './supabase'
import { getCurrentUser } from '@/components/PinGate'

/* ─────────────────────────────────────────────
 * 변경 이력 로그 — 위험·중요 작업 자동 기록
 * 어디서든 logAction(...) 한 줄로 기록 가능
 * 실패해도 메인 작업은 막지 않음 (silent)
 * ───────────────────────────────────────────── */

export type LogAction =
  | 'create'        // 새로 만듦
  | 'update'        // 수정
  | 'delete'        // 휴지통으로 (soft delete)
  | 'hard_delete'   // 영구 삭제 (휴지통 비우기)
  | 'restore'       // 복구
  | 'merge'         // 거래처 병합
  | 'import'        // 엑셀 일괄 등록
  | 'convert'       // 견적서 → 계산서, 입고 → 계산서 등
  | 'bulk_delete'   // 대량 삭제

export type EntityType =
  | 'vendor' | 'product' | 'invoice' | 'incoming' | 'quotation'
  | 'supplier_invoice' | 'cost_item' | 'fabric' | 'user'

export interface LogInput {
  action: LogAction
  entity_type: EntityType
  entity_id?: string | null
  entity_label?: string
  summary?: string
  details?: Record<string, any>
}

/**
 * 변경 이력 한 줄 기록. 실패해도 throw 안 함 (메인 작업 안 막음).
 */
export async function logAction(input: LogInput) {
  try {
    const me = getCurrentUser()
    await supabase.from('activity_logs').insert({
      actor_name: me?.name || null,
      actor_id: me?.id || null,
      action: input.action,
      entity_type: input.entity_type,
      entity_id: input.entity_id || null,
      entity_label: input.entity_label || null,
      summary: input.summary || null,
      details: input.details || null,
    })
  } catch (err) {
    // silent — 로그 실패는 사용자에게 보이지 않게
    console.warn('[activityLog] failed', err)
  }
}

export const ACTION_LABEL: Record<LogAction, string> = {
  create: '생성',
  update: '수정',
  delete: '삭제 (휴지통)',
  hard_delete: '영구 삭제',
  restore: '복구',
  merge: '병합',
  import: '엑셀 등록',
  convert: '변환',
  bulk_delete: '일괄 삭제',
}

export const ACTION_COLOR: Record<LogAction, 'zinc'|'blue'|'green'|'amber'|'rose'|'violet'> = {
  create: 'green',
  update: 'blue',
  delete: 'amber',
  hard_delete: 'rose',
  restore: 'green',
  merge: 'violet',
  import: 'blue',
  convert: 'violet',
  bulk_delete: 'rose',
}

export const ENTITY_LABEL: Record<EntityType, string> = {
  vendor: '거래처',
  product: '상품',
  invoice: '계산서',
  incoming: '입고내역서',
  quotation: '견적서',
  supplier_invoice: '공급처 계산서',
  cost_item: '원가 재료',
  fabric: '실 입고',
  user: '사용자',
}
