import { Cable, Play, Wand2, X, Loader2 } from 'lucide-react'
import type { Project } from '@/types/project'
import { hasUsableCableRoute } from '@/scene/cables'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { cn } from '@/lib/utils'

export function WorkspaceGuide({ project, routingConfirmed, onConfirmRouting, busy, onPlanCables, onOpenOrganize, onGuide, onClose, className }: {
  project: Project; routingConfirmed: boolean; onConfirmRouting: (confirmed: boolean) => void
  busy: boolean; onPlanCables: (ids?: string[]) => void; onOpenOrganize: () => void
  onGuide: () => void; onClose?: () => void; className?: string
}) {
  const mode = useWorkspaceStore((s) => s.mode)
  const blocked = useOrganizeStore((s) => s.isPreviewBlocking())
  const pending = project.cables.filter((c) => !hasUsableCableRoute(c)).length
  return <aside aria-label="整理与理线" className={cn('flex min-h-0 flex-col bg-surface', className)}>
    <header className="flex items-center justify-between border-b border-border p-4">
      <h2 className="text-sm font-semibold">整理与理线</h2>
      {onClose && <Button size="icon" variant="ghost" onClick={onClose} aria-label="关闭面板"><X className="h-4 w-4" /></Button>}
    </header>
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
      <p className="text-xs leading-6 text-muted-foreground">先调整物品，再连接设备。完成后跟着动画整理真实桌面。</p>
      <Button className="w-full" onClick={onOpenOrganize} disabled={busy}><Wand2 className="h-4 w-4" />整理桌面</Button>
      <section className="space-y-3 border-t border-border pt-4">
        <Button variant="outline" className="w-full" disabled={blocked || busy} onClick={() => useWorkspaceStore.getState().setMode(mode === 'cable' ? 'organize' : 'cable')}>
          <Cable className="h-4 w-4" />{mode === 'cable' ? '返回摆放编辑' : '连接设备与理线'}
        </Button>
        {mode === 'cable' && <>
          <p className="text-xs leading-6 text-muted-foreground">在物品表面标记接口、建立连接后，生成走线。{pending > 0 ? `还有 ${pending} 条待规划或复查。` : ''}</p>
          <label className="flex items-start gap-2 text-xs"><input type="checkbox" checked={routingConfirmed} disabled={busy || blocked} onChange={(e) => onConfirmRouting(e.target.checked)} />已核对尺寸、位置与接口</label>
          <Button className="w-full" disabled={!routingConfirmed || !project.cables.length || busy || blocked} onClick={() => onPlanCables()}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? '正在规划…' : '生成走线'}
          </Button>
        </>}
        {blocked && <p className="text-xs text-warning">请先接受或取消当前整理预览。</p>}
      </section>
      <section className="space-y-3 border-t border-border pt-4">
        <p className="text-xs text-muted-foreground">满意后，跟着动画整理真实桌面。</p>
        <Button variant="outline" className="w-full" disabled={blocked} onClick={onGuide}><Play className="h-4 w-4" />查看整理动画</Button>
      </section>
    </div>
  </aside>
}
