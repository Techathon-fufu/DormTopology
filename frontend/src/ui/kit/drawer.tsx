import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Responsive panel with keyboard focus containment and return to its trigger. */
export function Drawer({ open, side, onClose, children, className }: {
  open: boolean
  side: 'left' | 'right'
  onClose: () => void
  children: ReactNode
  className?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0)
    const first = focusable()[0]
    ;(first ?? panel.current)?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); return }
      if (event.key !== 'Tab') return
      const items = focusable()
      const current = document.activeElement
      if (items.length === 0) { event.preventDefault(); panel.current?.focus(); return }
      if (event.shiftKey && (current === items[0] || current === panel.current)) { event.preventDefault(); items[items.length - 1].focus() }
      else if (!event.shiftKey && current === items[items.length - 1]) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { document.removeEventListener('keydown', keydown, true); if (trigger?.isConnected) trigger.focus() }
  }, [open])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label={side === 'left' ? '物品与线缆面板' : '属性与方案面板'}>
      <div className="absolute inset-0 bg-foreground/25" onClick={onClose} aria-hidden />
      <div ref={panel} tabIndex={-1} className={cn('absolute bottom-0 top-0 flex bg-surface shadow-overlay outline-none',side === 'left' ? 'left-0 border-r border-border' : 'right-0 border-l border-border', className)}>{children}</div>
    </div>
  )
}
