import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
export type ProjectStepKey = 'setup' | 'import' | 'workspace' | 'guide'
export function ProjectSteps({ projectId, current, className }: { projectId: string; current: ProjectStepKey; className?: string }) {
  const creating = current === 'setup' || current === 'import'
  const steps = creating
    ? [{ key: 'setup', label: '确认空间', suffix: 'setup' }, { key: 'import', label: '添加物品', suffix: 'import' }]
    : [{ key: 'workspace', label: '工作台', suffix: 'workspace' }, { key: 'guide', label: '整理动画', suffix: 'result' }]
  return <nav aria-label={creating ? '创建项目' : '项目页面'} className={cn('flex items-center gap-1', className)}>
    {steps.map((step) => <Link key={step.key} to={`/projects/${projectId}/${step.suffix}`} aria-current={step.key === current ? 'step' : undefined}
      className={cn('whitespace-nowrap rounded-lg px-3 py-2 text-xs', step.key === current ? 'bg-primary-soft font-medium text-primary' : 'text-muted-foreground hover:bg-muted')}>
      {step.label}
    </Link>)}
  </nav>
}
