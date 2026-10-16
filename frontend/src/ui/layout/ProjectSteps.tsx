import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

export type ProjectStepKey = 'setup' | 'import' | 'workspace' | 'guide'

const STEPS: Array<{ key: ProjectStepKey; label: string; suffix: string }> = [
  { key: 'setup', label: '空间配置', suffix: 'setup' },
  { key: 'import', label: '照片与物品', suffix: 'import' },
  { key: 'workspace', label: '三维工作台', suffix: 'workspace' },
  { key: 'guide', label: '方案交付', suffix: 'guide' },
]

/** 项目内步骤导航：① 空间配置 ② 照片与物品 ③ 三维工作台 ④ 方案交付（点击可跳转） */
export function ProjectSteps({
  projectId,
  current,
  className,
}: {
  projectId: string
  current: ProjectStepKey
  className?: string
}) {
  return (
    <nav className={cn('flex items-center gap-1', className)}>
      {STEPS.map((s) => (
        <Link
          key={s.key}
          to={`/projects/${projectId}/${s.suffix}`}
          className={cn(
            'rounded-full px-3 py-1 text-[13px] transition-colors',
            s.key === current
              ? 'bg-primary-soft font-medium text-primary'
              : 'text-muted-foreground hover:bg-muted',
          )}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  )
}
