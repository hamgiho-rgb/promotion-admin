import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '@/lib/supabase'
import { Button, Drawer, Badge, Empty } from '@/components/ui'
import { isCostSheetFormat, parseCostWorkbook, type CostSheet } from '@/lib/costSheetImport'
import { findVendorByFuzzyName } from '@/lib/vendorMatch'
import type { Vendor } from '@/lib/types'

/* ─────────────────────────────────────────────
 * 원가계산서 엑셀 일괄 등록 버튼
 * 자동 감지: STORE/PRICE/YARD 헤더 양식 (ex: 2026SS원가계산서)
 *   - 시트마다 한 상품 (NUMBER 행에서 상품번호 추출)
 *   - 각 행이 cost_item (공급처/재료명/단가/요척)
 * 처리:
 *   - 상품번호 → product_id 매칭 (없으면 라인 스킵)
 *   - 공급처명 → supplier vendor fuzzy 매칭 (없으면 자동 생성)
 *   - 기존 cost_items 있으면 덮어쓰기 옵션
 * ───────────────────────────────────────────── */

export default function CostImportButton({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [sheets, setSheets] = useState<CostSheet[]>([])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [overwriteMode, setOverwriteMode] = useState(true)
  const [result, setResult] = useState<{ ok: number; fail: number; notFound: string[]; errors: string[] } | null>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array', cellDates: true })
        if (!isCostSheetFormat(wb)) {
          alert('원가계산서 양식이 아닙니다.\n(시트 안에 STORE / PRICE / YARD 헤더가 있어야 합니다)')
          if (fileRef.current) fileRef.current.value = ''
          return
        }
        const parsed = parseCostWorkbook(wb)
        setSheets(parsed)
        setDrawerOpen(true)
        setResult(null)
      } catch (err: any) {
        alert('파일 읽기 실패: ' + err.message)
      }
      if (fileRef.current) fileRef.current.value = ''
    }
    reader.readAsArrayBuffer(file)
  }

  async function handleImport() {
    if (sheets.length === 0) return
    const totalLines = sheets.reduce((s, sh) => s + sh.lines.length, 0)
    if (!confirm(`${sheets.length}개 시트 / 총 ${totalLines}개 원가 항목을 등록할까요?\n${overwriteMode ? '⚠ 같은 상품의 기존 원가 항목은 모두 삭제 후 새로 등록됩니다.' : '기존 항목 유지하고 추가만 합니다.'}`)) return

    setImporting(true)
    let ok = 0, fail = 0
    const notFound: string[] = []
    const errors: string[] = []

    try {
      // 카탈로그 로드 — code/name/name_en 다 매칭 인덱스로
      const { data: products } = await supabase.from('products').select('id, code, name, name_en, vendor_id').is('deleted_at', null)
      const { data: vendors } = await supabase.from('vendors').select('*').eq('vendor_type', 'supplier')
      const productByCode = new Map<string, string>()
      const productByName = new Map<string, string>()
      ;(products ?? []).forEach((p: any) => {
        if (p.code) productByCode.set(String(p.code).trim().toLowerCase(), p.id)
        if (p.name) productByName.set(String(p.name).trim().toLowerCase(), p.id)
        if (p.name_en) productByName.set(String(p.name_en).trim().toLowerCase(), p.id)
      })

      const vendorsList: Vendor[] = (vendors ?? []) as Vendor[]
      const cachedNew: Vendor[] = []

      for (const sheet of sheets) {
        // 매칭 시도: 1) 상품번호 → 2) 상품명(한) → 3) 영문 스타일명
        let pid: string | undefined
        if (sheet.product_code) pid = productByCode.get(sheet.product_code.trim().toLowerCase())
        if (!pid && sheet.product_name) pid = productByName.get(sheet.product_name.trim().toLowerCase())
        if (!pid && sheet.style_name) pid = productByName.get(sheet.style_name.trim().toLowerCase())
        if (!pid) {
          const label = sheet.product_code || sheet.product_name || sheet.style_name || sheet.sheetName
          notFound.push(`${label} (시트: ${sheet.sheetName})`)
          fail += sheet.lines.length
          continue
        }

        // overwrite 모드면 기존 cost_items 삭제
        if (overwriteMode) {
          await supabase.from('cost_items').delete().eq('product_id', pid)
        }

        // 라인별 처리
        const payload: any[] = []
        for (let i = 0; i < sheet.lines.length; i++) {
          const l = sheet.lines[i]
          // 공급처 fuzzy 매칭
          let supplier_id: string | null = null
          if (l.store) {
            const matched = findVendorByFuzzyName(l.store, [...vendorsList, ...cachedNew], 'supplier')
            if (matched) {
              supplier_id = matched.id
            } else {
              // 자동 생성
              const { data: newV } = await supabase.from('vendors').insert({
                name: l.store, vendor_type: 'supplier', size_system: [],
              }).select().single()
              if (newV) { supplier_id = newV.id; cachedNew.push(newV as Vendor) }
            }
          }
          payload.push({
            product_id: pid,
            supplier_id,
            item_name: l.item_name,
            unit_price: l.unit_price,
            yards: l.yards,
            sort_order: i,
          })
        }
        const { error } = await supabase.from('cost_items').insert(payload)
        if (error) { fail += payload.length; errors.push(`${sheet.product_code}: ${error.message}`) }
        else ok += payload.length
      }

      setResult({ ok, fail, notFound, errors: errors.slice(0, 5) })
      if (ok > 0) onImported()
    } catch (err: any) {
      setResult({ ok, fail, notFound, errors: [err.message] })
    } finally {
      setImporting(false)
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={handleFile} className="hidden" />
      <Button variant="secondary" onClick={() => fileRef.current?.click()}>📥 엑셀 일괄 등록</Button>

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title="원가계산서 일괄 등록 — 미리보기"
        width="lg"
        footer={
          result ? <Button onClick={() => { setDrawerOpen(false); setSheets([]); setResult(null) }}>닫기</Button>
          : <>
            <label className="flex items-center gap-2 mr-auto text-[12px] cursor-pointer">
              <input type="checkbox" checked={overwriteMode} onChange={e => setOverwriteMode(e.target.checked)} />
              <span>덮어쓰기 (같은 상품의 기존 원가 모두 삭제 후 등록)</span>
            </label>
            <Button variant="secondary" onClick={() => { setDrawerOpen(false); setSheets([]) }}>취소</Button>
            <Button onClick={handleImport} disabled={importing || sheets.length === 0}>
              {importing ? '등록 중...' : `등록 (${sheets.length}개 상품)`}
            </Button>
          </>
        }
      >
        {result ? (
          <div className="space-y-3">
            <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200">
              <p className="text-[14px] font-semibold text-emerald-800">✓ {result.ok}개 항목 등록 완료</p>
              {result.fail > 0 && <p className="text-[12px] text-rose-700 mt-1">⚠ {result.fail}개 실패</p>}
            </div>
            {result.notFound.length > 0 && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                <p className="text-[12px] font-semibold text-amber-800 mb-2">⚠ 상품 카탈로그에 없는 품번 {result.notFound.length}개 (건너뜀):</p>
                <ul className="text-[11px] text-amber-700 list-disc list-inside max-h-40 overflow-y-auto">
                  {result.notFound.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
                <p className="text-[11px] text-amber-700 mt-2">→ 상품 페이지에서 이 품번을 먼저 등록한 후 다시 import하세요.</p>
              </div>
            )}
            {result.errors.length > 0 && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-[11px]">
                {result.errors.map((e, i) => <div key={i}>{e}</div>)}
              </div>
            )}
          </div>
        ) : sheets.length === 0 ? (
          <Empty icon="📄" title="파일을 선택해주세요" />
        ) : (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-[12px] text-blue-900">
              💡 {sheets.length}개 시트(상품) 감지됨. 각 시트의 NUMBER 행에서 상품번호 자동 인식. 공급처는 fuzzy 매칭.
            </div>
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {sheets.map((s, i) => (
                <div key={i} className="border border-zinc-200 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge color="violet">{s.sheetName}</Badge>
                    <span className="font-mono text-[12px] font-semibold">{s.product_code}</span>
                    {s.style_name && <span className="text-[11px] text-zinc-500">· {s.style_name}</span>}
                    <span className="text-[10px] text-zinc-400 ml-auto">{s.lines.length}개 항목</span>
                  </div>
                  <table className="w-full text-[11px]">
                    <thead className="bg-zinc-50">
                      <tr>
                        <th className="px-2 py-1 text-left">공급처</th>
                        <th className="px-2 py-1 text-left">재료/공정</th>
                        <th className="px-2 py-1 text-right w-20">단가</th>
                        <th className="px-2 py-1 text-right w-16">요척</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.lines.slice(0, 8).map((l, li) => (
                        <tr key={li} className="border-t border-zinc-100">
                          <td className="px-2 py-1">{l.store}</td>
                          <td className="px-2 py-1">{l.item_name}</td>
                          <td className="px-2 py-1 text-right tabular-nums">₩{l.unit_price.toLocaleString()}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{l.yards}</td>
                        </tr>
                      ))}
                      {s.lines.length > 8 && (
                        <tr><td colSpan={4} className="px-2 py-1 text-center text-zinc-400">... 외 {s.lines.length - 8}건</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>
    </>
  )
}
