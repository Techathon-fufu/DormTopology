import { useEffect, useRef, useState, type ReactNode } from 'react'

/** Native details semantics with outside-click and Escape dismissal. */
export function Dropdown({ children, className }: { children: ReactNode; className?: string }) {
  const root = useRef<HTMLDetailsElement>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && root.current) root.current.open = false
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !root.current?.open) return
      event.preventDefault()
      root.current.open = false
      root.current.querySelector('summary')?.focus()
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', escape) }
  }, [open])
  return (
    <details
      ref={root}
      className={className}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button,a') && root.current) {
          root.current.open = false
        }
      }}
    >
      {children}
    </details>
  )
}
