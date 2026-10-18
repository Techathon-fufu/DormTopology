import { Moon, Sun } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppTheme } from '@/ui/theme/useAppTheme'

type ThemeToggleProps = {
  className?: string
  choiceClassName?: string
  ariaLabel?: string
}

export function ThemeToggle({
  className,
  choiceClassName,
  ariaLabel = '页面外观',
}: ThemeToggleProps) {
  const { theme, setTheme } = useAppTheme()

  return (
    <div className={cn('app-theme-toggle', className)} role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className={cn('app-theme-choice', choiceClassName)}
        aria-pressed={theme === 'light'}
        aria-label="日间模式"
        title="日间模式"
        onClick={() => setTheme('light')}
      >
        <Sun className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={cn('app-theme-choice', choiceClassName)}
        aria-pressed={theme === 'dark'}
        aria-label="深夜模式"
        title="深夜模式"
        onClick={() => setTheme('dark')}
      >
        <Moon className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    </div>
  )
}
