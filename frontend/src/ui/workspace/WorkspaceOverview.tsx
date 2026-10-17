import { ArrowRight, Box, Cable, FileCheck2, Layers3, Loader2, Sparkles, X } from 'lucide-react'
import type { Project } from '@/types/project'
import { useOrganizeStore } from '@/state/organizeStore'
import { Button } from '@/ui/kit/button'
import { cn } from '@/lib/utils'

export function WorkspaceOverview({ project, onOrganize, onCables, onGuide, onImport, onClose, className }: {
  project: Project
  onOrganize: () => void
  onCables: () => void
  onGuide: () => void
  onImport: () => void
  onClose?: () => void
  className?: string
}) {
  const sessionOpen = useOrganizeStore((s) => s.status === 'planning' || s.plan !== null)
  const status = useOrganizeStore((s) => s.status)
  const plan = useOrganizeStore((s) => s.plan)
  const cancel = useOrganizeStore((s) => s.closePanel)
  const visible = project.objects.filter(o => o.visible).length
  const pending = project.cables.filter(c => !['planned', 'adjusted'].includes(c.status)).length
  const problems = plan ? plan.metrics.unplacedCount + plan.metrics.overlapCount + plan.metrics.outOfBoundsCount : 0
  return (
    <aside className={cn('flex flex-col bg-surface', className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3"><h2 className="text-sm font-semibold">工作台导航</h2>{onClose ? <Button variant="ghost" size="icon" aria-label="关闭导航面板" onClick={onClose}><X className="h-4 w-4" /></Button> : null}</div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4">
        <div><p className="text-xs text-muted-foreground">当前空间</p><h3 className="mt-1 truncate text-sm font-semibold" title={project.name}>{project.name}</h3><div className="mt-3 flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Box className="h-3.5 w-3.5" />{visible} 件物品</span><span className="flex items-center gap-1.5"><Cable className="h-3.5 w-3.5" />{project.cables.length} 条线缆</span></div></div>
        {sessionOpen ? (
          <section className="space-y-3 rounded-xl border border-primary/25 bg-primary-soft/50 p-4">
            {status === 'planning' ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Layers3 className="h-5 w-5 text-primary" />}
            <h3 className="text-sm font-semibold">{status === 'planning' ? '方案正在生成' : '整理预览已保留'}</h3>
            <p className="text-xs leading-6 text-muted-foreground">{status === 'planning' ? '可以查看场景。生成结果回来后会自动演示；取消后不会应用本次结果。' : `原布局尚未修改。${problems > 0 ? `方案有 ${problems} 项待处理问题。` : '可继续查看方案，再决定是否接受。'}`}</p>
            <Button size="sm" className="w-full" onClick={onOrganize}>继续查看方案<ArrowRight className="h-3.5 w-3.5" /></Button>
            <Button size="sm" variant="ghost" className="w-full" onClick={cancel}>{status === 'planning' ? '取消本次生成' : '取消预览，返回编辑'}</Button>
          </section>
        ) : (
          <section className="space-y-3 rounded-xl border border-border bg-background/50 p-4"><h3 className="text-sm font-semibold">从这里继续</h3><p className="text-xs leading-6 text-muted-foreground">{visible === 0 ? '先导入物品，再确认尺寸和原始位置。' : '先核对物品尺寸与位置，再生成整理方案。接受方案后，继续确认连接与走线。'}</p><Button size="sm" className="w-full" onClick={visible === 0 ? onImport : onOrganize}><Sparkles className="h-3.5 w-3.5" />{visible === 0 ? '导入照片与物品' : '生成整理方案'}</Button></section>
        )}
        <section className="space-y-1"><h3 className="mb-2 text-xs font-medium text-muted-foreground">整理与交付</h3>
          <Button variant="ghost" className="h-auto w-full justify-start whitespace-normal py-3 text-left" disabled={sessionOpen} onClick={onImport}><Box className="h-4 w-4 shrink-0" /><span className="flex-1">物品与尺寸<span className="mt-1 block text-xs font-normal text-muted-foreground">选择左侧物品可编辑属性</span></span></Button>
          <Button variant="ghost" className="h-auto w-full justify-start whitespace-normal py-3 text-left" disabled={sessionOpen} onClick={onCables}><Cable className="h-4 w-4 shrink-0" /><span className="flex-1">确认连接与走线<span className="mt-1 block text-xs font-normal text-muted-foreground">{project.cables.length ? `${pending} 条未规划或需复查` : '先确认设备接口与连接'}</span></span><ArrowRight className="h-3.5 w-3.5" /></Button>
          <Button variant="ghost" className="h-auto w-full justify-start whitespace-normal py-3 text-left" disabled={sessionOpen} onClick={onGuide}><FileCheck2 className="h-4 w-4 shrink-0" /><span className="flex-1">查看执行指南<span className="mt-1 block text-xs font-normal text-muted-foreground">基于已保存场景生成</span></span><ArrowRight className="h-3.5 w-3.5" /></Button>
        </section>
        <p className="border-t border-border pt-4 text-xs leading-6 text-muted-foreground">布局和模型状态会保存在本机。预览中的变化需要接受方案后才会保存。</p>
      </div>
    </aside>
  )
}
