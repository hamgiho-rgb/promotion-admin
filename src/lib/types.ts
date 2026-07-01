// =====================================================================
// Supabase 테이블 TypeScript 타입 정의
// supabase-schema.sql 과 동기화 유지
// =====================================================================

export type VendorType = 'supplier' | 'customer'

export interface Payment {
  id: string
  vendor_id: string
  invoice_id: string | null
  paid_date: string
  amount: number
  memo: string | null
  created_at: string
  deleted_at?: string | null
}

export interface Vendor {
  id: string
  name: string                       // 브랜드명 (예: 마크니)
  company_name: string | null        // 모회사명 (예: 쿨파인더). 없으면 null.
  vendor_type: VendorType
  business_number: string | null
  ceo_name: string | null
  address: string | null
  phone: string | null
  email: string | null
  bank_info: string | null
  size_system: string[]              // ["110","120",...] or ["1","2"] or ["S","M","L"]
  memo: string | null
  /** 이 거래처의 기본 부가세 모드 — 'exclusive' 별도 10% (기본) / 'none' 없음 */
  default_vat_mode?: 'exclusive' | 'none'
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface Product {
  id: string
  code: string                       // 품번 (수동입력)
  name: string                       // 품목명 (한글)
  name_en: string | null             // 영문 상품명 (선택)
  brand: string | null               // 브랜드명 (선택). 예: 단델 (마요네즈 회사의 브랜드)
  color: string | null
  vendor_id: string                  // 소속 거래처(고객)
  selling_price: number              // 판매가
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface CostItem {
  id: string
  product_id: string
  supplier_id: string | null         // 재료 공급처
  item_name: string                  // 재료명
  unit_price: number                 // 단가
  yards: number                      // 요척
  subtotal: number                   // 자동: unit_price * yards
  sort_order: number
  created_at: string
}

export interface FabricUsage {
  id: string
  product_id: string
  color: string
  fabric_in: number                  // 원단 입고 (yard)
  cut_quantity: number               // 재단 수량 (벌)
  total_amount: number               // 총액 (원)
  cost_per_unit: number              // 자동: total_amount / cut_quantity
  yards_per_unit: number             // 자동: fabric_in / cut_quantity
  notes: string | null
  created_at: string
}

export interface Incoming {
  id: string
  vendor_id: string
  period: string | null              // "2026.05"
  producer: string                   // 보통 'AW'
  brand: string | null
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface IncomingItem {
  id: string
  incoming_id: string
  product_id: string | null
  product_code: string | null
  product_name: string | null
  sizes: Record<string, number>      // {"110": 0, "130": 15, ...}
  total_quantity: number
  delivery_date: string | null
  carton_no: number | null
  notes: string | null
  created_at: string
}

export interface Invoice {
  id: string
  vendor_id: string
  issue_date: string
  supplier_business_number: string
  supplier_name: string
  supplier_ceo: string
  supplier_address: string
  bank_info: string
  subtotal: number
  vat: number
  total: number
  // 견적서 연결 + 선납액 (계약금)
  quotation_id: string | null
  // 입고내역서 연결 — 입고 → 계산서 자동 발행 시 추적
  incoming_id: string | null
  deposit_amount: number   // 견적서에서 받은 계약금 (계산서 발행 시 차감)
  received_amount?: number // 발행 후 추가로 받은 수금액 (잔금 = total - deposit - received)
  paid_at: string | null   // 입금 완료 시점 (null이면 미수)
  /** 이 계산서 부가세 모드 — 거래처 기본값 override */
  vat_mode?: 'exclusive' | 'none'
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface InvoiceItem {
  id: string
  invoice_id: string
  line_date: string | null
  product_id: string | null
  product_name: string | null
  color: string | null
  size: string | null                // 사이즈 (예: "110", "M") — 단일 사이즈일 때만
  sizes: Record<string, number> | null  // 사이즈별 분포 ({"110":56,"120":54}) — 입고내역서 양식처럼 컬럼 펼침용
  quantity: number                   // 음수 = 반품
  unit_price: number
  amount: number                     // 자동: quantity * unit_price
  is_return: boolean                 // 자동: quantity < 0
  sort_order: number
  created_at: string
}

// 뷰 (자동 계산)
export interface ProductMargin {
  id: string
  code: string
  name: string
  color: string | null
  vendor_id: string
  vendor_name: string
  selling_price: number
  production_cost: number
  margin: number
  margin_rate: number
}

// 공급처 계산서 (공장에서 받은 청구서)
export interface SupplierInvoice {
  id: string
  supplier_id: string
  period: string | null         // "2026-05"
  issue_date: string | null
  notes: string | null
  subtotal: number
  vat: number
  total: number
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface SupplierInvoiceItem {
  id: string
  invoice_id: string
  line_date: string | null
  product_name: string | null
  brand: string | null
  quantity: number
  unit_price: number
  amount: number                // 자동
  notes: string | null
  sort_order: number
  created_at: string
}

// 견적서
export type QuotationStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted'

export interface Quotation {
  id: string
  vendor_id: string
  issue_date: string
  validity_days: number
  supplier_business_number: string
  supplier_name: string
  supplier_ceo: string
  supplier_address: string
  bank_info: string
  subtotal: number
  vat: number
  total: number
  deposit_rate: number
  deposit_amount: number
  deposit_received: boolean
  deposit_received_date: string | null
  status: QuotationStatus
  notes: string | null
  created_at: string
  updated_at: string
  deleted_at?: string | null
}

export interface QuotationItem {
  id: string
  quotation_id: string
  product_id: string | null
  product_name: string | null
  color: string | null
  size_info: string | null
  quantity: number
  unit_price: number
  amount: number
  sort_order: number
  created_at: string
}
