import { Dropdown } from '@/ui/kit/dropdown'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, FileCheck2, FlaskConical, FolderOpen, ImagePlus, LayoutGrid, MoreHorizontal, Plus, Ruler, Sparkles, Trash2, Box, Cable, Clock3 } from 'lucide-react'
import type { Project } from '@/types/project'
import { useProjectsStore } from '@/state/projectsStore'
import { useTourStore } from '@/state/tourStore'
import { DEMO_PROJECT_ID } from '@/data/demoProject'
import { formatDateTime } from '@/lib/utils'
import { formatMm } from '@/lib/units'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { EmptyState } from '@/ui/kit/empty-state'
import { DeskIllustration } from '@/ui/brand/DeskIllustration'

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate()
  const remove = useProjectsStore((s) => s.remove)
  return (
    <article className="group overflow-hidden rounded-xl border border-border bg-surface shadow-xs transition-shadow hover:shadow-md">
      <div className="relative flex h-44 items-center justify-center border-b border-border/60 bg-[#EEF2EB]">
        <DeskIllustration className="w-64 transition-transform duration-300 motion-safe:group-hover:scale-105" />
        <span className="absolute bottom-2 right-3 text-[10px] text-muted-foreground">空间示意 · 非项目截图</span>
        <div className="absolute left-3 top-3">{project.isDemo ? <DataBadge kind="demo" /> : <span className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-muted-foreground">我的空间</span>}</div>
        <Dropdown className="absolute right-3 top-3">
          <summary className="flex h-8 w-8 cursor-pointer list-none items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground [&::-webkit-details-marker]:hidden" aria-label={`${project.name}的更多操作`}><MoreHorizontal className="h-4 w-4" /></summary>
          <div className="absolute right-0 top-10 z-10 flex w-40 flex-col rounded-xl border border-border bg-surface p-1.5 shadow-md">
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => navigate(`/projects/${project.id}/setup`)}>空间配置</Button>
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => navigate(`/projects/${project.id}/import`)}>照片与物品</Button>
            <Button variant="ghost" size="sm" className="justify-start" onClick={() => navigate(`/projects/${project.id}/guide`)}>查看执行指南</Button>
            {!project.isDemo ? <Button variant="ghost" size="sm" className="justify-start text-danger" onClick={() => { if (window.confirm(`确定删除「${project.name}」吗？`)) remove(project.id) }}><Trash2 className="h-3.5 w-3.5" />删除项目</Button> : null}
          </div>
        </Dropdown>
      </div>
      <div className="p-5">
        <h3 className="truncate text-base font-semibold" title={project.name}>{project.name}</h3>
        <p className="mt-1.5 text-xs text-muted-foreground">桌面 {formatMm(project.room.desk.width)} × {formatMm(project.room.desk.depth)} · 高 {formatMm(project.room.desk.height)}</p>
        <div className="mt-4 flex gap-4 text-xs text-muted-foreground"><span className="flex items-center gap-1.5"><Box className="h-3.5 w-3.5" />{project.objects.length} 件物品</span><span className="flex items-center gap-1.5"><Cable className="h-3.5 w-3.5" />{project.cables.length} 条线缆</span></div>
        <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/70 pt-4"><span className="flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 className="h-3 w-3" />{formatDateTime(project.updatedAt)}</span><Button variant="outline" size="sm" onClick={() => navigate(`/projects/${project.id}/workspace`)}>进入工作台<ArrowRight className="h-3.5 w-3.5" /></Button></div>
      </div>
    </article>
  )
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const projects = useProjectsStore((s) => s.projects)
  const list = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt)
  const startDemoTour = () => { useTourStore.getState().reset(); navigate(`/projects/${DEMO_PROJECT_ID}/workspace`) }
  return (
    <div className="space-y-10 pb-6">
      <section className="relative grid overflow-hidden rounded-2xl border border-border bg-[#EEF2EB] lg:grid-cols-[1.1fr_1fr]">
        <div className="relative z-10 px-6 py-8 sm:px-10 sm:py-12">
          <p className="flex items-center gap-2 text-xs font-medium tracking-widest text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />让空间回到顺手的样子</p>
          <h1 className="mt-5 text-3xl font-semibold leading-[1.35] tracking-tight sm:text-4xl">桌面有序，<br />灵感就有了位置。</h1>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">从一张照片开始，确认物品与空间，在三维预览中整理摆放、规划走线，得到一份可照着执行的指南。</p>
          <div className="mt-7 flex flex-wrap gap-3"><Button size="lg" onClick={startDemoTour}><Sparkles className="h-4 w-4" />体验整理演示<ArrowRight className="h-4 w-4" /></Button><Button size="lg" variant="outline" onClick={() => navigate('/projects/new')}><Plus className="h-4 w-4" />创建我的空间</Button><Button size="lg" variant="outline" onClick={() => navigate('/algorithm-lab')}><FlaskConical className="h-4 w-4" />算法验证</Button></div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">演示使用示例数据，可随时暂停与重播。</p>
        </div>
        <div className="relative hidden items-center justify-center px-6 lg:flex"><DeskIllustration className="max-w-lg" /><span className="absolute bottom-6 right-6 text-[11px] text-muted-foreground">空间整理示意</span></div>
      </section>
      <section>
        <div className="mb-5 flex items-end justify-between gap-3"><div><p className="text-xs text-muted-foreground">YOUR SPACES</p><h2 className="mt-1 text-xl font-semibold">我的空间<span className="ml-2 text-sm font-normal tabular-nums text-muted-foreground">{list.length}</span></h2></div><Button variant="ghost" size="sm" onClick={() => navigate('/projects/new')}><Plus className="h-4 w-4" />新建项目</Button></div>
        {list.length === 0 ? <EmptyState icon={<FolderOpen />} title="你的第一个空间，从这里开始" description="创建一个项目，或先体验示例中的完整整理过程。" action={<Button onClick={() => navigate('/projects/new')}>创建项目</Button>} /> : <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{list.map(p => <ProjectCard key={p.id} project={p} />)}</div>}
      </section>
      <section className="border-t border-border pt-7"><h2 className="text-sm font-semibold">四步，把想法变成整理方案</h2><ol className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">{[
        {icon:Ruler,title:'确认空间',text:'设置桌体与收纳区域，核对实际尺寸。'},
        {icon:ImagePlus,title:'导入物品',text:'上传照片，确认清单与物品信息。'},
        {icon:LayoutGrid,title:'预览整理',text:'查看归位过程，调整摆放与走线。'},
        {icon:FileCheck2,title:'照着执行',text:'查看步骤，导出你的整理指南。'},
      ].map((step,i) => <li key={step.title} className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-primary"><step.icon className="h-4 w-4" /></span><div><h3 className="text-[13px] font-medium"><span className="mr-1.5 tabular-nums text-muted-foreground">0{i+1}</span>{step.title}</h3><p className="mt-1 text-xs leading-6 text-muted-foreground">{step.text}</p></div></li>)}</ol></section>
    </div>
  )
}
