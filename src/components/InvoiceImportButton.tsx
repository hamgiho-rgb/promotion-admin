import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Button, Drawer, Badge, Empty } from '@/components/ui'
import { isInvoiceReceiptFormat, parseInvoiceReceiptWorkbook, type ReceiptInvoice } from '@/lib/invoiceReceiptImport'
import { findVendorByFuzzyName } from '@/lib/vendorMatch'
import type { Vendor } from '@/lib/types'

const SUPPLIER = {
  supplier_business_number: '216-21-18212',
  supplier_name: '써치(SEARCH)',
  supplier_ceo: '함기호',
  supplier_address: '서울시 동대문구 안암로 16길 4, 2층',
  bank_info: '함기호(써치) 국민은행 038737-04-002188',
}

export default function InvoiceImportButton({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [invoices, setInvoices] = useState<ReceiptInvoice[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ ok: number; fail: number; errors: string[] } | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const data = new Uint8Array(evt.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        if (!isInvoiceReceiptFormat(wb)) {
          alert('영수증 양식이 아닙니다.\n("영 수 증(공급받는자용)" 제목 + "OOO 귀하" + 날짜/품명/수량/단가 헤더 필요)')
          return
        }
        const parsed = parseInvoiceReceiptWorkbook(wb)
        if (parsed.length === 0) {
          alert('시트에서 라인을 찾지 못했어요.')
          return
        }
        setInvoices(parsed)
        setResult(null)
        setDrawerOpen(true)
      } catch (err: any) {
        alert('파일 읽기 오류: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(file)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function doImport() {
    if (invoices.length === 0) return
    const totalLines = invoices.reduce((s, i) => s + i.lines.length, 0)
    if (!confirm(`${invoices.length}건 계산서 / ${totalLines}개 라인 등록할까요?`)) return

    setImporting(true)
    setResult(null)
    let ok = 0, fail = 0
    const errors: string[] = []

    try {
      const { data: vendorsData } = await supabase.from('vendors').select('*').eq('vendor_type', 'customer')
      const vendorsList: Vendor[] = (vendorsData ?? []) as Vendor[]
      // fuzzy 매칭: 회사명 변형 자동 매칭 → 중복 거래처 생성 방지
      const cachedNewVendors: Vendor[] = []

      for (const inv of invoices) {
        let vendor = findVendorByFuzzyName(inv.vendor_name, [...vendorsList, ...cachedNewVendors], 'customer')
        if (!vendor) {
          const { data: newV, error: cErr } = await supabase.from('vendors').insert({
            name: inv.vendor_name,
            vendor_type: 'customer',
            size_system: [],
          }).select().single()
          if (cErr) {
            fail += inv.lines.length
            errors.push(`${inv.vendor_name}: 거래처 자동 생성 실패 ${cErr.message}`)
            continue
          }
          vendor = newV as Vendor
          cachedNewVendors.push(vendor)
        }

        const subtotal = inv.subtotal
        const vat = Math.round(subtotal * 0.1)
        const total = subtotal + vat

        const { data: invData, error: invErr } = await supabase.from('invoices').insert({
          vendor_id: vendor.id,
          issue_date: inv.issue_date,
          subtotal, vat, total,
          notes: `[${inv.vendor_name}] ${inv.sheetName}`,
          ...SUPPLIER,
        }).select().single()
        if (invErr) {
          fail += inv.lines.length
          errors.push(`${inv.vendor_name} ${inv.sheetName}: ${invErr.message}`)
          continue
        }

        const itemRows = inv.lines.map((l, i) => {
          // 컬러/사이즈를 color 필드에 합쳐서 저장 (기존 일리오 패턴과 동일)
          const colorWithSize = l.color && l.size
            ? `${l.color}/${l.size}`
            : (l.color || l.size || null)
          return {
            invoice_id: invData.id,
            line_date: inv.issue_date,
            product_name: l.product_name,
            color: colorWithSize,
            quantity: l.quantity,
            unit_price: l.unit_price,
            sort_order: i,
          }
        })
        if (itemRows.length > 0) {
          const { error: itErr } = await supabase.from('invoice_items').insert(itemRows)
          if (itErr) {
            fail += itemRows.length
            errors.push(`${inv.vendor_name} ${inv.sheetName}: 라인 ${itErr.message}`)
          } else {
            ok += itemRows.length
          }
        }
      }

      setResult({ ok, fail, errors: errors.slice(0, 10) })
      if (ok > 0) onImported()
    } catch (err: any) {
      setResult({ ok, fail: totalLines - ok, errors: [err.message] })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      <Button variant="secondary" onClick={() => fileRef.current?.click()}>
        📥 엑셀 일괄 등록
      </Button>

      <Drawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setInvoices([]); setResult(null) }}
        title="계산서 엑셀 미리보기"
        width="xl"
        footer={
          result ? (
            <Button onClick={() => { setDrawerOpen(false); setInvoices([]); setResult(null) }}>닫기</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { setDrawerOpen(false); setInvoices([]) }}>취소</Button>
              <Button onClick={doImport} disabled={importing}>
                {importing
                  ? '등록 중…'
                  : `${invoices.length}건 계산서 등록`}
              </Button>
            </>
          )
        }
      >
        {invoices.length === 0 ? (
          <Empty icon="🧾" title="파일을 선택해주세요" />
        ) : (
          <>
            <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-800">
              <strong>🧾 영수증 양식 감지됨</strong> — {invoices.length}개 시트.
              거래처가 없으면 자동 생성. 부가세는 공급가의 10%로 자동 계산.
            </div>

            <div className="space-y-3">
              {invoices.map((inv, idx) => (
                <details key={idx} className="border border-zinc-200 rounded-xl overflow-hidden group">
                  <summary className="px-4 py-3 cursor-pointer hover:bg-zinc-50 flex items-center justify-between list-none">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-zinc-400 group-open:rotate-90 transition-transform inline-block">▶</span>
                      <span className="font-semibold text-[13px] text-zinc-900">{inv.vendor_name}</span>
                      <Badge color="blue">{inv.issue_date}</Badge>
                      <span className="text-[11px] text-zinc-500">{inv.sheetName}</span>
                    </div>
                    <span className="text-[12px] text-zinc-700 font-medium tabular-nums">
                      {inv.lines.length}라인 · ₩{Math.round(inv.subtotal).toLocaleString()}
                    </span>
                  </summary>
                  <div className="px-3 pb-3 overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-zinc-50">
                        <tr>
                          <th className="px-2 py-1.5 text-left">품명</th>
                          <th className="px-2 py-1.5 text-left">품목</th>
                          <th className="px-2 py-1.5 text-left">사이즈</th>
                          <th className="px-2 py-1.5 text-right">수량</th>
                          <th className="px-2 py-1.5 text-right">단가</th>
                          <th className="px-2 py-1.5 text-right">금액</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inv.lines.map((l, i) => (
                          <tr key={i} className="border-t border-zinc-100">
                            <td className="px-2 py-1">{l.product_name}</td>
                            <td className="px-2 py-1 text-zinc-600">{l.color || '—'}</td>
                            <td className="px-2 py-1 text-zinc-600">{l.size || '—'}</td>
                            <td className="px-2 py-1 text-right tabular-nums">{l.quantity}</td>
                            <td className="px-2 py-1 text-right tabular-nums">₩{l.unit_price.toLocaleString()}</td>
                            <td className="px-2 py-1 text-right tabular-nums font-medium">₩{(l.quantity * l.unit_price).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ))}
            </div>

            {result && (
              <div className="mt-5 p-4 rounded-xl bg-zinc-50 border border-zinc-200">
                <div className="flex gap-3 mb-3">
                  <div className="px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-[13px]">
                    ✅ 성공: <strong className="tabular-nums">{result.ok}</strong>건
                  </div>
                  {result.fail > 0 && (
                    <div className="px-3 py-2 bg-rose-50 border border-rose-200 rounded-lg text-[13px]">
                      ❌ 실패: <strong className="tabular-nums">{result.fail}</strong>건
                    </div>
                  )}
                </div>
                {result.errors.length > 0 && (
                  <ul className="text-[11px] text-zinc-600 space-y-1 max-h-32 overflow-y-auto font-mono">
                    {result.errors.map((e, i) => <li key={i}>• {e}</li>)}
                  </ul>
                )}
              </div>
            )}
          </>
        )}
      </Drawer>
    </>
  )
}
