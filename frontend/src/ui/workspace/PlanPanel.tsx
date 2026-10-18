import { History, Save, X } from 'lucide-react'
import type { LayoutPlan, Project } from '@/types/project'
import { usePlansStore } from '@/state/plansStore'
import { useProjectsStore } from '@/state/projectsStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/kit/button'

const EMPTY_PLANS: LayoutPlan[] = []

/** Saved scene snapshots remain available without making metric comparison part of the main flow. */
export function PlanPanel({ project, onFlash, className, onClose }: {
  project: Project
  onFlash: (msg: string) => void
  className?: string
  onClose?: () => void
}) {
  const candidates = usePlansStore((s) => s.candidates[project.id] ?? EMPTY_PLANS)
  const saveCandidate = usePlansStore((s) => s.saveCandidate)
  const previewBlocking = useOrganizeStore((s) => s.isPreviewBlocking())

  const save = () => {
    const current = useProjectsStore.getState().projects[project.id]
    if (!current) return
    const plan = saveCandidate(current)
    onFlash(`已保存「${plan.name}」`)
  }

  const restore = (plan: LayoutPlan) => {
    if (useOrganizeStore.getState().isPreviewBlocking()) {
      onFlash('请先接受或取消当前整理预览，再恢复历史方案。')
      return
    }
    try {
      const summary = useWorkspaceStore.getState().applyPlanSnapshot(project.id, plan)
      if (!summary) return
      onFlash(summary.legacy
        ? `已恢复「${plan.name}」的物品位置；旧方案没有线缆快照，走线需要重算。可撤销。`
        : `已恢复「${plan.name}」的布局与线缆。可撤销。`)
    } catch (error) {
      onFlash(error instanceof Error ? error.message : String(error))
    }
  }

  return <aside aria-label="历史方案" className={cn('flex min-h-0 flex-col border-border bg-surface', className)}>
    <header className="flex items-center justify-between border-b border-border px-4 py-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4 text-primary" />历史方案</h2>
      {onClose ? <Button variant="ghost" size="icon" aria-label="关闭历史方案" onClick={onClose}><X className="h-4 w-4" /></Button> : null}
    </header>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
      <Button size="sm" variant="outline" className="w-full" disabled={previewBlocking} onClick={save}><Save className="h-4 w-4" />保存当前方案</Button>
      {candidates.length === 0 ? <p className="rounded-lg border border-dashed border-border p-4 text-xs leading-5 text-muted-foreground">还没有历史方案。调整好布局后，可以保存一份供以后恢复。</p> : null}
      {[...candidates].sort((a, b) => b.createdAt - a.createdAt).map((plan) => <div key={plan.id} className="rounded-lg border border-border p-3">
        <p className="truncate text-sm font-medium" title={plan.name}>{plan.name}</p>
        <p className="mt-1 text-xs text-muted-foreground">{new Date(plan.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}{project.lastAppliedPlan?.planId === plan.id ? ' · 当前方案' : ''}</p>
        <Button size="sm" variant="ghost" className="mt-2 w-full" disabled={previewBlocking} onClick={() => restore(plan)}>恢复此方案</Button>
      </div>)}
    </div>
  </aside>
}
