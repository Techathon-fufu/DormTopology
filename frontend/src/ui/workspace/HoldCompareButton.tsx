import { useEffect, useRef, useState } from 'react'
import { GitCompareArrows } from 'lucide-react'
import { Button } from '@/ui/kit/button'
import { useOrganizeStore } from '@/state/organizeStore'

export function PreviewCompareButton({ disabled = false }: { disabled?: boolean }) {
  const resume = useRef(false)
  return <HoldCompareButton disabled={disabled} onChange={(held) => {
    const state = useOrganizeStore.getState()
    if (held) {
      resume.current = state.status === 'playing'
      state.setCompare('before')
    } else {
      state.setCompare('after')
      if (resume.current && state.status === 'paused') state.resumePlayback()
      resume.current = false
    }
  }} />
}

/** Transient read-only view; release, cancel, lost capture and window blur all restore it. */
export function HoldCompareButton({ onChange, disabled = false }: { onChange: (held: boolean) => void; disabled?: boolean }) {
  const [held, setHeld] = useState(false)
  const heldRef = useRef(false)
  const callback = useRef(onChange)
  callback.current = onChange
  const change = (value: boolean) => {
    if (heldRef.current === value) return
    heldRef.current = value
    setHeld(value)
    callback.current(value)
  }
  useEffect(() => {
    const release = () => change(false)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)
    return () => {
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
      if (heldRef.current) callback.current(false)
    }
  }, [])
  useEffect(() => { if (disabled) change(false) }, [disabled])
  return <Button size="sm" variant={held ? 'secondary' : 'outline'} disabled={disabled}
    aria-label="按住查看摆放前" aria-pressed={held} className="touch-none select-none"
    onContextMenu={(e) => e.preventDefault()}
    onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); change(true) }}
    onPointerUp={() => change(false)} onPointerCancel={() => change(false)} onLostPointerCapture={() => change(false)} onBlur={() => change(false)}
    onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); change(true) } }}
    onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); change(false) } }}>
    <GitCompareArrows className="h-4 w-4" />{held ? '松开返回' : '按住看摆放前'}
  </Button>
}
