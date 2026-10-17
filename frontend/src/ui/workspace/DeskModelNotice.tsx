import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { useDeskModelStore } from '@/state/deskModelStore'
import { Button } from '@/ui/kit/button'

/**
 * 桌体模型状态提示（视口右下角浮层）：
 * - 加载中：轻提示（不遮挡操作）；
 * - 加载失败：可读原因 + 「重试」/「改用简化几何」（回退参数化桌体，演示仍可继续）；
 * - 已选择简化几何：提供「尝试加载模型」入口。
 * 加载成功且正常显示时不渲染。
 */
export function DeskModelNotice() {
  const status = useDeskModelStore((s) => s.status)
  const error = useDeskModelStore((s) => s.error)
  const showDesk = useDeskModelStore((s) => s.showDesk)
  const retry = useDeskModelStore((s) => s.retry)
  const useSimplifiedDesk = useDeskModelStore((s) => s.useSimplifiedDesk)

  if (!showDesk || status === 'idle' || status === 'loaded') return null

  if (status === 'loading') {
    return (
      <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-1.5 text-xs shadow-sm">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        桌体模型加载中（dorm_desk_assembled.glb）…
      </div>
    )
  }

  if (status === 'skipped') {
    return (
      <div className="absolute bottom-3 right-3 flex max-w-xs flex-col gap-2 rounded-lg border border-border bg-surface/95 px-3 py-2 text-xs shadow-sm">
        <span className="leading-relaxed text-muted-foreground">
          当前使用参数化简化桌体（已按你的选择跳过 GLB 模型加载）。
        </span>
        <Button size="sm" variant="outline" className="h-7 self-start px-2 text-xs" onClick={retry}>
          <RotateCcw className="h-3 w-3" />
          尝试加载模型
        </Button>
      </div>
    )
  }

  // status === 'failed'
  return (
    <div className="absolute bottom-3 right-3 flex max-w-xs flex-col gap-2 rounded-lg border border-warning/40 bg-surface/95 px-3 py-2 text-xs shadow-sm">
      <span className="flex items-center gap-1.5 font-medium text-warning">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        桌体模型加载失败，已回退到参数化简化桌体
      </span>
      <span className="leading-relaxed text-muted-foreground">{error}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={retry}>
          重试
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={useSimplifiedDesk}>
          改用简化几何
        </Button>
      </div>
    </div>
  )
}
