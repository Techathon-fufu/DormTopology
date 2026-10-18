import { useState } from 'react'
import { Check, Copy, History, Pencil, Save, Star, Trash2, X } from 'lucide-react'
import type { LayoutPlan, Project } from '@/types/project'
import { usePlansStore } from '@/state/plansStore'
import { useWorkspaceStore, type PlanApplySummary } from '@/state/workspaceStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { Button } from '@/ui/kit/button'
import { Input } from '@/ui/kit/primitives'
import { cn, formatDateTime } from '@/lib/utils'

/** 空方案列表的稳定引用：避免选择器每次返回新数组 */
const NO_PLANS: LayoutPlan[] = []

/**
 * 历史方案面板（工作台右侧停靠）：保存当前、恢复、重命名、复制、删除。
 * 独立的多方案指标对比页已退场，历史方案作为次级入口保留数据与恢复能力。
 */
export function PlanPanel({ project, onFlash, onClose, className }: { project: Project; onFlash: (message: string) => void; onClose?: () => void; className?: string }) {
  const candidates = usePlansStore((s) => s.candidates[project.id]) ?? NO_PLANS
  const blocked = useOrganizeStore((s) => s.isPreviewBlocking())
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const currentPlanId = project.lastAppliedPlan?.planId ?? null

  const save = () => {
    const plan = usePlansStore.getState().saveCandidate(project)
    onFlash(`已保存「${plan.name}」（含布局 / 线缆 / 来源快照）`)
  }

  const restore = (plan: LayoutPlan) => {
    let summary: PlanApplySummary | null
    try {
      summary = useWorkspaceStore.getState().applyPlanSnapshot(project.id, plan)
    } catch (error) {
      onFlash(error instanceof Error ? error.message : String(error))
      return
    }
    const parts = [`已恢复「${plan.name}」`]
    if (summary?.legacy) parts.push('旧版本方案仅恢复物品位置，相关走线需重新规划')
    else if (summary) parts.push(`恢复 ${summary.objects} 件物品位姿与 ${summary.cables} 条走线`)
    parts.push('可撤销')
    onFlash(parts.join('；'))
  }

  const submitRename = (plan: LayoutPlan) => {
    const name = renameValue.trim()
    if (!name || name === plan.name) {
      setRenameId(null)
      return
    }
    usePlansStore.getState().renameCandidate(project.id, plan.id, name)
    setRenameId(null)
    onFlash(`方案已重命名为「${name}」`)
  }

  const duplicate = (plan: LayoutPlan) => {
    const copy = usePlansStore.getState().duplicateCandidate(project.id, plan.id)
    if (copy) onFlash(`已复制「${plan.name}」为「${copy.name}」（含场景快照）`)
  }

  const remove = (plan: LayoutPlan) => {
    usePlansStore.getState().removeCandidate(project.id, plan.id)
    setDeletingId(null)
    onFlash(`已删除方案「${plan.name}」（不影响当前场景）`)
  }

  return <aside className={cn('flex min-h-0 flex-col bg-surface', className)}>
    <header className="flex items-center justify-between border-b p-3"><h2 className="flex items-center gap-2 text-sm font-semibold"><History className="h-4 w-4" />历史方案</h2>{onClose && <Button size="icon" variant="ghost" aria-label="关闭历史方案" onClick={onClose}><X className="h-4 w-4" /></Button>}</header>
    <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
      <Button className="w-full" size="sm" variant="outline" disabled={blocked} onClick={save}><Save className="h-4 w-4" />保存当前方案</Button>
      {!candidates.length && <p className="py-4 text-xs leading-6 text-muted-foreground">还没有历史方案。保存后可随时恢复。</p>}
      {candidates.map((plan) => <section key={plan.id} className="space-y-2 rounded-lg border p-3">
        {renameId === plan.id ? (
          <div className="flex items-center gap-1">
            <Input className="h-7 text-[13px]" value={renameValue} autoFocus aria-label={`重命名 ${plan.name}`} onChange={(e) => setRenameValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') submitRename(plan); if (e.key === 'Escape') setRenameId(null) }} />
            <Button size="icon" variant="ghost" aria-label="保存名称" onClick={() => submitRename(plan)}><Check className="h-3.5 w-3.5" /></Button>
            <Button size="icon" variant="ghost" aria-label="取消重命名" onClick={() => setRenameId(null)}><X className="h-3.5 w-3.5" /></Button>
          </div>
        ) : (
          <div className="flex items-start gap-1">
            <h3 className="min-w-0 flex-1 break-words text-sm font-medium">{plan.name}</h3>
            {currentPlanId === plan.id ? <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] text-primary"><Star className="h-3 w-3" />当前</span> : null}
            <Button size="icon" variant="ghost" aria-label={`重命名 ${plan.name}`} disabled={blocked} onClick={() => { setRenameId(plan.id); setRenameValue(plan.name) }}><Pencil className="h-3.5 w-3.5" /></Button>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{formatDateTime(plan.createdAt)}</p>
        {deletingId === plan.id ? (
          <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/5 p-2">
            <span className="flex-1 text-[11px] leading-snug text-danger">删除「{plan.name}」？删除后不可恢复（不影响当前场景）</span>
            <Button variant="danger" size="sm" onClick={() => remove(plan)}>确认删除</Button>
            <Button variant="outline" size="sm" onClick={() => setDeletingId(null)}>取消</Button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            <Button variant="outline" size="sm" disabled={blocked} onClick={() => restore(plan)}>恢复此方案</Button>
            <Button variant="ghost" size="sm" disabled={blocked} onClick={() => duplicate(plan)}><Copy className="h-3.5 w-3.5" />复制</Button>
            <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" disabled={blocked} onClick={() => setDeletingId(plan.id)}><Trash2 className="h-3.5 w-3.5" />删除</Button>
          </div>
        )}
      </section>)}
    </div>
  </aside>
}
