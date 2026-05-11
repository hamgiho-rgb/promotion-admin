export default function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-[28px] font-bold tracking-tight text-zinc-900">{title}</h1>
        <p className="text-[14px] text-zinc-600 mt-2">곧 만들어질 페이지예요.</p>
      </div>

      <div className="bg-white border border-dashed border-zinc-300 rounded-2xl p-16 text-center">
        <div className="w-12 h-12 rounded-2xl bg-zinc-100 mx-auto mb-3 flex items-center justify-center text-zinc-400 text-xl">
          ⋯
        </div>
        <p className="text-[14px] font-medium text-zinc-700">준비 중</p>
        <p className="text-[12px] text-zinc-500 mt-1">다음 단계에서 구현됩니다.</p>
      </div>
    </div>
  )
}
