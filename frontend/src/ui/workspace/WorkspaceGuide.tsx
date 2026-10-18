import { useMemo } from 'react'
import { Cable, CheckCircle2, Loader2, Play, RefreshCw, Wand2 } from 'lucide-react'
import type { Project } from '@/types/project'
import { hasUsableCableRoute } from '@/scene/cables'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { cn } from '@/lib/utils'

/** The right side follows the user's task; selecting an object only changes the left tools. */
export function WorkspaceGuide({
  project, routingConfirmed, onConfirmRouting, busy, onPlanCables, onOpenOrganize, onResult, className,
}: {
  project: Project
  routingConfirmed: boolean
  onConfirmRouting: (confirmed: boolean) => void
  busy: boolean
  onPlanCables: (ids?: string[]) => void
  onOpenOrganize: () => void
  onResult: () => void
  className?: string
}) {
  const mode = useWorkspaceStore((s) => s.mode)
  const setMode = useWorkspaceStore((s) => s.setMode)
  const plan = useOrganizeStore((s) => s.plan)
  const status = useOrganizeStore((s) => s.status)
  const previewBlocking = useOrganizeStore((s) => s.isPreviewBlocking())
  const staleIds = useMemo(() => project.cables.filter((c) => c.status === 'stale' || (c.planSource === 'demo-rule' && c.status !== 'conflict')).map((c) => c.id), [project.cables])
  const conflictCount = project.cables.filter((c) => c.status === 'conflict').length
  const plannedCount = project.cables.filter(hasUsableCableRoute).length
  const canPlan = routingConfirmed && project.cables.length > 0 && !busy && !previewBlocking

  return <aside aria-label="引导与生成" className={cn('flex min-h-0 flex-col bg-surface', className)}>
    <header className="border-b border-border px-4 py-4">
      <h2 className="text-sm font-semibold">下一步</h2>
      <p className="mt-1 text-xs text-muted-foreground">左侧调整物品，右侧完成整理与走线。</p>
    </header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      {mode === 'organize' ? <section className="space-y-3" aria-label="空间整理">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Wand2 className="h-4 w-4 text-primary" />整理空间</h3>
        <p className="text-xs leading-5 text-muted-foreground">确认物品的位置和尺寸后，预览整理效果。</p>
        <Button size="sm" className="w-full" disabled={busy} onClick={onOpenOrganize}>
          <Wand2 className="h-4 w-4" />{status === 'planning' ? '查看生成进度' : plan ? '继续查看整理方案' : '生成整理方案'}
        </Button>
        {previewBlocking ? <p role="status" className="text-xs text-warning">请先接受或取消当前预览。</p> : null}
        <Button size="sm" variant="ghost" className="w-full" disabled={previewBlocking || busy} onClick={() => setMode('cable')}><Cable className="h-4 w-4" />继续连接与走线</Button>
      </section> : <section className="space-y-3" aria-label="连接与走线">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><Cable className="h-4 w-4 text-primary" />连接与走线</h3>
        <p className="text-xs leading-5 text-muted-foreground">在左侧添加连接，再核对接口和走线。</p>
        <label className="flex items-start gap-2 text-xs leading-5">
          <input type="checkbox" className="mt-0.5 accent-[#0F9D8A]" checked={routingConfirmed} disabled={busy || previewBlocking} onChange={(event) => onConfirmRouting(event.target.checked)} />
          已核对物品尺寸、位置与接口
        </label>
        <Button size="sm" className="w-full" disabled={!canPlan} onClick={() => onPlanCables()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}{busy ? '正在规划走线' : '规划走线'}
        </Button>
        {project.cables.length === 0 ? <p className="text-xs text-muted-foreground">还没有连接。请先使用左侧“设备与接口”。</p> : null}
        {conflictCount > 0 ? <p role="alert" className="text-xs text-danger">{conflictCount} 条走线未通过检查，请在左侧查看原因。</p> : null}
        {staleIds.length > 0 ? <Button size="sm" variant="outline" className="w-full" disabled={!canPlan} onClick={() => onPlanCables(staleIds)}><RefreshCw className="h-4 w-4" />更新 {staleIds.length} 条需重算走线</Button> : null}
        {plannedCount > 0 ? <p className="flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5 text-success" />已规划 {plannedCount} 条走线</p> : null}
        <Button size="sm" variant="ghost" className="w-full" disabled={previewBlocking || busy} onClick={() => setMode('organize')}>返回空间整理</Button>
      </section>}
    </div>
    <footer className="border-t border-border p-4">
      <Button size="sm" variant="outline" className="w-full" disabled={previewBlocking || busy} onClick={onResult}><Play className="h-4 w-4" />查看整理演示</Button>
      <p className="mt-2 text-center text-xs text-muted-foreground">根据动画在现实场景中完成整理。</p>
    </footer>
  </aside>
}
