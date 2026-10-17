import { hasRealServices, setApiModeOverride } from '@/api'
import { Button } from '@/ui/kit/button'
import { cn } from '@/lib/utils'

/**
 * 「切换到演示模式」入口：真实后端不可用时的降级出口（显式操作，不自动降级）。
 * 写入 localStorage 后刷新页面生效（刷新后仍保持，可随时恢复真实模式）。
 */
export function SwitchToDemoButton({ className }: { className?: string }) {
  if (!hasRealServices) return null
  return (
    <Button
      variant="outline"
      size="sm"
      className={cn('h-6 px-2 text-[11px]', className)}
      title="切换到演示模式：识别 / 模型生成 / 规划改用本地模拟服务；可随时在服务菜单恢复真实模式"
      onClick={() => {
        setApiModeOverride('mock')
        if (typeof window !== 'undefined') window.location.reload()
      }}
    >
      切换到演示模式
    </Button>
  )
}
