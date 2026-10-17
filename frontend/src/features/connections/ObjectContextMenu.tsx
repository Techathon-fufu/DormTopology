import { useEffect, useRef } from 'react'

export interface ObjectMenuItem {
  label: string
  hint?: string
  onSelect: () => void
  disabled?: boolean
}

/**
 * 物品右键菜单：定位在指针处，点击外部 / Esc / 选择条目都会关闭。
 *
 * 该菜单只提供入口，不做任何写入；具体操作由被选中的条目执行（例如进入表面描点页面）。
 */
export function ObjectContextMenu({
  x,
  y,
  title,
  items,
  onClose,
}: {
  x: number
  y: number
  title?: string
  items: ObjectMenuItem[]
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose])

  const width = 208
  const height = 24 + items.length * 44
  const left = typeof window === 'undefined' ? x : Math.max(8, Math.min(x, window.innerWidth - width - 8))
  const top = typeof window === 'undefined' ? y : Math.max(8, Math.min(y, window.innerHeight - height - 8))

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="物品操作"
      className="fixed z-50 w-52 overflow-hidden rounded-lg border border-border bg-surface p-1 text-xs shadow-lg"
      style={{ left, top }}
    >
      {title ? <p className="truncate px-2 py-1 text-[11px] text-muted-foreground">{title}</p> : null}
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className="flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
          onClick={() => {
            if (item.disabled) return
            item.onSelect()
            onClose()
          }}
        >
          <span className="font-medium">{item.label}</span>
          {item.hint ? <span className="text-[11px] text-muted-foreground">{item.hint}</span> : null}
        </button>
      ))}
    </div>
  )
}
