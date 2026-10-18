import { AlertTriangle, ChevronDown, Loader2, RotateCcw } from 'lucide-react'
import { useDeskModelStore } from '@/state/deskModelStore'
import { Button } from '@/ui/kit/button'

/** Asset diagnostics stay available without covering the scene by default. */
export function DeskModelNotice() {
  const status = useDeskModelStore((s) => s.status)
  const error = useDeskModelStore((s) => s.error)
  const showDesk = useDeskModelStore((s) => s.showDesk)
  const retry = useDeskModelStore((s) => s.retry)
  if (!showDesk || status === 'idle' || status === 'loaded') return null
  if (status === 'loading') return <div role="status" className="pointer-events-none absolute right-3 top-3 flex items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-xs"><Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />正在载入桌体</div>
  return (
    <details className="group absolute right-3 top-3 z-20 text-xs">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-muted-foreground shadow-xs [&::-webkit-details-marker]:hidden">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" />简化桌体<ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 top-11 w-72 max-w-[calc(100vw-32px)] space-y-3 rounded-xl border border-border bg-surface p-4 shadow-overlay">
        <div><p className="font-semibold text-foreground">正在使用简化外观</p><p className="mt-1.5 leading-relaxed text-muted-foreground">桌体模型暂不可用，临时显示同一模型的简化外观，请重新加载。</p></div>
        {error && status === 'failed' ? <details className="rounded-lg bg-muted/60 p-2"><summary className="cursor-pointer text-muted-foreground">查看加载原因</summary><p className="mt-2 break-words leading-relaxed">{error}</p></details> : null}
        <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={retry}><RotateCcw className="h-3.5 w-3.5" />重新加载</Button></div>
      </div>
    </details>
  )
}
