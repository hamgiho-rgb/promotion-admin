import { useEffect, useState } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import type { Vendor, Product, Incoming, IncomingItem } from '@/lib/types'
import { Button, Input, Select, Label, PageHeader, Drawer, Empty, Badge, Textarea, Checkbox, BulkBar } from '@/components/ui'
import { exportMultiSheet, rowsToSheet, exportIncomingFull } from '@/lib/exportXlsx'
import { useBulkSelect } from '@/hooks/useBulkSelect'
import { softDelete, softDeleteMany } from '@/lib/trash'
import { todayKR } from '@/lib/datetime'
import { logAction } from '@/lib/activityLog'
import IncomingImportButton from '@/components/IncomingImportButton'

/* ───── 입고내역서별 집계 ───── */
interface IncomingStats {
 totalQuantity: number
 cartons: number
 productCount: number
 deliveryDates: string[]   // 이 입고에 들어있는 모든 납기일 (정렬, 중복 제거)
 sizeBreakdown: Record<string, number>  // 사이즈별 합계 — 펼침 표시용
}

/** 합계/소계 또는 노트성 행 판별 — DB에 들어가 있어도 통계·계산서 변환에서 자동 제외 */
const SUMMARY_PATTERN = /^(합\s*계|소\s*계|총\s*계|계|total|sum)$/i
const NOTE_PATTERN = /(위\s*품목|상기\s*품목|이상.*(출고|입고).*함|위\s*내역)/i
function isSummaryItem(it: { product_code?: string | null; product_name?: string | null }) {
 const code = (it.product_code || '').toString().trim()
 const name = (it.product_name || '').toString().trim()
 if (SUMMARY_PATTERN.test(code) || SUMMARY_PATTERN.test(name)) return true
 if (NOTE_PATTERN.test(code) || NOTE_PATTERN.test(name)) return true
 return false
}

export default function IncomingPage() {
 const navigate = useNavigate()
 const [searchParams] = useSearchParams()
 const [vendors, setVendors] = useState<Vendor[]>([])
 const [list, setList] = useState<Incoming[]>([])
 const [issuedMap, setIssuedMap] = useState<Map<string, string>>(new Map()) // incoming_id -> invoice_id
 const [statsMap, setStatsMap] = useState<Map<string, IncomingStats>>(new Map())
 const [loading, setLoading] = useState(true)
 const [vendorFilter, setVendorFilter] = useState<string>('all')
 // URL ?month=YYYY.MM 또는 YYYY-MM 둘 다 허용 (대시보드 카드에서 넘어올 때)
 const urlMonthRaw = searchParams.get('month')
 const urlMonth = urlMonthRaw ? urlMonthRaw.replace('-', '.') : null
 // 기본 "전체 기간" — 5월/6월 등 여러 달 한 번에 보이게. URL 파라미터 있으면 그쪽 우선.
 const [monthFilter, setMonthFilter] = useState<string>(urlMonth ?? 'all')
 const [search, setSearch] = useState('')
 const [drawerOpen, setDrawerOpen] = useState(false)
 const [editing, setEditing] = useState<Incoming | null>(null)
 const bulk = useBulkSelect()

 async function load() {
 setLoading(true)
 const [{ data: vData }, { data: iData }, { data: invs }] = await Promise.all([
 supabase.from('vendors').select('*').eq('vendor_type', 'customer').order('name'),
 supabase.from('incoming').select('*').is('deleted_at', null).order('created_at', { ascending: false }),
 supabase.from('invoices').select('id, incoming_id').is('deleted_at', null).not('incoming_id', 'is', null),
 ])
 setVendors(vData ?? [])
 setList(iData ?? [])
 // 입고 → 계산서 발행 추적
 const im = new Map<string, string>()
 ;(invs ?? []).forEach((iv: any) => { if (iv.incoming_id) im.set(iv.incoming_id, iv.id) })
 setIssuedMap(im)

 if (iData && iData.length > 0) {
 const ids = iData.map(i => i.id)
 const { data: items } = await supabase
 .from('incoming_items')
 .select('incoming_id, total_quantity, product_id, product_code, product_name, delivery_date, sizes')
 .in('incoming_id', ids)

 const map = new Map<string, IncomingStats & { productSet: Set<string>; dateSet: Set<string> }>()
 ;(items ?? []).forEach(it => {
 if (isSummaryItem(it)) return  // 합계/노트 행 제외 — 통계 두 배 방지
 if (!map.has(it.incoming_id)) {
 map.set(it.incoming_id, { totalQuantity: 0, cartons: 0, productCount: 0, deliveryDates: [], sizeBreakdown: {}, productSet: new Set(), dateSet: new Set() })
 }
 const s = map.get(it.incoming_id)!
 s.totalQuantity += Number(it.total_quantity || 0)
 s.cartons += 1
 if (it.product_id) s.productSet.add(it.product_id)
 if (it.delivery_date) s.dateSet.add(it.delivery_date)
 // 사이즈별 합계
 const sizes = (it as any).sizes || {}
 Object.entries(sizes).forEach(([sz, n]) => {
   const num = Number(n) || 0
   if (num > 0) s.sizeBreakdown[sz] = (s.sizeBreakdown[sz] || 0) + num
 })
 })
 const cleanMap = new Map<string, IncomingStats>()
 map.forEach((v, k) => cleanMap.set(k, {
 totalQuantity: v.totalQuantity,
 cartons: v.cartons,
 productCount: v.productSet.size,
 deliveryDates: Array.from(v.dateSet).sort(),
 sizeBreakdown: v.sizeBreakdown,
 }))
 setStatsMap(cleanMap)
 } else {
 setStatsMap(new Map())
 }

 setLoading(false)
 }

 useEffect(() => { load() }, [])

 async function handleDelete(i: Incoming) {
 if (!confirm('이 입고내역서를 휴지통으로 옮길까요?\n30일 안에 복구 가능.')) return
 const { error } = await softDelete('incoming', i.id)
 if (error) return alert('삭제 실패: ' + error.message)
 load()
 }

 async function handleBulkDelete() {
   const ids = Array.from(bulk.selected)
   if (ids.length === 0) return
   if (!confirm(`선택한 ${ids.length}건의 입고내역서를 휴지통으로 옮길까요?\n30일 안에 복구 가능.`)) return
   const { error } = await softDeleteMany('incoming', ids)
   if (error) return alert('삭제 실패: ' + error.message)
   bulk.clear()
   load()
 }

 /** 단일 입고내역서를 엑셀로 다운로드 — 출력 양식과 동일 */
 async function exportOneIncoming(inc: Incoming) {
   const { data: items } = await supabase.from('incoming_items').select('*')
     .eq('incoming_id', inc.id).order('delivery_date').order('carton_no')
   const vendor = vendors.find(v => v.id === inc.vendor_id)
   const sizeLabels = ((vendor as any)?.size_system as string[] | undefined) || []
   exportIncomingFull({
     vendor_name: vendorName(inc.vendor_id),
     period: inc.period,
     producer: (inc as any).producer,
     brand: inc.brand,
     size_labels: sizeLabels,
     lines: (items || []).map((it: any) => ({
       product_code: it.product_code,
       product_name: it.product_name,
       sizes: it.sizes,
       total_quantity: it.total_quantity,
       delivery_date: it.delivery_date,
       carton_no: it.carton_no,
     })),
   })
 }

 /**
  * 선택한 여러 입고를 한 계산서로 통합 발행
  * - 같은 거래처여야 함
  * - 모든 입고의 라인을 (상품 × 컬러)별로 합쳐서 한 계산서에 넣음
  * - 사이즈는 sizes JSON에 누적
  * - 단가는 products.selling_price 자동 매칭
  */
 async function convertManyToInvoice() {
   const ids = Array.from(bulk.selected)
   if (ids.length === 0) return
   const selectedIncs = list.filter(i => ids.includes(i.id))
   // 거래처 동일 검사
   const vendorIds = Array.from(new Set(selectedIncs.map(i => i.vendor_id)))
   if (vendorIds.length > 1) {
     alert('통합 발행은 같은 거래처끼리만 가능합니다.\n선택한 입고들의 거래처가 서로 달라요.')
     return
   }
   const vendorId = vendorIds[0]
   const vendor = vendors.find(v => v.id === vendorId)
   const periodsStr = selectedIncs.map(i => i.period || '?').join(' + ')

   // 모든 라인 로드
   const { data: rawItems } = await supabase.from('incoming_items').select('*').in('incoming_id', ids)
   const items = (rawItems ?? []).filter(it => !isSummaryItem(it))
   if (items.length === 0) return alert('통합할 입고 라인이 없어요.')

   // 카탈로그
   const { data: prods } = await supabase.from('products').select('id, code, name, selling_price, color')
     .eq('vendor_id', vendorId).is('deleted_at', null)
   const byId = new Map<string, any>()
   const byCode = new Map<string, any>()
   const byName = new Map<string, any>()
   ;(prods ?? []).forEach((p: any) => {
     byId.set(p.id, p)
     if (p.code) byCode.set(String(p.code).trim().toLowerCase(), p)
     if (p.name) byName.set(String(p.name).trim().toLowerCase(), p)
   })

   // (상품 × 컬러)별 합치기 + 사이즈 누적
   const lineMap = new Map<string, any>()
   items.forEach((it: any) => {
     const pKey = it.product_id || it.product_code || it.product_name || 'unknown'
     let prod = it.product_id ? byId.get(it.product_id) : null
     if (!prod) {
       const codeKey = (it.product_code || '').toString().trim().toLowerCase()
       const nameKey = (it.product_name || '').toString().trim().toLowerCase()
       prod = (codeKey && byCode.get(codeKey)) || (nameKey && byName.get(nameKey)) || null
     }
     const colorKey = prod?.color || ''
     const k = `${pKey}__${colorKey}`
     const existing = lineMap.get(k)
     const sizes = it.sizes || {}
     if (existing) {
       Object.entries(sizes).forEach(([sz, n]) => {
         const num = Number(n) || 0
         if (num > 0) existing.sizes[sz] = (existing.sizes[sz] || 0) + num
       })
       existing.quantity += Number(it.total_quantity || 0)
     } else {
       const newSizes: Record<string, number> = {}
       Object.entries(sizes).forEach(([sz, n]) => {
         const num = Number(n) || 0
         if (num > 0) newSizes[sz] = num
       })
       lineMap.set(k, {
         line_date: null,
         product_id: prod?.id || it.product_id || null,
         product_name: prod?.name || it.product_name || it.product_code || '',
         color: prod?.color || null,
         size: null,
         sizes: newSizes,
         quantity: Number(it.total_quantity || 0),
         unit_price: Number(prod?.selling_price ?? 0),
       })
     }
   })
   const lines = Array.from(lineMap.values()).sort((a, b) =>
     (a.product_name || '').localeCompare(b.product_name || '') ||
     (a.color || '').localeCompare(b.color || '')
   )
   const subtotal = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0)
   const vat = Math.round(subtotal * 0.1)
   const total = subtotal + vat
   const noPriceCount = lines.filter(l => !l.unit_price).length

   const msg =
     `📋 ${selectedIncs.length}개 입고 통합 발행\n` +
     `거래처: ${vendor?.name || '—'}\n` +
     `기간: ${periodsStr}\n` +
     `라인: ${lines.length}개 (총 ${lines.reduce((s, l) => s + l.quantity, 0).toLocaleString()}장)\n` +
     `금액: ₩${total.toLocaleString()}\n` +
     (noPriceCount > 0 ? `⚠ 단가 미매칭 ${noPriceCount}건\n` : '') +
     `\n한 계산서로 발행할까요?`
   if (!confirm(msg)) return

   const headerPayload = {
     vendor_id: vendorId,
     issue_date: todayKR(),
     supplier_business_number: '216-21-18212',
     supplier_name: '써치(SEARCH)',
     supplier_ceo: '함기호',
     supplier_address: '서울시 동대문구 안암로 16길 4, 2층',
     bank_info: '함기호(써치) 국민은행 038737-04-002188',
     subtotal, vat, total,
     incoming_id: selectedIncs[0].id,   // 대표 입고 (첫 번째)
     deposit_amount: 0,
     notes: `통합 발행: ${periodsStr} (${selectedIncs.length}개 입고 합산)`,
   }
   const { data: created, error } = await supabase.from('invoices').insert(headerPayload).select().single()
   if (error) { alert('계산서 생성 실패: ' + error.message); return }
   const linePayload = lines.map((l, idx) => ({ invoice_id: created.id, ...l, sort_order: idx }))
   await supabase.from('invoice_items').insert(linePayload)

   logAction({
     action: 'convert',
     entity_type: 'invoice',
     entity_id: created.id,
     entity_label: `${vendor?.name || '—'} ${periodsStr}`,
     summary: `입고 통합 → 계산서 발행 (${selectedIncs.length}개 입고 / ${lines.length}개 라인 · ₩${total.toLocaleString()})`,
     details: { from_incoming_ids: ids, to_invoice_id: created.id, total },
   })

   bulk.clear()
   if (confirm(`✅ 발행 완료 — 계산서 편집 화면으로 이동할까요?`)) {
     navigate(`/invoices?edit=${created.id}`)
   } else {
     load()
   }
 }

 /** 입고 → 계산서 자동 발행 (증분 모드).
  *  - 단가는 products.selling_price 자동 매칭 (없으면 vendor 안에서 코드/이름 fallback)
  *  - 라인은 (납기일 × 상품) 단위로 묶어서 정리
  *  - 이미 이 입고에서 발행된 계산서가 있으면 → 그 라인들 빼고 신규만 발행 (중복 방지)
  */
 async function convertToInvoice(inc: Incoming) {
   const { data: rawItems } = await supabase.from('incoming_items').select('*').eq('incoming_id', inc.id)
   // 합계/소계 행은 안전망 필터 — DB 정리 안 됐어도 계산서로 안 넘어감
   const items = (rawItems ?? []).filter(it => !isSummaryItem(it))
   if (items.length === 0) return alert('입고 라인이 없어요.')

   // ① 이 입고에서 이미 발행된 계산서들의 라인을 모두 모아서 "이미 발행된 키" 집합 만들기
   //    키 = `${product}__${color}` — 같은 상품+컬러는 한 라인 (사이즈는 같은 라인의 sizes에 합쳐짐)
   const { data: existingInvs } = await supabase
     .from('invoices').select('id').eq('incoming_id', inc.id).is('deleted_at', null)
   const existingInvIds = (existingInvs ?? []).map((x: any) => x.id)
   const alreadyKeys = new Set<string>()
   if (existingInvIds.length > 0) {
     const { data: existingItems } = await supabase
       .from('invoice_items').select('product_id, product_name, color').in('invoice_id', existingInvIds)
     ;(existingItems ?? []).forEach((it: any) => {
       const k = `${it.product_id || it.product_name || ''}__${it.color || ''}`
       alreadyKeys.add(k)
     })
   }

   // ② 거래처의 상품 카탈로그 (단가 매칭용)
   const { data: prods } = await supabase.from('products').select('id, code, name, selling_price, color')
     .eq('vendor_id', inc.vendor_id).is('deleted_at', null)
   const byId = new Map<string, any>()
   const byCode = new Map<string, any>()
   const byName = new Map<string, any>()
   ;(prods ?? []).forEach((p: any) => {
     byId.set(p.id, p)
     if (p.code) byCode.set(String(p.code).trim().toLowerCase(), p)
     if (p.name) byName.set(String(p.name).trim().toLowerCase(), p)
   })

   // period에서 fallback 날짜 (delivery_date 빈 라인을 위해)
   let fallbackDate = todayKR()
   if (inc.period) {
     const m = String(inc.period).match(/(\d{4})[.\-/](\d{1,2})/)
     if (m) fallbackDate = `${m[1]}-${m[2].padStart(2, '0')}-01`
   }

   // ③ 라인 변환 — (상품 × 컬러) 별로 합치고 사이즈는 sizes JSON에 누적
   //    날짜는 제거 (계산서는 입고일자 무시, 한 줄에 사이즈 분포)
   const lineMap = new Map<string, any>()
   items.forEach((it: any) => {
     const pKey = it.product_id || it.product_code || it.product_name || 'unknown'
     let prod = it.product_id ? byId.get(it.product_id) : null
     if (!prod) {
       const codeKey = (it.product_code || '').toString().trim().toLowerCase()
       const nameKey = (it.product_name || '').toString().trim().toLowerCase()
       prod = (codeKey && byCode.get(codeKey)) || (nameKey && byName.get(nameKey)) || null
     }
     const colorKey = prod?.color || ''
     const k = `${pKey}__${colorKey}`

     const existing = lineMap.get(k)
     if (existing) {
       // 같은 (상품 × 컬러) — sizes에 누적
       const sizes = it.sizes || {}
       Object.entries(sizes).forEach(([sz, n]) => {
         const num = Number(n) || 0
         if (num > 0) existing.sizes[sz] = (existing.sizes[sz] || 0) + num
       })
       existing.quantity += Number(it.total_quantity || 0)
     } else {
       // 새 라인
       const newSizes: Record<string, number> = {}
       const sourceSizes = it.sizes || {}
       Object.entries(sourceSizes).forEach(([sz, n]) => {
         const num = Number(n) || 0
         if (num > 0) newSizes[sz] = num
       })
       lineMap.set(k, {
         line_date: null,
         product_id: prod?.id || it.product_id || null,
         product_name: prod?.name || it.product_name || it.product_code || '',
         color: prod?.color || null,
         size: null,
         sizes: newSizes,
         quantity: Number(it.total_quantity || 0),
         unit_price: Number(prod?.selling_price ?? 0),
       })
     }
   })
   const allLines = Array.from(lineMap.values()).sort((a, b) =>
     (a.product_name || '').localeCompare(b.product_name || '') ||
     (a.color || '').localeCompare(b.color || '')
   )

   // ④ 이미 발행된 라인 제외 → 신규만 남김
   const newLines = allLines.filter(l => {
     const k = `${l.product_id || l.product_name}__${l.color || ''}`
     return !alreadyKeys.has(k)
   })
   const skippedCount = allLines.length - newLines.length

   if (newLines.length === 0) {
     return alert(
       `발행할 새 라인이 없어요.\n\n이 입고의 ${allLines.length}개 라인 모두 이미 계산서에 포함되어 있습니다.`
       + (existingInvIds.length > 0 ? `\n(${existingInvIds.length}건의 계산서로 이미 발행됨)` : '')
     )
   }

   // ⑤ 사용자 확인 — 신규 라인 수 + 건너뛴 라인 수 안내
   const subtotal = newLines.reduce((s, l) => s + l.quantity * l.unit_price, 0)
   const vat = Math.round(subtotal * 0.1)
   const total = subtotal + vat
   const noPriceCount = newLines.filter(l => !l.unit_price).length
   const confirmMsg =
     (skippedCount > 0
       ? `⚙ 증분 발행 모드\n이미 발행된 ${skippedCount}개 라인은 제외하고, 새 ${newLines.length}개 라인만 발행합니다.\n\n`
       : `${newLines.length}개 라인을 새 계산서로 발행합니다.\n\n`)
     + `금액: ₩${total.toLocaleString()}\n`
     + (noPriceCount > 0 ? `⚠ 단가 미매칭 ${noPriceCount}건 (계산서에서 직접 수정 필요)\n\n` : '\n')
     + `발행할까요?`
   if (!confirm(confirmMsg)) return

   const headerPayload = {
     vendor_id: inc.vendor_id,
     issue_date: todayKR(),
     supplier_business_number: '216-21-18212',
     supplier_name: '써치(SEARCH)',
     supplier_ceo: '함기호',
     supplier_address: '서울시 동대문구 안암로 16길 4, 2층',
     bank_info: '함기호(써치) 국민은행 038737-04-002188',
     subtotal, vat, total,
     incoming_id: inc.id,
     deposit_amount: 0,
     notes: `입고 ${inc.period || ''}에서 자동 발행됨${skippedCount > 0 ? ` (증분 ${newLines.length}/${allLines.length})` : ''}`,
   }
   const { data: created, error } = await supabase.from('invoices').insert(headerPayload).select().single()
   if (error) { alert('계산서 생성 실패: ' + error.message); return }

   const linePayload = newLines.map((l, idx) => ({ invoice_id: created.id, ...l, sort_order: idx }))
   await supabase.from('invoice_items').insert(linePayload)

   logAction({
     action: 'convert',
     entity_type: 'invoice',
     entity_id: created.id,
     entity_label: `${vendorName(inc.vendor_id)} ${inc.period || ''}`,
     summary: skippedCount > 0
       ? `입고 → 계산서 증분 발행 (신규 ${newLines.length} / 스킵 ${skippedCount}) ₩${total.toLocaleString()}`
       : `입고 → 계산서 발행 (${newLines.length}개 라인 · ₩${total.toLocaleString()})`,
     details: { from_incoming_id: inc.id, to_invoice_id: created.id, new_lines: newLines.length, skipped: skippedCount, total },
   })

   if (confirm(`✅ 발행 완료 — 계산서 편집 화면으로 이동할까요?`)) {
     navigate(`/invoices?edit=${created.id}`)
   } else {
     load()
   }
 }

 function vendorName(id: string) {
 return vendors.find(v => v.id === id)?.name || '—'
 }

 const allMonths = Array.from(new Set(list.map(i => i.period).filter(Boolean))).sort((a, b) => (b! > a! ? 1 : -1)) as string[]
 const filtered = list.filter(i => {
   if (vendorFilter !== 'all' && i.vendor_id !== vendorFilter) return false
   if (monthFilter !== 'all' && i.period !== monthFilter) return false
   if (search.trim()) {
     const s = search.trim().toLowerCase()
     const vName = vendorName(i.vendor_id).toLowerCase()
     const notes = (i.notes || '').toLowerCase()
     const brand = (i.brand || '').toLowerCase()
     const period = (i.period || '').toLowerCase()
     if (!vName.includes(s) && !notes.includes(s) && !brand.includes(s) && !period.includes(s)) return false
   }
   return true
 })
 const totalQty = filtered.reduce((s, i) => s + (statsMap.get(i.id)?.totalQuantity || 0), 0)
 const totalCartons = filtered.reduce((s, i) => s + (statsMap.get(i.id)?.cartons || 0), 0)

 const now = new Date()
 const thisMonth = `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}`
 const thisMonthList = filtered.filter(i => i.period === thisMonth)
 const thisMonthQty = thisMonthList.reduce((s, i) => s + (statsMap.get(i.id)?.totalQuantity || 0), 0)

 return (
 <div>
 <PageHeader
 title="입고내역서"
 description="거래처별 입고 내역(박스 단위)을 관리합니다."
 action={<>
   <Button variant="secondary" onClick={async () => {
     if (filtered.length === 0) return alert('내보낼 입고내역이 없습니다.')
     const ids = filtered.map(i => i.id)
     const { data: itms } = await supabase.from('incoming_items').select('*').in('incoming_id', ids)
     const headerSheet = rowsToSheet(filtered as any[], [
       { key: 'issue_date', label: '입고일' },
       { key: 'vendor_id', label: '거래처', format: (id: string) => vendors.find(v => v.id === id)?.name || '—' },
       { key: 'id', label: '총 박스수', format: (id: string) => statsMap.get(id)?.boxCount || 0 },
       { key: 'id', label: '총 수량', format: (id: string) => statsMap.get(id)?.totalQuantity || 0 },
       { key: 'notes', label: '메모' },
     ])
     const itemRows: any[][] = [['입고일','거래처','상품','컬러','사이즈','박스번호','수량']]
     filtered.forEach(inc => {
       const vendor = vendors.find(v => v.id === inc.vendor_id)?.name || '—'
       const myItems = (itms || []).filter((it: any) => it.incoming_id === inc.id)
       myItems.forEach((it: any) => {
         itemRows.push([inc.issue_date, vendor, it.product_name, it.color, it.size, it.box_number, it.quantity])
       })
     })
     exportMultiSheet([
       { name: '입고내역_요약', rows: headerSheet },
       { name: '입고내역_상세', rows: itemRows },
     ], '입고내역서')
   }} disabled={filtered.length === 0}>📥 엑셀 내보내기</Button>
   <IncomingImportButton onImported={load} />
   <Button onClick={() => { setEditing(null); setDrawerOpen(true) }} disabled={vendors.length === 0}>＋ 새 입고내역서</Button>
 </>}
 />

 <BulkBar
   count={bulk.count}
   onClear={bulk.clear}
   onDelete={handleBulkDelete}
   label="입고내역서"
   extraActions={
     <button
       onClick={convertManyToInvoice}
       className="inline-flex items-center gap-1 px-3 py-1.5 text-[12px] font-medium bg-emerald-600 hover:bg-emerald-700 rounded-md transition-colors"
       title="선택한 여러 입고를 한 계산서로 통합 발행 (5월+6월 등)"
     >
       📋 통합 발행 → 한 계산서 ({bulk.count})
     </button>
   }
 />

 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
 <StatCard
   label="이번 달 입고"
   value={`${thisMonthQty.toLocaleString()}장`}
   hint={`${thisMonth} · ${thisMonthList.length}건`}
   onClick={() => { setMonthFilter(thisMonth); setVendorFilter('all'); setSearch('') }}
 />
 <StatCard
   label="전체 입고 수량"
   value={`${totalQty.toLocaleString()}장`}
   hint={`${filtered.length}건의 입고내역서`}
   onClick={() => { setMonthFilter('all'); setVendorFilter('all'); setSearch('') }}
 />
 <StatCard label="총 박스 수" value={`${totalCartons.toLocaleString()}개`} hint="C/T 합계" />
 <StatCard
 label="등록 거래처"
 value={`${vendors.length}개`}
 hint={vendorFilter === 'all' ? '전체' : vendorName(vendorFilter)}
 onClick={() => setVendorFilter('all')}
 />
 </div>

 {vendors.length === 0 ? (
 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <Empty icon="🏢" title="먼저 고객 거래처를 등록해주세요" />
 </div>
 ) : (
 <div className="bg-white border border-zinc-200 rounded-2xl overflow-hidden">
 <div className="p-3 border-b border-zinc-100 flex items-center gap-3 flex-wrap">
 <label className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-zinc-50 cursor-pointer">
   <Checkbox
     checked={filtered.length > 0 && filtered.every(i => bulk.has(i.id))}
     indeterminate={filtered.some(i => bulk.has(i.id))}
     onChange={() => bulk.toggleAll(filtered.map(i => i.id))}
     ariaLabel="현재 필터 전체 선택"
   />
   <span className="text-[12px] text-zinc-600 select-none">전체 선택</span>
 </label>
 <div className="w-40">
 <Select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
 <option value="all">전체 기간</option>
 {monthFilter !== 'all' && !allMonths.includes(monthFilter) && <option value={monthFilter}>{monthFilter}</option>}
 {allMonths.map(m => <option key={m} value={m}>{m}</option>)}
 </Select>
 </div>
 <div className="w-56">
 <Select value={vendorFilter} onChange={e => setVendorFilter(e.target.value)}>
 <option value="all">모든 거래처</option>
 {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name ? `${v.name} (${v.company_name})` : v.name}</option>)}
 </Select>
 </div>
 <div className="flex-1 min-w-[180px]">
 <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="" />
 </div>
 <span className="text-[12px] text-zinc-500 ml-auto">
 {filtered.length}건 · 총 <span className="font-semibold text-zinc-700 tabular-nums">{totalQty.toLocaleString()}</span>장
 </span>
 </div>

 {loading ? (
 <div className="p-16 text-center text-[12px] text-zinc-400">불러오는 중...</div>
 ) : filtered.length === 0 ? (
 <Empty icon="📦" title="등록된 입고내역서가 없어요" description="＋ 새 입고내역서 버튼으로 시작하세요." />
 ) : (
 <div>
 {(() => {
   // 월별 그룹화
   const grouped = filtered.reduce<Record<string, Incoming[]>>((acc, inc) => {
     const k = inc.period || '미분류'
     if (!acc[k]) acc[k] = []
     acc[k].push(inc)
     return acc
   }, {})
   const months = Object.keys(grouped).sort((a, b) => b.localeCompare(a))
   return months.map(month => {
     const monthList = grouped[month]
     const monthQty = monthList.reduce((s, i) => s + (statsMap.get(i.id)?.totalQuantity || 0), 0)
     const monthCartons = monthList.reduce((s, i) => s + (statsMap.get(i.id)?.cartons || 0), 0)
     return (
       <div key={month}>
         <div className="px-4 py-2.5 bg-zinc-50 border-y border-zinc-100 flex items-center justify-between">
           <div className="flex items-center gap-2">
             <span className="text-[13px] font-bold text-zinc-900 tabular-nums">{month}</span>
             <span className="text-[11px] text-zinc-500">· {monthList.length}건</span>
           </div>
           <span className="text-[12px] font-semibold tabular-nums text-zinc-700">
             {monthQty.toLocaleString()}장 · {monthCartons} 박스
           </span>
         </div>
         <table className="w-full text-[13px]">
           <thead>
             <tr className="text-left text-[11px] font-semibold uppercase text-zinc-500">
               <th className="pl-4 pr-2 py-2.5 w-10"></th>
               <th className="px-4 py-2.5">거래처</th>
               <th className="px-4 py-2.5">입고 일자</th>
               <th className="px-4 py-2.5 text-right">총 수량</th>
               <th className="px-4 py-2.5 text-right">박스</th>
               <th className="px-4 py-2.5 text-right">상품</th>
               <th className="px-4 py-2.5">브랜드</th>
               <th className="px-4 py-2.5 text-right">관리</th>
             </tr>
           </thead>
           <tbody>
             {monthList.map(i => {
               const stats = statsMap.get(i.id)
               const dates = stats?.deliveryDates || []
               return (
                 <tr key={i.id} className={`border-t border-zinc-100 hover:bg-zinc-50/50 ${bulk.has(i.id) ? 'bg-zinc-50' : ''}`}>
                   <td className="pl-4 pr-2 py-2.5">
                     <Checkbox checked={bulk.has(i.id)} onChange={() => bulk.toggle(i.id)} ariaLabel={`${i.period || '입고'} 선택`} />
                   </td>
                   <td className="px-4 py-2.5 font-medium text-zinc-900">
                     <button onClick={() => { setEditing(i); setDrawerOpen(true) }} className="hover:underline">
                       <Badge color="green">{vendorName(i.vendor_id)}</Badge>
                     </button>
                   </td>
                   <td className="px-4 py-2.5">
                     {dates.length === 0 ? (
                       <span className="text-zinc-300 text-[11px]">—</span>
                     ) : (
                       <div className="flex flex-wrap gap-1">
                         {dates.map(d => (
                           <span key={d} className="inline-block text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 tabular-nums">
                             {d.slice(5).replace('-', '/')}
                           </span>
                         ))}
                       </div>
                     )}
                   </td>
                   <td className="px-4 py-2.5 text-right font-semibold tabular-nums">
                     {stats ? `${stats.totalQuantity.toLocaleString()}장` : '—'}
                     {stats && Object.keys(stats.sizeBreakdown).length > 0 && (
                       <div className="mt-1 flex flex-wrap gap-0.5 justify-end">
                         {Object.entries(stats.sizeBreakdown)
                           .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
                           .map(([sz, n]) => (
                             <span key={sz} className="inline-block text-[9px] px-1 py-0.5 rounded bg-zinc-100 text-zinc-600 font-normal">
                               {sz}:{n}
                             </span>
                           ))}
                       </div>
                     )}
                   </td>
                   <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{stats?.cartons || 0}</td>
                   <td className="px-4 py-2.5 text-right tabular-nums text-zinc-600">{stats?.productCount || 0}</td>
                   <td className="px-4 py-2.5 text-zinc-600">{i.brand || '—'}</td>
                   <td className="px-4 py-2.5 text-right whitespace-nowrap">
                     {issuedMap.has(i.id) && (
                       <button
                         onClick={() => navigate(`/invoices?edit=${issuedMap.get(i.id)}`)}
                         title="이 입고로 발행된 계산서 보기"
                         className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 mr-1"
                       >📄 발행됨</button>
                     )}
                     <Button size="sm" variant="ghost" onClick={() => exportOneIncoming(i)} title="입고내역서 엑셀 다운로드">📥 엑셀</Button>
                     <Button size="sm" variant="ghost" onClick={() => navigate(`/incoming/${i.id}/print`)} title="입고내역서 출력">🖨️ 출력</Button>
                     <Button
                       size="sm"
                       variant="ghost"
                       onClick={() => convertToInvoice(i)}
                       title={issuedMap.has(i.id) ? '입고에 새로 추가된 라인만 추가 발행 (중복 자동 제외)' : '이 입고로 계산서 1클릭 발행'}
                       className="text-violet-600 hover:bg-violet-50"
                     >📄 {issuedMap.has(i.id) ? '추가 발행' : '계산서 발행'}</Button>
                     <Button size="sm" variant="ghost" onClick={() => { setEditing(i); setDrawerOpen(true) }}>수정</Button>
                     <Button size="sm" variant="ghost" onClick={() => handleDelete(i)} className="text-rose-600 hover:bg-rose-50">삭제</Button>
                   </td>
                 </tr>
               )
             })}
           </tbody>
         </table>
       </div>
     )
   })
 })()}
 </div>
 )}
 </div>
 )}

 <IncomingDrawer
 open={drawerOpen}
 onClose={() => setDrawerOpen(false)}
 editing={editing}
 vendors={vendors}
 onSaved={() => { setDrawerOpen(false); load() }}
 />
 </div>
 )
}

function StatCard({ label, value, hint, onClick }: { label: string; value: string; hint?: string; onClick?: () => void }) {
 const inner = (
 <div className={`bg-white border border-zinc-200 rounded-2xl p-4 text-left ${onClick ? 'hover:border-zinc-400 hover:bg-zinc-50/50 cursor-pointer transition-colors' : ''}`}>
 <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
 <p className="text-[20px] font-bold text-zinc-900 mt-1 tabular-nums">{value}</p>
 {hint && <p className="text-[11px] text-zinc-400 mt-0.5 flex items-center justify-between"><span>{hint}</span>{onClick && <span>→</span>}</p>}
 </div>
 )
 return onClick ? <button onClick={onClick} className="block w-full">{inner}</button> : inner
}

/* ───── 로컬 박스 (저장 전 메모리 상태) ───── */
interface LocalCarton {
 tempId: string
 persistedId?: string
 product_id: string | null
 product_code: string | null
 product_name: string | null
 sizes: Record<string, number>
 total_quantity: number
 carton_no: number
}

function newTempId() { return 'tmp_' + Math.random().toString(36).slice(2) }

/* ───── 입고내역서 헤더 + 라인 편집 ───── */
function IncomingDrawer({ open, onClose, editing, vendors, onSaved }: {
 open: boolean; onClose: () => void; editing: Incoming | null; vendors: Vendor[]; onSaved: () => void
}) {
 const [form, setForm] = useState<Partial<Incoming>>({})
 const [cartons, setCartons] = useState<LocalCarton[]>([])
 const [originalIds, setOriginalIds] = useState<Set<string>>(new Set())
 const [products, setProducts] = useState<Product[]>([])
 const [saving, setSaving] = useState(false)
 const [error, setError] = useState<string | null>(null)
 const [view, setView] = useState<'cartons' | 'summary'>('cartons')
 const [searchInline, setSearchInline] = useState('')
 const [dirty, setDirty] = useState(false)

 useEffect(() => {
 if (!open) return
 if (editing) {
 setForm(editing)
 loadExisting(editing)
 } else {
 setForm({ producer: 'AW', vendor_id: vendors[0]?.id, period: defaultPeriod() })
 setCartons([])
 setOriginalIds(new Set())
 if (vendors[0]) loadProducts(vendors[0].id)
 }
 setError(null)
 setView('cartons')
 setDirty(false)
 }, [editing, open, vendors])

 async function loadExisting(inc: Incoming) {
 const { data } = await supabase.from('incoming_items').select('*').eq('incoming_id', inc.id).order('carton_no').order('created_at')
 const local: LocalCarton[] = (data ?? []).map(it => ({
 tempId: newTempId(),
 persistedId: it.id,
 product_id: it.product_id,
 product_code: it.product_code,
 product_name: it.product_name,
 sizes: it.sizes || {},
 total_quantity: Number(it.total_quantity || 0),
 carton_no: it.carton_no || 0,
 }))
 setCartons(local)
 setOriginalIds(new Set(local.map(c => c.persistedId!).filter(Boolean)))
 loadProducts(inc.vendor_id)
 }

 async function loadProducts(vendorId: string) {
 const { data } = await supabase.from('products').select('*').eq('vendor_id', vendorId).order('code')
 setProducts(data ?? [])
 }

 function update<K extends keyof Incoming>(k: K, v: Incoming[K]) {
 setForm(prev => ({ ...prev, [k]: v }))
 setDirty(true)
 if (k === 'vendor_id') loadProducts(v as string)
 }

 const currentVendor = vendors.find(v => v.id === form.vendor_id)
 const sizeKeys: string[] = currentVendor?.size_system && currentVendor.size_system.length > 0
 ? currentVendor.size_system
 : []

 function addCarton() {
 if (sizeKeys.length === 0) {
 alert('이 거래처의 사이즈 체계를 먼저 등록해주세요.')
 return
 }
 const sizes: Record<string, number> = {}
 sizeKeys.forEach(s => sizes[s] = 0)
 const carton_no = (Math.max(0, ...cartons.map(c => c.carton_no || 0)) || 0) + 1
 setCartons(prev => [...prev, {
 tempId: newTempId(),
 product_id: products[0]?.id || null,
 product_code: products[0]?.code || null,
 product_name: products[0]?.name || null,
 sizes,
 total_quantity: 0,
 carton_no,
 }])
 setDirty(true)
 }

 function updateCarton(tempId: string, patch: Partial<LocalCarton>) {
 setCartons(prev => prev.map(c => c.tempId === tempId ? { ...c, ...patch } : c))
 setDirty(true)
 }

 function removeCarton(tempId: string) {
 if (!confirm('이 박스를 삭제할까요?')) return
 setCartons(prev => prev.filter(c => c.tempId !== tempId))
 setDirty(true)
 }

 function changeProduct(c: LocalCarton, productId: string) {
 const p = products.find(x => x.id === productId)
 updateCarton(c.tempId, {
 product_id: productId || null,
 product_code: p?.code || null,
 product_name: p?.name || null,
 })
 }

 function changeSize(c: LocalCarton, sizeKey: string, value: number) {
 const newSizes = { ...c.sizes, [sizeKey]: value }
 const total = Object.values(newSizes).reduce((s, n) => s + Number(n || 0), 0)
 updateCarton(c.tempId, { sizes: newSizes, total_quantity: total })
 }

 // 품번 합계 뷰
 const summary = cartons.reduce<Record<string, { code: string; name: string; sizes: Record<string, number>; total: number; cartons: number }>>((acc, it) => {
 const key = it.product_code || it.product_id || 'unknown'
 if (!acc[key]) acc[key] = { code: it.product_code || '', name: it.product_name || '', sizes: {}, total: 0, cartons: 0 }
 sizeKeys.forEach(s => {
 acc[key].sizes[s] = (acc[key].sizes[s] || 0) + Number(it.sizes[s] || 0)
 })
 acc[key].total += Number(it.total_quantity || 0)
 acc[key].cartons += 1
 return acc
 }, {})

 const grandTotal = cartons.reduce((s, i) => s + Number(i.total_quantity || 0), 0)

 /* ───── 저장 ───── */
 async function handleSave(closeAfter: boolean = true) {
 if (!form.vendor_id) { setError('거래처를 선택해주세요.'); return }
 setSaving(true)
 setError(null)

 const headerPayload = {
 vendor_id: form.vendor_id,
 period: form.period?.trim() || null,
 producer: form.producer?.trim() || 'AW',
 brand: form.brand?.trim() || null,
 notes: form.notes?.trim() || null,
 }

 let incomingId: string
 if (editing) {
 const { error } = await supabase.from('incoming').update(headerPayload).eq('id', editing.id)
 if (error) { setSaving(false); setError(error.message); return }
 incomingId = editing.id
 } else {
 const { data, error } = await supabase.from('incoming').insert(headerPayload).select().single()
 if (error) { setSaving(false); setError(error.message); return }
 incomingId = data.id
 }

 // 박스 동기화
 const currentIds = new Set(cartons.filter(c => c.persistedId).map(c => c.persistedId!))
 const toDelete = Array.from(originalIds).filter(id => !currentIds.has(id))
 if (toDelete.length > 0) {
 await supabase.from('incoming_items').delete().in('id', toDelete)
 }

 for (const c of cartons) {
 const payload = {
 incoming_id: incomingId,
 product_id: c.product_id,
 product_code: c.product_code,
 product_name: c.product_name,
 sizes: c.sizes,
 total_quantity: c.total_quantity,
 carton_no: c.carton_no,
 }
 if (c.persistedId) {
 await supabase.from('incoming_items').update(payload).eq('id', c.persistedId)
 } else {
 await supabase.from('incoming_items').insert(payload)
 }
 }

 // ★ 입고 → 계산서 동기화: 이 입고로 발행된 계산서 있으면 사용자에게 묻고 라인 다시 생성
 if (editing) {
   const { data: linkedInvs } = await supabase.from('invoices')
     .select('id, vendor_id').eq('incoming_id', incomingId).is('deleted_at', null)
   if (linkedInvs && linkedInvs.length > 0) {
     const ok = confirm(
       `이 입고로 발행된 계산서 ${linkedInvs.length}건이 있어요.\n\n입고 변경사항을 계산서에도 반영할까요?\n\n` +
       `[확인] → 계산서 라인을 입고 기준으로 다시 생성 (수동으로 수정한 단가/라인은 사라집니다)\n` +
       `[취소] → 계산서는 그대로 두고 입고만 저장`
     )
     if (ok) {
       await syncInvoicesFromIncoming(incomingId, linkedInvs[0].vendor_id)
     }
   }
 }

 setSaving(false)
 setDirty(false)
 if (closeAfter) onSaved()
 }

 /** 입고에 연결된 모든 계산서의 라인을 입고 기준으로 다시 생성 */
 async function syncInvoicesFromIncoming(incomingId: string, vendorId: string) {
   const { data: items } = await supabase.from('incoming_items').select('*').eq('incoming_id', incomingId)
   if (!items) return

   // 거래처 상품 카탈로그 (단가 매칭)
   const { data: prods } = await supabase.from('products').select('id, code, name, selling_price, color')
     .eq('vendor_id', vendorId).is('deleted_at', null)
   const byId = new Map<string, any>()
   const byCode = new Map<string, any>()
   const byName = new Map<string, any>()
   ;(prods ?? []).forEach((p: any) => {
     byId.set(p.id, p)
     if (p.code) byCode.set(String(p.code).trim().toLowerCase(), p)
     if (p.name) byName.set(String(p.name).trim().toLowerCase(), p)
   })

   // 입고 라인 → 계산서 라인 변환 (상품×컬러로 합치고 사이즈는 sizes JSON에)
   const lineMap = new Map<string, any>()
   items.filter(it => !isSummaryItem(it)).forEach((it: any) => {
     const pKey = it.product_id || it.product_code || it.product_name || 'unknown'
     let prod = it.product_id ? byId.get(it.product_id) : null
     if (!prod) {
       const codeKey = (it.product_code || '').toString().trim().toLowerCase()
       const nameKey = (it.product_name || '').toString().trim().toLowerCase()
       prod = (codeKey && byCode.get(codeKey)) || (nameKey && byName.get(nameKey)) || null
     }
     const colorKey = prod?.color || ''
     const k = `${pKey}__${colorKey}`
     const existing = lineMap.get(k)
     if (existing) {
       const sizes = it.sizes || {}
       Object.entries(sizes).forEach(([sz, n]) => {
         const num = Number(n) || 0
         if (num > 0) existing.sizes[sz] = (existing.sizes[sz] || 0) + num
       })
       existing.quantity += Number(it.total_quantity || 0)
     } else {
       const newSizes: Record<string, number> = {}
       Object.entries(it.sizes || {}).forEach(([sz, n]) => {
         const num = Number(n) || 0
         if (num > 0) newSizes[sz] = num
       })
       lineMap.set(k, {
         line_date: null,
         product_id: prod?.id || it.product_id || null,
         product_name: prod?.name || it.product_name || it.product_code || '',
         color: prod?.color || null,
         size: null,
         sizes: newSizes,
         quantity: Number(it.total_quantity || 0),
         unit_price: Number(prod?.selling_price ?? 0),
       })
     }
   })
   const allLines = Array.from(lineMap.values())
     .sort((a, b) => (a.product_name || '').localeCompare(b.product_name || '') || (a.color || '').localeCompare(b.color || ''))

   // 연결된 모든 계산서 가져와서 첫 번째에 라인 다 넣고, 나머지는 빈 채로 유지
   // (보통 입고당 계산서 1건이라 큰 문제 없음. 여러 건 있으면 첫 번째만 동기화)
   const { data: linkedInvs } = await supabase.from('invoices')
     .select('id').eq('incoming_id', incomingId).is('deleted_at', null).order('issue_date', { ascending: false })
   if (!linkedInvs || linkedInvs.length === 0) return

   const targetInvId = linkedInvs[0].id
   // 기존 라인 모두 삭제
   await supabase.from('invoice_items').delete().eq('invoice_id', targetInvId)
   // 새 라인 INSERT
   const linePayload = allLines.map((l, idx) => ({ invoice_id: targetInvId, ...l, sort_order: idx }))
   if (linePayload.length > 0) {
     await supabase.from('invoice_items').insert(linePayload)
   }
   // 합계 재계산
   const subtotal = allLines.reduce((s, l) => s + l.quantity * l.unit_price, 0)
   const vat = Math.round(subtotal * 0.1)
   await supabase.from('invoices').update({ subtotal, vat, total: subtotal + vat }).eq('id', targetInvId)
 }

 function handleClose() {
 if (dirty && !confirm('저장하지 않은 변경 사항이 있어요. 정말 닫을까요?')) return
 onClose()
 }

 return (
 <Drawer
 open={open}
 onClose={handleClose}
 title={editing ? '입고내역서 편집' : '새 입고내역서'}
 width="lg"
 footer={
 <>
 {dirty && <span className="text-[11px] text-amber-600 mr-auto">● 저장 안 된 변경 사항 있음</span>}
 {!dirty && editing && <span className="text-[11px] text-emerald-600 mr-auto">✓ 저장됨</span>}
 <Button variant="secondary" onClick={handleClose}>닫기</Button>
 <Button onClick={() => handleSave(true)} disabled={saving || !dirty}>
 {saving ? '저장 중...' : '저장'}
 </Button>
 </>
 }
 >
 {error && <div className="mb-4 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-[12px]">{error}</div>}

 <div className="space-y-4 pb-5 border-b border-zinc-100 mb-5">
 <div className="grid grid-cols-3 gap-3">
 <div>
 <Label required>거래처</Label>
 <Select value={form.vendor_id || ''} onChange={e => update('vendor_id', e.target.value)}>
 {vendors.map(v => <option key={v.id} value={v.id}>{v.company_name ? `${v.name} (${v.company_name})` : v.name}</option>)}
 </Select>
 <p className="text-[11px] text-zinc-400 mt-1">
 {products.length > 0
 ? `이 거래처의 등록 상품: ${products.length}개`
 : '⚠ 등록 상품 없음 (상품 관리에서 먼저 등록)'}
 </p>
 </div>
 <div>
 <Label>기간</Label>
 <Input value={form.period || ''} onChange={e => update('period', e.target.value)} />
 </div>
 <div>
 <Label>생산처</Label>
 <Input value={form.producer || 'AW'} onChange={e => update('producer', e.target.value)} />
 </div>
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <Label>브랜드</Label>
 <Input value={form.brand || ''} onChange={e => update('brand', e.target.value)} />
 </div>
 <div>
 <Label>메모</Label>
 <Input value={form.notes || ''} onChange={e => update('notes', e.target.value)} />
 </div>
 </div>

 {sizeKeys.length === 0 && form.vendor_id && (
 <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-[12px]">
 ⚠️ 이 거래처에 사이즈 체계가 등록되어 있지 않습니다. <strong>고객 거래처</strong> 메뉴에서 사이즈를 먼저 선택해주세요.
 </div>
 )}
 </div>

 {sizeKeys.length > 0 && (
 <div>
 <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
 <div className="flex items-center gap-2">
 <h3 className="text-[14px] font-semibold text-zinc-900">입고 라인 (박스 단위)</h3>
 {cartons.length > 0 && (
 <span className="text-[11px] text-zinc-500">
 · 박스 {cartons.length}개 · 합계 {grandTotal.toLocaleString()}장
 </span>
 )}
 </div>
 <div className="flex items-center gap-2">
 <div className="flex bg-zinc-100 rounded-lg p-0.5">
 <button
 className={`px-3 py-1 text-[11px] font-medium rounded ${view === 'cartons' ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
 onClick={() => setView('cartons')}
 >박스별 (수정)</button>
 <button
 className={`px-3 py-1 text-[11px] font-medium rounded ${view === 'summary' ? 'bg-white shadow-sm' : 'text-zinc-500'}`}
 onClick={() => setView('summary')}
 >품번 합계</button>
 </div>
 <Button size="sm" onClick={addCarton}>＋ 박스 추가</Button>
 </div>
 </div>
 {/* 검색창 — 두 뷰 모두에서 필터링 */}
 {cartons.length > 0 && (
   <div className="mb-3 relative">
     <input
       value={searchInline}
       onChange={e => setSearchInline(e.target.value)}
       placeholder="🔍 품번 / 품목명으로 검색 (양쪽 뷰 다 필터됨)"
       className="w-full px-3 py-2 text-[12px] bg-zinc-50 border border-zinc-200 rounded-lg outline-none focus:border-zinc-400 focus:ring-1 focus:ring-zinc-100 placeholder:text-zinc-400"
     />
     {searchInline && (
       <button onClick={() => setSearchInline('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700 text-sm">✕</button>
     )}
   </div>
 )}

 {cartons.length === 0 ? (
 <div className="border-2 border-dashed border-zinc-200 rounded-xl p-8 text-center">
 <p className="text-[13px] text-zinc-700 font-medium mb-2">📦 첫 박스를 추가해보세요</p>
 <p className="text-[12px] text-zinc-500 mb-4">박스 하나마다 품번과 사이즈별 수량을 입력합니다.</p>
 <Button onClick={addCarton}>＋ 첫 박스 추가하기</Button>
 {products.length === 0 && (
 <p className="text-[11px] text-amber-600 mt-3">
 ⚠️ 이 거래처에 등록된 상품이 없어요. <strong>상품 관리</strong>에서 먼저 등록하세요.
 </p>
 )}
 </div>
 ) : view === 'cartons' ? (
 <div className="space-y-2">
 {searchInline && (
   <div className="text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5">
     🔍 "{searchInline}" 검색 중 — 매치되는 박스만 표시
   </div>
 )}
 {cartons.filter(c => {
   const q = searchInline.trim().toLowerCase()
   if (!q) return true
   return (c.product_code || '').toLowerCase().includes(q) || (c.product_name || '').toLowerCase().includes(q)
 }).map(c => (
 <div key={c.tempId} className="border border-zinc-200 rounded-xl p-3 hover:border-zinc-300 transition-colors">
 <div className="flex items-center gap-2 mb-2">
 <Badge>C/T {c.carton_no}</Badge>
 <Select className="text-[12px] flex-1" value={c.product_id || ''} onChange={e => changeProduct(c, e.target.value)}>
 <option value="">— 상품 선택 (이 거래처 상품 {products.length}개) —</option>
 {products.map(p => <option key={p.id} value={p.id}>{p.code} · {p.name}{p.color ? ` (${p.color})` : ''}</option>)}
 </Select>
 <button onClick={() => removeCarton(c.tempId)} className="text-rose-500 hover:text-rose-700 text-lg w-7 h-7" title="박스 삭제">×</button>
 </div>
 <div className="grid gap-1.5 mb-1" style={{ gridTemplateColumns: `repeat(${sizeKeys.length}, minmax(0, 1fr))` }}>
 {sizeKeys.map(s => (
 <div key={s}>
 <p className="text-[10px] text-zinc-500 text-center mb-0.5">{s}</p>
 <Input
 type="number"
 value={c.sizes[s] || 0}
 onChange={e => changeSize(c, s, Number(e.target.value))}
 className="text-[12px] text-center px-1.5 py-1.5"
 />
 </div>
 ))}
 </div>
 <div className="text-right text-[11px] text-zinc-500 mt-1">
 합계: <span className="font-semibold text-zinc-900 tabular-nums">{c.total_quantity}</span>
 </div>
 </div>
 ))}
 <div className="bg-zinc-100 rounded-xl p-3 flex items-center justify-between text-[13px]">
 <span className="text-zinc-500">총 박스 {cartons.length}개</span>
 <span className="text-zinc-500">전체 합계: <span className="font-bold text-zinc-900 tabular-nums text-[15px]">{grandTotal.toLocaleString()}</span></span>
 </div>
 </div>
 ) : (
 <div className="border border-zinc-200 rounded-xl overflow-hidden">
 <table className="w-full text-[12px]">
 <thead className="bg-zinc-50">
 <tr>
 <th className="px-3 py-2 text-left">품번</th>
 <th className="px-3 py-2 text-left">품목</th>
 {sizeKeys.map(s => <th key={s} className="px-2 py-2 text-center">{s}</th>)}
 <th className="px-3 py-2 text-right">합계</th>
 <th className="px-2 py-2 text-center">박스</th>
 </tr>
 </thead>
 <tbody>
 {Object.values(summary)
   .filter(s => {
     const q = searchInline.trim().toLowerCase()
     if (!q) return true
     return (s.code || '').toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
   })
   .map(s => (
 <tr
   key={s.code}
   className="border-t border-zinc-100 hover:bg-blue-50/50 cursor-pointer"
   onClick={() => { setSearchInline(s.code); setView('cartons') }}
   title="클릭하면 박스별 보기로 이동 (이 품번만 필터)"
 >
 <td className="px-3 py-2 font-mono text-blue-700">{s.code}</td>
 <td className="px-3 py-2 truncate max-w-[200px]">{s.name}</td>
 {sizeKeys.map(k => <td key={k} className="px-2 py-2 text-center tabular-nums">{s.sizes[k] || 0}</td>)}
 <td className="px-3 py-2 text-right font-semibold tabular-nums">{s.total}</td>
 <td className="px-2 py-2 text-center text-zinc-500">{s.cartons}개 →</td>
 </tr>
 ))}
 <tr className="border-t-2 border-zinc-300 bg-zinc-50">
 <td colSpan={2 + sizeKeys.length} className="px-3 py-2 text-right font-semibold">전체</td>
 <td className="px-3 py-2 text-right font-bold text-[14px] tabular-nums">{grandTotal.toLocaleString()}</td>
 <td className="px-2 py-2 text-center text-zinc-500">{cartons.length}</td>
 </tr>
 </tbody>
 </table>
 </div>
 )}
 <p className="text-[11px] text-zinc-400 mt-2">💡 변경 사항은 우측 하단 <strong>저장</strong> 버튼을 눌러야 DB에 반영됩니다.</p>
 </div>
 )}
 </Drawer>
 )
}

function defaultPeriod() {
 const d = new Date()
 return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`
}
