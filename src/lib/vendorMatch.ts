import type { Vendor } from './types'

/* ─────────────────────────────────────────────
 * 거래처 이름 정규화 + 유사 매칭
 * Excel import 등에서 "마요네즈" / "주식회사마요네즈" / "단델(마요네즈)" 등이
 * 같은 거래처로 매칭되도록 함 → 중복 거래처 자동 생성 방지
 * ───────────────────────────────────────────── */

/** 회사 접두/접미사 제거 + 공백/특수문자 정리 → 소문자 */
export function normalizeVendorName(raw: string): string {
  if (!raw) return ''
  let s = String(raw).trim()
  // 흔한 회사 접두/접미사 제거
  s = s
    .replace(/주식회사/g, '')
    .replace(/유한회사/g, '')
    .replace(/합자회사/g, '')
    .replace(/\(주\)/g, '')
    .replace(/㈜/g, '')
    .replace(/주\)/g, '')
    .replace(/\(유\)/g, '')
    .replace(/\(합\)/g, '')
    .replace(/co\.,?\s*ltd\.?/gi, '')
    .replace(/corp\.?/gi, '')
    .replace(/inc\.?/gi, '')
  // 공백·특수문자 제거
  s = s.replace(/[\s\-_·.·,/\\]+/g, '')
  return s.toLowerCase()
}

/**
 * 입력 이름에서 매칭 후보 추출:
 * "단델(마요네즈)" → ["단델", "마요네즈"]  (괄호 안과 밖 모두 후보)
 * "주식회사마요네즈" → ["주식회사마요네즈"] (정규화 시 "마요네즈"가 됨)
 * "마요네즈" → ["마요네즈"]
 */
export function extractNameCandidates(raw: string): string[] {
  if (!raw) return []
  const s = String(raw).trim()
  const candidates = new Set<string>()
  candidates.add(s)

  // 괄호 안 추출
  const inside = [...s.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim()).filter(Boolean)
  inside.forEach(c => candidates.add(c))

  // 괄호 밖만
  const outside = s.replace(/\([^)]*\)/g, '').trim()
  if (outside) candidates.add(outside)

  return Array.from(candidates).filter(Boolean)
}

/**
 * 거래처 목록에서 fuzzy 매칭으로 찾기.
 * - 정규화된 이름으로 정확 일치
 * - 거래처의 name 또는 company_name 둘 다 후보 풀로 사용
 *
 * 반환: 매칭된 Vendor 또는 null
 */
export function findVendorByFuzzyName(
  rawName: string,
  vendors: Vendor[],
  vendorType?: 'customer' | 'supplier'
): Vendor | null {
  if (!rawName) return null
  const candidates = extractNameCandidates(rawName).map(normalizeVendorName).filter(Boolean)
  if (candidates.length === 0) return null

  // 거래처 후보 풀 (이름 + 회사명 둘 다 등록)
  type Entry = { norm: string; vendor: Vendor }
  const pool: Entry[] = []
  vendors.forEach(v => {
    if (vendorType && v.vendor_type !== vendorType) return
    const n1 = normalizeVendorName(v.name)
    if (n1) pool.push({ norm: n1, vendor: v })
    const cn = (v as any).company_name as string | undefined
    if (cn) {
      const n2 = normalizeVendorName(cn)
      if (n2 && n2 !== n1) pool.push({ norm: n2, vendor: v })
    }
  })

  // 정확 매칭 우선
  for (const c of candidates) {
    const hit = pool.find(p => p.norm === c)
    if (hit) return hit.vendor
  }
  // 부분 포함 (한쪽이 다른쪽을 포함) — 안전하게 6자 이상일 때만
  for (const c of candidates) {
    if (c.length < 4) continue  // 너무 짧은 매칭은 오인식 위험
    const hit = pool.find(p => p.norm.length >= 4 && (p.norm.includes(c) || c.includes(p.norm)))
    if (hit) return hit.vendor
  }
  return null
}

/**
 * 중복 의심 거래처 그룹 검출.
 * 정규화된 이름이 같거나 후보가 겹치면 같은 그룹으로 묶음.
 *
 * 반환: 그룹 배열. 각 그룹은 같은 회사로 의심되는 거래처들의 묶음.
 *      vendor 1개짜리 그룹은 결과에서 제외 (중복 의심만 반환).
 */
export function findDuplicateGroups(vendors: Vendor[]): Vendor[][] {
  // 각 거래처의 후보 정규화 키 모음
  const vendorKeys = new Map<string, Set<string>>()  // vendor.id -> set of normalized keys
  vendors.forEach(v => {
    const keys = new Set<string>()
    extractNameCandidates(v.name).forEach(c => {
      const k = normalizeVendorName(c)
      if (k && k.length >= 2) keys.add(k)
    })
    const cn = (v as any).company_name as string | undefined
    if (cn) {
      extractNameCandidates(cn).forEach(c => {
        const k = normalizeVendorName(c)
        if (k && k.length >= 2) keys.add(k)
      })
    }
    vendorKeys.set(v.id, keys)
  })

  // Union-Find 비슷한 방식: 같은 키 공유하는 거래처를 한 그룹으로
  const parent = new Map<string, string>()
  vendors.forEach(v => parent.set(v.id, v.id))
  function find(x: string): string {
    let p = parent.get(x)!
    while (p !== x) { x = p; p = parent.get(x)! }
    return p
  }
  function union(a: string, b: string) {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  // 각 키에 어떤 vendor들이 매핑되는지 만든 후 같은 그룹으로 union
  const keyToVendors = new Map<string, string[]>()
  vendorKeys.forEach((keys, vid) => {
    keys.forEach(k => {
      if (!keyToVendors.has(k)) keyToVendors.set(k, [])
      keyToVendors.get(k)!.push(vid)
    })
  })
  keyToVendors.forEach(vids => {
    if (vids.length < 2) return
    for (let i = 1; i < vids.length; i++) union(vids[0], vids[i])
  })

  // 그룹별로 묶기
  const groupsMap = new Map<string, Vendor[]>()
  vendors.forEach(v => {
    const root = find(v.id)
    if (!groupsMap.has(root)) groupsMap.set(root, [])
    groupsMap.get(root)!.push(v)
  })

  // 2개 이상인 그룹만 반환
  return Array.from(groupsMap.values()).filter(g => g.length >= 2)
}

/**
 * Import 도우미 — 이름으로 거래처 찾거나, 없으면 새로 만들기.
 * vendorByName 캐시를 같이 받아서 같은 import 작업 안에서 중복 호출 방지.
 *
 * 반환: { vendor, created: boolean } 또는 null(실패)
 */
export async function getOrCreateVendor(
  supabase: any,
  rawName: string,
  vendorType: 'customer' | 'supplier',
  vendorsList: Vendor[],
  extraFields: Record<string, any> = {}
): Promise<{ vendor: Vendor; created: boolean } | null> {
  if (!rawName?.trim()) return null

  // fuzzy 매칭 시도
  const matched = findVendorByFuzzyName(rawName, vendorsList, vendorType)
  if (matched) return { vendor: matched, created: false }

  // 새로 생성
  const payload = {
    name: rawName.trim(),
    vendor_type: vendorType,
    ...extraFields,
  }
  const { data, error } = await supabase.from('vendors').insert(payload).select().single()
  if (error) return null
  return { vendor: data as Vendor, created: true }
}
