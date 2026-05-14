import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Button, Drawer, Badge, Empty } from '@/components/ui'
import { isAWIncomingFormat, parseAWWorkbook, type AWReceipt } from '@/lib/awImport'
import { findVendorByFuzzyName } from '@/lib/vendorMatch'
import type { Vendor } from '@/lib/types'

/* ─────────────────────────────────────────────
 * 입고내역서 페이지에 박는 엑셀 일괄 등록 버튼
 * AW 원본 양식 (청운상사/마요네즈) 자동 감지
 * ───────────────────────────────────────────── */

export default function IncomingImportButton({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [receipts, setReceipts] = useState<AWReceipt[]>([])
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
        if (!isAWIncomingFormat(wb)) {
          alert('AW 원본 입고내역서 양식이 아닙니다.\n("입 고 내 역 서" 제목 + "OOO 귀하" 거래처명 + 품번/품목/사이즈/합계 헤더 필요)')
          return
        }
        const parsed = parseAWWorkbook(wb)
        if (parsed.length === 0) {
          alert('시트에서 데이터를 찾지 못했어요.')
          return
        }
        setReceipts(parsed)
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
    if (receipts.length === 0) return
    const total = receipts.reduce((s, r) => s + r.items.length, 0)
    if (!confirm(`${receipts.length}개 시트 / ${total}개 라인을 등록할까요?`)) return

    setImporting(true)
    setResult(null)
    let ok = 0, fail = 0
    const errors: string[] = []

    try {
      const { data: vendorsData } = await supabase.from('vendors').select('*').eq('vendor_type', 'customer')
      const vendorsList: Vendor[] = (vendorsData ?? []) as Vendor[]
      // fuzzy 매칭: "마요네즈"/"주식회사마요네즈"/"단델(마요네즈)" 같은 변형을 같은 거래처로 잡음
      // 같은 import 작업 안에서 새로 만들어진 거래처도 캐시에 추가
      const cachedNewVendors: Vendor[] = []

      const { data: productsData } = await supabase.from('products').select('id, code')
      const productByCode = new Map<string, string>()
      ;(productsData ?? []).forEach(p => { if (p.code) productByCode.set(p.code, p.id) })

      let mergedCount = 0  // 같은 거래처+기간 입고에 라인 추가한 건수
      let skippedCount = 0 // 이미 동일 라인 있어서 스킵한 건수

      for (const receipt of receipts) {
        let vendor = findVendorByFuzzyName(receipt.vendor_name, [...vendorsList, ...cachedNewVendors], 'customer')
        if (!vendor) {
          const { data: newV, error: cErr } = await supabase.from('vendors').insert({
            name: receipt.vendor_name,
            vendor_type: 'customer',
            size_system: receipt.sizeLabels,
          }).select().single()
          if (cErr) {
            fail += receipt.items.length
            errors.push(`${receipt.vendor_name}: 거래처 자동 생성 실패 ${cErr.message}`)
            continue
          }
          vendor = newV as Vendor
          cachedNewVendors.push(vendor)
        }
        if (!vendor.size_system || vendor.size_system.length === 0) {
          await supabase.from('vendors').update({ size_system: receipt.sizeLabels }).eq('id', vendor.id)
        }

        // ★ 중복 방지: 같은 (vendor + period) 입고가 이미 있으면 → 그 입고에 라인만 추가
        let incomingId: string
        let isExisting = false
        const { data: existingIncs } = await supabase.from('incoming')
          .select('id').eq('vendor_id', vendor.id).eq('period', receipt.period || '')
          .is('deleted_at', null).limit(1)
        if (existingIncs && existingIncs.length > 0) {
          incomingId = existingIncs[0].id
          isExisting = true
        } else {
          const { data: incData, error: incErr } = await supabase.from('incoming').insert({
            vendor_id: vendor.id,
            period: receipt.period,
            producer: 'AW',
          }).select().single()
          if (incErr) {
            fail += receipt.items.length
            errors.push(`${receipt.vendor_name} ${receipt.sheetName}: ${incErr.message}`)
            continue
          }
          incomingId = incData.id
        }

        // 기존 라인 키 (delivery_date + product_code + carton_no) 모음 — 중복 라인 스킵용
        let existingLineKeys = new Set<string>()
        if (isExisting) {
          const { data: existingItems } = await supabase.from('incoming_items')
            .select('delivery_date, product_code, carton_no').eq('incoming_id', incomingId)
          ;(existingItems ?? []).forEach((it: any) => {
            const k = `${it.delivery_date || ''}__${it.product_code || ''}__${it.carton_no ?? ''}`
            existingLineKeys.add(k)
          })
        }

        const newPayload = []
        for (const it of receipt.items) {
          const k = `${it.delivery_date || ''}__${it.product_code || ''}__${it.carton_no ?? ''}`
          if (existingLineKeys.has(k)) {
            skippedCount++
            continue
          }
          newPayload.push({
            incoming_id: incomingId,
            product_id: productByCode.get(it.product_code) || null,
            product_code: it.product_code || null,
            product_name: it.product_name || null,
            sizes: it.sizes,
            total_quantity: it.total,
            delivery_date: it.delivery_date,
            carton_no: it.carton_no,
          })
        }
        if (newPayload.length > 0) {
          const { error: itErr } = await supabase.from('incoming_items').insert(newPayload)
          if (itErr) {
            fail += newPayload.length
            errors.push(`${receipt.vendor_name} ${receipt.sheetName}: 라인 ${itErr.message}`)
          } else {
            ok += newPayload.length
            if (isExisting) mergedCount++
          }
        } else if (isExisting) {
          // 새 라인 0개 = 완전 동일한 파일을 다시 올린 것
          mergedCount++
        }
      }
      // 안내문 추가
      if (mergedCount > 0) errors.unshift(`✓ ${mergedCount}개 입고는 기존 입고에 병합됨 (새 라인만 추가, 중복 스킵 ${skippedCount}건)`)
      setResult({ ok, fail, errors: errors.slice(0, 10) })
      if (ok > 0) onImported()
    } catch (err: any) {
      setResult({ ok, fail: total - ok, errors: [err.message] })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        onChange={handleFile}
        className="hidden"
      />
      <Button variant="secondary" onClick={() => fileRef.current?.click()}>
        📥 엑셀 일괄 등록
      </Button>

      <Drawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setReceipts([]); setResult(null) }}
        title="입고내역서 엑셀 미리보기"
        width="xl"
        footer={
          result ? (
            <Button onClick={() => { setDrawerOpen(false); setReceipts([]); setResult(null) }}>닫기</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => { setDrawerOpen(false); setReceipts([]) }}>취소</Button>
              <Button onClick={doImport} disabled={importing}>
                {importing
                  ? '등록 중…'
                  : `${receipts.reduce((s, r) => s + r.items.length, 0)}건 일괄 등록`}
              </Button>
            </>
          )
        }
      >
        {receipts.length === 0 ? (
          <Empty icon="📦" title="파일을 선택해주세요" />
        ) : (
          <>
            <div className="mb-4 p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-[12px] text-emerald-800">
              <strong>📦 AW 원본 양식 감지됨</strong> — {receipts.length}개 시트.
              거래처가 없으면 자동 생성. 품번이 기존 상품과 일치하면 자동 연결.
            </div>

            <div className="space-y-3">
              {receipts.map((r, idx) => (
                <details key={idx} className="border border-zinc-200 rounded-xl overflow-hidden group">
                  <summary className="px-4 py-3 cursor-pointer hover:bg-zinc-50 flex items-center justify-between list-none">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="text-zinc-400 group-open:rotate-90 transition-transform inline-block">▶</span>
                      <span className="font-semibold text-[13px] text-zinc-900">{r.vendor_name}</span>
                      <Badge color="blue">{r.period || r.sheetName}</Badge>
                      <span className="text-[11px] text-zinc-500">사이즈: {r.sizeLabels.join(', ')}</span>
                    </div>
                    <span className="text-[12px] text-zinc-700 font-medium tabular-nums">
                      {r.items.length}품목 · {r.items.reduce((s, it) => s + it.total, 0).toLocaleString()}장
                    </span>
                  </summary>
                  <div className="px-3 pb-3 overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead className="bg-zinc-50">
                        <tr>
                          <th className="px-2 py-1.5 text-left">품번</th>
                          <th className="px-2 py-1.5 text-left">품목</th>
                          {r.sizeLabels.map(s => (
                            <th key={s} className="px-2 py-1.5 text-right">{s}</th>
                          ))}
                          <th className="px-2 py-1.5 text-right">합계</th>
                          <th className="px-2 py-1.5 text-left">입고일</th>
                          <th className="px-2 py-1.5 text-right">C/T</th>
                        </tr>
                      </thead>
                      <tbody>
                        {r.items.slice(0, 30).map((it, i) => (
                          <tr key={i} className="border-t border-zinc-100">
                            <td className="px-2 py-1 font-mono text-[10px]">{it.product_code}</td>
                            <td className="px-2 py-1">{it.product_name}</td>
                            {r.sizeLabels.map(s => (
                              <td key={s} className="px-2 py-1 text-right tabular-nums">{it.sizes[s] || ''}</td>
                            ))}
                            <td className="px-2 py-1 text-right tabular-nums font-medium">{it.total}</td>
                            <td className="px-2 py-1 text-[10px] text-zinc-500">{it.delivery_date || '—'}</td>
                            <td className="px-2 py-1 text-right tabular-nums text-zinc-500">{it.carton_no ?? '—'}</td>
                          </tr>
                        ))}
                        {r.items.length > 30 && (
                          <tr><td colSpan={4 + r.sizeLabels.length} className="px-2 py-2 text-center text-zinc-500 text-[11px]">… 외 {r.items.length - 30}건</td></tr>
                        )}
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
