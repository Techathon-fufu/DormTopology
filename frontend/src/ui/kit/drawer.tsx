import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * 小屏幕抽屉容器：窄屏下侧面板收进抽屉，通过遮罩 / 关闭按钮收起，
 * 顶部工具栏保留打开按钮，主要操作不被遮挡。
 */
export function Drawer({
  open,
  side,
  onClose,
  children,
  className,
}: {
  open: boolean
  side: 'left' | 'right'
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-foreground/25" onClick={onClose} aria-hidden />
      <div
        className={cn(
          'absolute bottom-0 top-0 flex shadow-xl',
          side === 'left' ? 'left-0' : 'right-0',
          className,
        )}
      >
        {children}
      </div>
    </div>
  )
}
