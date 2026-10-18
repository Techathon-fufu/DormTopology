import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
export type ProjectStepKey = 'setup' | 'import' | 'workspace' | 'guide'

const STEPS: Array<{ key: ProjectStepKey; label: string; suffix: string }> = [
  { key: 'setup', label: '项目与空间', suffix: 'setup' },
  { key: 'import', label: '照片与物品', suffix: 'import' },
]

/** 创建项目只包含空间与物品两段；工作台和结果页属于项目本身。 */
export function ProjectSteps({
  projectId,
  current,
  className,
}: {
  projectId: string
  current: ProjectStepKey
  className?: string
}) {
  if (current === 'workspace' || current === 'guide') return null

  return (
    <nav aria-label="创建项目" className={cn('flex items-center gap-1', className)}>
      {STEPS.map((s, i) => (
        <Link
          key={s.key}
          to={`/projects/${projectId}/${s.suffix}`}
          aria-current={s.key === current ? 'step' : undefined}
          className={cn(
            'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-2 text-xs transition-colors',
            s.key === current
              ? 'bg-primary-soft font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current/20 text-[10px]">{i + 1}</span>{s.label}
        </Link>
      ))}
    </nav>
  )
}
