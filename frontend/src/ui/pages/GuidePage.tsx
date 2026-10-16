import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Cable,
  FileImage,
  FileJson,
  ListOrdered,
  Printer,
  Wrench,
} from 'lucide-react'
import { CABLE_KIND_META } from '@/types/project'
import { useProject } from '@/state/projectsStore'
import {
  buildAccessories,
  buildCableSteps,
  buildOrganizeSteps,
  totalCableLength,
} from '@/lib/guide'
import { downloadJson } from '@/lib/utils'
import { formatMeters } from '@/lib/units'
import { isMockMode } from '@/api'
import { ProjectSteps } from '@/ui/layout/ProjectSteps'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { EmptyState } from '@/ui/kit/empty-state'

function StepsSectionHeader({
  icon,
  title,
  badge,
}: {
  icon: React.ReactNode
  title: string
  badge?: React.ReactNode
}) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="text-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
      <h2 className="text-sm font-semibold">{title}</h2>
      {badge}
    </div>
  )
}

export function GuidePage() {
  const { id } = useParams<{ id: string }>()
  const project = useProject(id)
  const navigate = useNavigate()

  if (!project) {
    return (
      <EmptyState
        title="项目不存在或已被删除"
        description="请返回项目列表，或打开内置示例项目继续体验。"
        action={<Button onClick={() => navigate('/')}>返回项目列表</Button>}
      />
    )
  }

  const organizeSteps = buildOrganizeSteps(project)
  const cableSteps = buildCableSteps(project)
  const accessories = buildAccessories(project)
  const totalLength = totalCableLength(project)

  const exportJson = () => {
    downloadJson(`${project.name}-方案.json`, {
      app: 'DormTopology 3D',
      generatedAt: new Date().toISOString(),
      mode: isMockMode ? 'mock' : 'service',
      project: {
        id: project.id,
        name: project.name,
        isDemo: project.isDemo,
        room: project.room,
        objects: project.objects,
        cables: project.cables,
      },
      guide: { organizeSteps, cableSteps, accessories },
      notes: [
        '整理步骤为演示阶段模板建议，后续由布局规划服务生成真实步骤',
        '线缆长度为本地计算值（折线 + 余量）',
        '识别 / 模型生成 / 规划结果可能来自模拟服务，界面上已标注',
      ],
    })
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">方案交付 · {project.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            按次序执行整理与走线；线缆相关数值为本地计算，配件为模拟建议。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ProjectSteps projectId={project.id} current="guide" className="hidden md:flex" />
          <Button variant="outline" onClick={() => navigate(`/projects/${project.id}/workspace`)}>
            <ArrowLeft className="h-4 w-4" />
            返回工作台
          </Button>
        </div>
      </div>

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <p className="text-xs text-muted-foreground">物品</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{project.objects.length} 件</p>
          <p className="text-xs text-faint">
            电气 {project.objects.filter((o) => o.category === 'electrical').length} · 收纳{' '}
            {project.objects.filter((o) => o.category === 'storage').length}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            线缆总长 <DataBadge kind="computed" />
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{formatMeters(totalLength)}</p>
          <p className="text-xs text-faint">共 {project.cables.length} 条（含 0.15 m 余量/条）</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            配件建议 <DataBadge kind="mock" />
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">{accessories.length} 类</p>
          <p className="text-xs text-faint">理线扣 / 扎带 / 理线槽</p>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <StepsSectionHeader
          icon={<ListOrdered />}
          title="整理步骤"
          badge={<DataBadge kind="demo" label="模板建议" />}
        />
        <ol className="space-y-2">
          {organizeSteps.map((s, i) => (
            <li key={s.title} className="flex gap-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary tabular-nums">
                {i + 1}
              </span>
              <div>
                <p className="text-[13px] font-medium">{s.title}</p>
                <p className="text-[13px] leading-relaxed text-muted-foreground">{s.detail}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <StepsSectionHeader
          icon={<Cable />}
          title="走线次序"
          badge={<DataBadge kind="computed" label="长度=计算值" />}
        />
        {cableSteps.length === 0 ? (
          <EmptyState
            className="border-none py-6"
            title="暂无走线"
            description="到工作台切换到「规划走线」模式，点击「规划走线」生成 桌沿 → 桌底 → 立柱 → 排插 的路径。"
            action={
              <Button size="sm" onClick={() => navigate(`/projects/${project.id}/workspace`)}>
                去规划走线
              </Button>
            }
          />
        ) : (
          <ol className="space-y-2">
            {cableSteps.map((c, i) => (
              <li
                key={c.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: CABLE_KIND_META[c.kind].color }}
                />
                <Badge variant="outline">{c.kindLabel}</Badge>
                <span className="min-w-[180px] flex-1 text-[13px]">
                  {c.fromLabel} <span className="text-faint">→</span> {c.toLabel}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">约 {c.lengthText}</span>
                <span className="text-xs text-muted-foreground">通道：{c.channelsText}</span>
                {c.accessoriesText ? (
                  <span className="text-xs text-faint">{c.accessoriesText}</span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <StepsSectionHeader
          icon={<Wrench />}
          title="配件建议"
          badge={<DataBadge kind="mock" label="模拟建议" />}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          {accessories.map((a) => (
            <div key={a.label} className="rounded-md border border-border p-3">
              <p className="text-lg font-semibold tabular-nums">
                ×{a.count}
                <span className="ml-2 text-[13px] font-medium text-foreground">{a.label}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{a.reason}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold">输出与导出</h2>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={exportJson}>
            <FileJson className="h-4 w-4" />
            导出 JSON（本地生成）
          </Button>
          <span className="inline-flex items-center gap-1.5">
            <Button variant="outline" disabled title="需要后端渲染服务（未接入）">
              <Printer className="h-4 w-4" />
              导出 PDF
            </Button>
            <DataBadge kind="unavailable" />
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Button variant="outline" disabled title="需要后端渲染服务（未接入）">
              <FileImage className="h-4 w-4" />
              导出图片
            </Button>
            <DataBadge kind="unavailable" />
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-faint">
          JSON 由浏览器本地生成，包含当前项目与指南数据（含模拟结果标注）；PDF / 图片导出依赖后端渲染服务，尚未接入。
        </p>
      </section>
    </div>
  )
}
