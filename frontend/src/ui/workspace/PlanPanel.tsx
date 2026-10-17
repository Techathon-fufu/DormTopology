import { History, Save, X } from 'lucide-react'
import type { Project } from '@/types/project'
import { usePlansStore } from '@/state/plansStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { Button } from '@/ui/kit/button'
import { cn, formatDateTime } from '@/lib/utils'

export function PlanPanel({ project, onFlash, onClose, className }: { project: Project; onFlash: (message: string) => void; onClose?: () => void; className?: string }) {
  const candidates = usePlansStore((s) => s.candidates[project.id]) ?? []
  const blocked = useOrganizeStore((s) => s.isPreviewBlocking())
  return <aside className={cn('flex min-h-0 flex-col bg-surface', className)}>
    <header className="flex items-center justify-between border-b p-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" />历史方案</h2>{onClose && <Button size="icon" variant="ghost" aria-label="关闭历史方案" onClick={onClose}><X className="h-4 w-4" /></Button>}</header>
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <Button className="w-full" size="sm" variant="outline" disabled={blocked} onClick={() => { usePlansStore.getState().saveCandidate(project); onFlash('已保存当前摆放与线缆') }}><Save className="h-4 w-4" />保存当前方案</Button>
      {!candidates.length && <p className="py-4 text-xs leading-6 text-muted-foreground">还没有历史方案。保存后可随时恢复。</p>}
      {candidates.map((plan) => <section key={plan.id} className="space-y-2 rounded-lg border p-3"><h3 className="break-words text-sm font-medium">{plan.name}</h3><p className="text-xs text-muted-foreground">{formatDateTime(plan.createdAt)}</p><Button variant="outline" size="sm" disabled={blocked} onClick={() => {
        try { useWorkspaceStore.getState().applyPlanSnapshot(project.id, plan); onFlash('已恢复历史方案，可撤销；线缆需重新规划。') }
        catch (e) { onFlash(e instanceof Error ? e.message : String(e)) }
      }}>恢复此方案</Button></section>)}
    </div>
  </aside>
}
