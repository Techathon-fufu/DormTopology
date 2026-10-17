import { Zap, ZapOff } from 'lucide-react'
import { isMockMode } from '@/api'
import { useMockPacingStore } from '@/state/mockPacingStore'
import { cn } from '@/lib/utils'

/**
 * 「跳过模拟等待」开关（仅演示模式渲染）：
 * 开启后所有进行中的模拟等待立即完成、后续模拟等待不再计时；
 * 真实后端模式（VITE_API_MODE=real）不经过该模块，控件自动隐藏。
 */
export function FastForwardToggle({
  compact,
  className,
}: {
  compact?: boolean
  className?: string
}) {
  const fast = useMockPacingStore((s) => s.fast)
  const toggle = useMockPacingStore((s) => s.toggle)
  if (!isMockMode) return null
  return (
    <button
      type="button"
      onClick={toggle}
      title="演示用：跳过识别 / 模型生成 / 规划服务的模拟等待时间（不影响真实服务接入后的行为）"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
        fast
          ? 'border-primary/50 bg-primary-soft text-primary'
          : 'border-border text-muted-foreground hover:text-foreground',
        className,
      )}
    >
      {fast ? <Zap className="h-3 w-3" /> : <ZapOff className="h-3 w-3" />}
      {fast ? '演示加速：开' : compact ? '跳过模拟等待' : '跳过模拟等待（演示加速）'}
    </button>
  )
}
