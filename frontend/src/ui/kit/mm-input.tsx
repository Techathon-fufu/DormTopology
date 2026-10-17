import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { mmToM, mToMm } from '@/lib/units'
import { Input } from './primitives'

interface MmInputProps {
  /** 当前值（米） */
  value: number
  /** 提交回调（米） */
  onChange: (valueM: number) => void
  className?: string
  min?: number
  max?: number
  disabled?: boolean
  label?: string
}

/**
 * 毫米输入框：内部三维值统一为米，表单展示毫米。
 * 输入过程中保留草稿，失焦或回车时换算提交（换算见 @/lib/units）。
 */
export function MmInput({ value, onChange, className, min, max, disabled, label }: MmInputProps) {
  const [draft, setDraft] = useState(() => String(Math.round(mToMm(value))))

  useEffect(() => {
    setDraft(String(Math.round(mToMm(value))))
  }, [value])

  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n)) {
      let mm = n
      if (min !== undefined) mm = Math.max(min, mm)
      if (max !== undefined) mm = Math.min(max, mm)
      onChange(mmToM(mm))
    } else {
      setDraft(String(Math.round(mToMm(value))))
    }
  }

  return (
    <div className={cn('relative', className)}>
      <Input
        className="pr-9 text-right tabular-nums"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            ;(e.target as HTMLInputElement).blur()
          }
        }}
      />
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">
        mm
      </span>
    </div>
  )
}
