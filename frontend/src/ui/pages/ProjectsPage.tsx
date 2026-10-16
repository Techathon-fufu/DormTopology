import { useNavigate } from 'react-router-dom'
import { FolderOpen, Plus, Trash2 } from 'lucide-react'
import type { Project } from '@/types/project'
import { DEMO_PROJECT_ID } from '@/data/demoProject'
import { useProjectsStore } from '@/state/projectsStore'
import { formatDateTime } from '@/lib/utils'
import { formatMm } from '@/lib/units'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { EmptyState } from '@/ui/kit/empty-state'

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate()
  const remove = useProjectsStore((s) => s.remove)

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-medium">{project.name}</h3>
            {project.isDemo ? <DataBadge kind="demo" /> : null}
          </div>
          <p className="mt-1 text-xs leading-relaxed text-faint">
            桌面 {formatMm(project.room.desk.width)} × {formatMm(project.room.desk.depth)} · 台面高{' '}
            {formatMm(project.room.desk.height)}
          </p>
          <p className="text-xs text-faint">更新于 {formatDateTime(project.updatedAt)}</p>
        </div>
        {!project.isDemo ? (
          <Button
            variant="ghost"
            size="icon"
            title="删除项目"
            onClick={() => {
              if (window.confirm(`确定删除「${project.name}」吗？`)) remove(project.id)
            }}
          >
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <Badge variant="outline">{project.objects.length} 件物品</Badge>
        <Badge variant="outline">{project.cables.length} 条线缆</Badge>
        <Badge variant="outline">{project.isDemo ? '内置示例' : '自建项目'}</Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => navigate(`/projects/${project.id}/workspace`)}>
          进入工作台
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/projects/${project.id}/setup`)}
        >
          空间配置
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => navigate(`/projects/${project.id}/import`)}
        >
          照片导入
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${project.id}/guide`)}>
          方案交付
        </Button>
      </div>
    </div>
  )
}

export function ProjectsPage() {
  const navigate = useNavigate()
  const projects = useProjectsStore((s) => s.projects)
  const list = Object.values(projects).sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="space-y-6">
      <section className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">项目</h1>
          <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
            为宿舍「上床下桌」创建桌面整理与理线方案：空间配置 → 识别物品 → 三维整理 → 输出执行指南。
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => navigate('/projects/new')}>
            <Plus className="h-4 w-4" />
            创建项目
          </Button>
          <Button variant="outline" onClick={() => navigate(`/projects/${DEMO_PROJECT_ID}/workspace`)}>
            <FolderOpen className="h-4 w-4" />
            打开示例项目
          </Button>
        </div>
      </section>

      {list.length === 0 ? (
        <EmptyState
          icon={<FolderOpen />}
          title="还没有项目"
          description="创建一个新项目，或直接打开内置示例项目体验完整流程。"
          action={
            <Button onClick={() => navigate('/projects/new')}>
              <Plus className="h-4 w-4" />
              创建项目
            </Button>
          }
        />
      ) : (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </section>
      )}

      <section className="rounded-lg border border-dashed border-border p-4">
        <p className="text-[13px] font-medium">工作方式</p>
        <ol className="mt-2 grid gap-1.5 text-[13px] text-muted-foreground md:grid-cols-4">
          <li>① 空间配置：桌面 / 房间 / 书架 / 立柱 / 出线孔（mm，实时预览）</li>
          <li>② 照片导入：识别并确认物品（可编辑 / 补充 / 删除）</li>
          <li>③ 三维工作台：整理物品 / 规划走线</li>
          <li>④ 方案交付：整理步骤、配件与导出</li>
        </ol>
      </section>
    </div>
  )
}
