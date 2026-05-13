import { supabase } from './supabase'
import { exportMultiSheet, rowsToSheet } from './exportXlsx'

/* ─────────────────────────────────────────────
 * 전체 데이터 백업 → 엑셀 1개 파일에 시트 여러 개로 저장
 * 매월/매분기 한 번씩 받아두면 회계·세무용 + 실수 복구용
 * ───────────────────────────────────────────── */

export interface BackupOptions {
  year?: number | null  // null = 전체, 숫자 = 그 해 issue_date/period 만
  onProgress?: (msg: string) => void
}

export async function downloadFullBackup(opts: BackupOptions = {}): Promise<{ ok: boolean; error?: string }> {
  const p = (msg: string) => opts.onProgress?.(msg)
  try {
    p('거래처 불러오는 중…')
    const { data: vendors } = await supabase.from('vendors').select('*').order('vendor_type').order('name')

    p('상품 불러오는 중…')
    const { data: products } = await supabase.from('products').select('*').order('vendor_id').order('code')

    p('원가 계산 항목 불러오는 중…')
    const { data: costItems } = await supabase.from('cost_items').select('*').order('product_id')

    // 연도 필터 적용
    const yearStr = opts.year ? String(opts.year) : null
    const yearMatch = (d: string | null | undefined) => !yearStr || (d && String(d).startsWith(yearStr))
    const periodMatch = (period: string | null | undefined) => !yearStr || (period && String(period).startsWith(yearStr))

    p('견적서 불러오는 중…')
    let { data: quotations } = await supabase.from('quotations').select('*').order('issue_date', { ascending: false })
    quotations = (quotations ?? []).filter((q: any) => yearMatch(q.issue_date))
    const qIds = quotations.map((q: any) => q.id)
    const { data: qItems } = qIds.length
      ? await supabase.from('quotation_items').select('*').in('quotation_id', qIds).order('sort_order')
      : { data: [] }

    p('계산서 불러오는 중…')
    let { data: invoices } = await supabase.from('invoices').select('*').order('issue_date', { ascending: false })
    invoices = (invoices ?? []).filter((i: any) => yearMatch(i.issue_date))
    const iIds = invoices.map((i: any) => i.id)
    const { data: invItems } = iIds.length
      ? await supabase.from('invoice_items').select('*').in('invoice_id', iIds).order('sort_order')
      : { data: [] }

    p('입고내역서 불러오는 중…')
    let { data: incomings } = await supabase.from('incoming').select('*').order('created_at', { ascending: false })
    incomings = (incomings ?? []).filter((i: any) => periodMatch(i.period))
    const inIds = incomings.map((i: any) => i.id)
    const { data: incItems } = inIds.length
      ? await supabase.from('incoming_items').select('*').in('incoming_id', inIds)
      : { data: [] }

    p('공급처 계산서 불러오는 중…')
    let { data: supInvs } = await supabase.from('supplier_invoices').select('*').order('period', { ascending: false })
    supInvs = (supInvs ?? []).filter((s: any) => periodMatch(s.period))
    const sIds = supInvs.map((s: any) => s.id)
    const { data: supItems } = sIds.length
      ? await supabase.from('supplier_invoice_items').select('*').in('invoice_id', sIds).order('sort_order')
      : { data: [] }

    // 거래처 이름 매핑
    const vMap = new Map<string, string>()
    ;(vendors ?? []).forEach((v: any) => vMap.set(v.id, v.name))
    const vName = (id: string | null) => (id && vMap.get(id)) || ''

    // 상품 이름 매핑
    const prodMap = new Map<string, any>()
    ;(products ?? []).forEach((p: any) => prodMap.set(p.id, p))
    const pName = (id: string | null) => (id && prodMap.get(id)?.name) || ''

    p('엑셀 파일 만드는 중…')

    // 각 테이블을 시트로 변환
    const sheets = [
      {
        name: '거래처',
        rows: rowsToSheet(vendors ?? [], [
          { key: 'vendor_type', label: '구분', format: (v: string) => v === 'customer' ? '고객' : '공급처' },
          { key: 'name', label: '이름' },
          { key: 'company_name', label: '회사명' },
          { key: 'business_number', label: '사업자번호' },
          { key: 'ceo_name', label: '대표자' },
          { key: 'phone', label: '전화' },
          { key: 'email', label: '이메일' },
          { key: 'address', label: '주소' },
          { key: 'bank_info', label: '계좌정보' },
          { key: 'memo', label: '메모' },
        ]),
      },
      {
        name: '상품',
        rows: rowsToSheet(products ?? [], [
          { key: 'vendor_id', label: '거래처', format: (id: string) => vName(id) },
          { key: 'code', label: '품번' },
          { key: 'name', label: '품목명' },
          { key: 'name_en', label: '영문명' },
          { key: 'brand', label: '브랜드' },
          { key: 'color', label: '컬러' },
          { key: 'selling_price', label: '판매가' },
          { key: 'notes', label: '메모' },
        ]),
      },
      {
        name: '원가계산',
        rows: rowsToSheet(costItems ?? [], [
          { key: 'product_id', label: '상품', format: (id: string) => pName(id) },
          { key: 'supplier_id', label: '공급처', format: (id: string) => vName(id) },
          { key: 'item_name', label: '재료/공정명' },
          { key: 'unit_price', label: '단가' },
          { key: 'yards', label: '요척' },
          { key: 'subtotal', label: '소계' },
        ]),
      },
      {
        name: '견적서',
        rows: rowsToSheet(quotations ?? [], [
          { key: 'issue_date', label: '발행일' },
          { key: 'vendor_id', label: '거래처', format: (id: string) => vName(id) },
          { key: 'status', label: '상태' },
          { key: 'subtotal', label: '공급가' },
          { key: 'vat', label: '부가세' },
          { key: 'total', label: '합계' },
          { key: 'deposit_rate', label: '계약금%' },
          { key: 'deposit_amount', label: '계약금액' },
          { key: 'deposit_received', label: '계약금수령', format: (v: boolean) => v ? 'O' : '-' },
          { key: 'notes', label: '메모' },
        ]),
      },
      {
        name: '견적서_상세',
        rows: rowsToSheet(qItems ?? [], [
          { key: 'quotation_id', label: '견적서ID' },
          { key: 'product_name', label: '품목' },
          { key: 'color', label: '컬러' },
          { key: 'size_info', label: '사이즈' },
          { key: 'quantity', label: '수량' },
          { key: 'unit_price', label: '단가' },
          { key: 'amount', label: '금액' },
        ]),
      },
      {
        name: '계산서',
        rows: rowsToSheet(invoices ?? [], [
          { key: 'issue_date', label: '발행일' },
          { key: 'vendor_id', label: '거래처', format: (id: string) => vName(id) },
          { key: 'subtotal', label: '공급가' },
          { key: 'vat', label: '부가세' },
          { key: 'total', label: '합계' },
          { key: 'deposit_amount', label: '선납액' },
          { key: 'quotation_id', label: '연결견적서ID' },
          { key: 'notes', label: '메모' },
        ]),
      },
      {
        name: '계산서_상세',
        rows: rowsToSheet(invItems ?? [], [
          { key: 'invoice_id', label: '계산서ID' },
          { key: 'line_date', label: '거래일' },
          { key: 'product_name', label: '품목' },
          { key: 'color', label: '컬러' },
          { key: 'quantity', label: '수량' },
          { key: 'unit_price', label: '단가' },
          { key: 'amount', label: '금액' },
        ]),
      },
      {
        name: '입고내역서',
        rows: rowsToSheet(incomings ?? [], [
          { key: 'period', label: '기간' },
          { key: 'vendor_id', label: '거래처', format: (id: string) => vName(id) },
          { key: 'producer', label: '생산자' },
          { key: 'brand', label: '브랜드' },
          { key: 'notes', label: '메모' },
        ]),
      },
      {
        name: '입고_상세',
        rows: rowsToSheet(incItems ?? [], [
          { key: 'incoming_id', label: '입고ID' },
          { key: 'delivery_date', label: '납기' },
          { key: 'carton_no', label: 'C/T' },
          { key: 'product_code', label: '품번' },
          { key: 'product_name', label: '품목' },
          { key: 'sizes', label: '사이즈별', format: (v: any) => v ? Object.entries(v).map(([k, n]) => `${k}:${n}`).join(', ') : '' },
          { key: 'total_quantity', label: '합계' },
        ]),
      },
      {
        name: '공급처계산서',
        rows: rowsToSheet(supInvs ?? [], [
          { key: 'period', label: '기간' },
          { key: 'supplier_id', label: '공급처', format: (id: string) => vName(id) },
          { key: 'issue_date', label: '발행일' },
          { key: 'subtotal', label: '공급가' },
          { key: 'vat', label: '부가세' },
          { key: 'total', label: '합계' },
          { key: 'notes', label: '메모' },
        ]),
      },
      {
        name: '공급처계산서_상세',
        rows: rowsToSheet(supItems ?? [], [
          { key: 'invoice_id', label: '계산서ID' },
          { key: 'line_date', label: '날짜' },
          { key: 'product_name', label: '품목' },
          { key: 'brand', label: '상호' },
          { key: 'quantity', label: '수량' },
          { key: 'unit_price', label: '단가' },
          { key: 'amount', label: '금액' },
        ]),
      },
    ]

    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const tag = opts.year ? `${opts.year}년` : '전체'
    exportMultiSheet(sheets, `프로모션어드민_백업_${tag}_${stamp}`)

    p('완료!')
    return { ok: true }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }
}
