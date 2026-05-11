import { useState } from 'react'

// 자주 쓰는 사이즈 프리셋
const PRESETS = [
 {
 name: '아동복 (110~170)',
 sizes: ['110', '120', '130', '140', '150', '160', '170'],
 },
 {
 name: '아동복 전체 (90~180)',
 sizes: ['90', '100', '110', '120', '130', '140', '150', '160', '170', '180'],
 },
 {
 name: '성인 영문 (S/M/L)',
 sizes: ['S', 'M', 'L', 'XL'],
 },
 {
 name: '성인 영문 전체',
 sizes: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'],
 },
 {
 name: '번호 (1, 2)',
 sizes: ['1', '2'],
 },
 {
 name: '번호 (1~5)',
 sizes: ['1', '2', '3', '4', '5'],
 },
 {
 name: '프리 (Free)',
 sizes: ['FREE'],
 },
]

interface Props {
 value: string[]
 onChange: (sizes: string[]) => void
}

export default function SizePicker({ value, onChange }: Props) {
 const [customInput, setCustomInput] = useState('')

 function toggleSize(size: string) {
 if (value.includes(size)) {
 onChange(value.filter(s => s !== size))
 } else {
 onChange([...value, size])
 }
 }

 function applyPreset(preset: string[]) {
 // 기존 사이즈 + 프리셋 사이즈 (중복 제거, 순서 유지)
 const merged = [...value]
 preset.forEach(s => { if (!merged.includes(s)) merged.push(s) })
 onChange(merged)
 }

 function replaceWithPreset(preset: string[]) {
 onChange([...preset])
 }

 function addCustom() {
 const v = customInput.trim()
 if (!v) return
 if (value.includes(v)) { setCustomInput(''); return }
 onChange([...value, v])
 setCustomInput('')
 }

 function removeSize(s: string) {
 onChange(value.filter(x => x !== s))
 }

 function moveSize(s: string, direction: -1 | 1) {
 const idx = value.indexOf(s)
 if (idx === -1) return
 const newIdx = idx + direction
 if (newIdx < 0 || newIdx >= value.length) return
 const arr = [...value]
 ;[arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]]
 onChange(arr)
 }

 return (
 <div className="space-y-3">
 {/* 선택된 사이즈 */}
 <div>
 <p className="text-[11px] font-medium text-zinc-700 mb-1.5">
 선택된 사이즈 ({value.length}개)
 </p>
 {value.length === 0 ? (
 <div className="p-3 border border-dashed border-zinc-300 rounded-lg text-center text-[12px] text-zinc-400">
 아직 선택된 사이즈가 없어요. 아래에서 선택해주세요.
 </div>
 ) : (
 <div className="flex flex-wrap gap-1.5 p-2.5 bg-white border border-zinc-200 rounded-lg">
 {value.map((s, i) => (
 <span key={s} className="group inline-flex items-center gap-1 px-2 py-1 bg-zinc-900 text-white rounded-md text-[12px] font-medium">
 <button type="button" onClick={() => moveSize(s, -1)} disabled={i === 0} className="opacity-50 hover:opacity-100 disabled:opacity-20" title="앞으로">‹</button>
 <span>{s}</span>
 <button type="button" onClick={() => moveSize(s, 1)} disabled={i === value.length - 1} className="opacity-50 hover:opacity-100 disabled:opacity-20" title="뒤로">›</button>
 <button type="button" onClick={() => removeSize(s)} className="ml-0.5 opacity-60 hover:opacity-100 hover:text-rose-300" title="제거">×</button>
 </span>
 ))}
 <button
 type="button"
 onClick={() => onChange([])}
 className="ml-auto px-2 py-1 text-[11px] text-zinc-500 hover:text-rose-600"
 >
 전체 비우기
 </button>
 </div>
 )}
 </div>

 {/* 빠른 추가 (프리셋) */}
 <div>
 <p className="text-[11px] font-medium text-zinc-700 mb-1.5">빠른 추가</p>
 <div className="space-y-2">
 {PRESETS.map(preset => (
 <div key={preset.name} className="flex items-center gap-2 p-2 bg-white border border-zinc-200 rounded-lg">
 <span className="text-[11px] font-medium text-zinc-600 w-40 flex-shrink-0">{preset.name}</span>
 <div className="flex flex-wrap gap-1 flex-1">
 {preset.sizes.map(s => {
 const active = value.includes(s)
 return (
 <button
 key={s}
 type="button"
 onClick={() => toggleSize(s)}
 className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
 active
 ? 'bg-zinc-900 text-white'
 : 'bg-zinc-100 text-zinc-700 hover:bg-zinc-200'
 }`}
 >
 {s}
 </button>
 )
 })}
 </div>
 <button
 type="button"
 onClick={() => replaceWithPreset(preset.sizes)}
 className="text-[11px] text-zinc-500 hover:text-zinc-900 whitespace-nowrap"
 title="이 프리셋으로 덮어쓰기"
 >
 이것만 →
 </button>
 </div>
 ))}
 </div>
 </div>

 {/* 직접 추가 */}
 <div>
 <p className="text-[11px] font-medium text-zinc-700 mb-1.5">직접 추가</p>
 <div className="flex gap-2">
 <input
 type="text"
 value={customInput}
 onChange={e => setCustomInput(e.target.value)}
 onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
 className="flex-1 px-3 py-2 text-[13px] bg-white border border-zinc-200 rounded-lg outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
 />
 <button
 type="button"
 onClick={addCustom}
 className="px-4 py-2 text-[13px] font-medium bg-zinc-900 text-white rounded-lg hover:bg-zinc-800"
 >
 추가
 </button>
 </div>
 <p className="text-[11px] text-zinc-400 mt-1">엔터 키로도 추가할 수 있어요.</p>
 </div>
 </div>
 )
}
