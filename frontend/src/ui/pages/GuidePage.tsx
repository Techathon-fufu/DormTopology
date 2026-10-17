import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowLeft,
  Cable,
  Check,
  Crosshair,
  FileImage,
  FileJson,
  Info,
  ListOrdered,
  Printer,
  RefreshCw,
  Wrench,
} from 'lucide-react'
import { CABLE_KIND_META } from '@/types/project'
import { endpointLabel } from '@/scene/cables'
import {
  ACCESSORY_CAPABILITY,
  type AccessoryKind,
  type AccessoryParams,
} from '@/scene/accessoryGeometry'
import { useProject } from '@/state/projectsStore'
import { useDeliverStore } from '@/state/deliverStore'
import { useTourStore } from '@/state/tourStore'
import { buildGuideBundle, type GuideIssue, type GuideStep, type StepTarget } from '@/lib/guide'
import { cn, downloadJson, formatDateTime } from '@/lib/utils'
import { formatMeters, mToMm } from '@/lib/units'
import { isMockMode } from '@/api'
import { ProjectSteps } from '@/ui/layout/ProjectSteps'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { EmptyState } from '@/ui/kit/empty-state'
import { Segmented } from '@/ui/kit/segmented'
import { AccessoryPanel } from '@/ui/deliver/AccessoryPanel'
import {
  DeliverViewport,
  type GuideView,
  type ViewportCaptureHandle,
} from '@/ui/deliver/DeliverViewport'

/**
 * 方案交付页（执行指南）：
 * - 内容全部由当前方案数据实时推导（@/lib/guide.ts），不写死演示步骤；
 * - 三维场景截图 / 俯视图 + 点击步骤高亮对象 + 勾选执行进度；
 * - 工作台方案修改后（stamp 变化）提示「重新生成」；
 * - 导出项目 JSON、场景截图（PNG），并提供浏览器打印 / 保存 PDF 版式。
 */

function SectionCard({
  icon,
  title,
  badge,
  description,
  children,
}: {
  icon: ReactNode
  title: string
  badge?: ReactNode
  description?: string
  children: ReactNode
}) {
  return (
    <section className="break-inside-avoid rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="text-primary [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
        <h2 className="text-sm font-semibold">{title}</h2>
        {badge}
      </div>
      {description ? (
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

function StepList({
  steps,
  checkedSet,
  focus,
  onToggle,
  onFocus,
  emptyText,
}: {
  steps: GuideStep[]
  checkedSet: Set<string>
  focus: StepTarget | null
  onToggle: (id: string) => void
  onFocus: (target: StepTarget) => void
  emptyText: string
}) {
  if (steps.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted-foreground">
        {emptyText}
      </p>
    )
  }
  return (
    <ol className="space-y-1">
      {steps.map((step, i) => {
        const checked = checkedSet.has(step.id)
        const focused = Boolean(
          step.target && focus && step.target.type === focus.type && step.target.id === focus.id,
        )
        return (
          <li
            key={step.id}
            className={cn(
              'flex items-start gap-2.5 rounded-md border px-2.5 py-2 transition-colors',
              focused ? 'border-primary/45 bg-primary-soft/50' : 'border-transparent hover:bg-muted/60',
            )}
          >
            <button
              type="button"
              onClick={() => onToggle(step.id)}
              title={checked ? '标记为未完成' : '标记为已完成'}
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors',
                checked
                  ? 'border-primary bg-primary text-white'
                  : 'border-border bg-surface text-transparent hover:border-primary/60',
              )}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <span className="mt-0.5 w-5 shrink-0 text-center text-xs font-semibold tabular-nums text-faint">
              {i + 1}
            </span>
            <div
              className={cn(
                'min-w-0 flex-1',
                step.target && 'cursor-pointer',
                checked && 'opacity-60',
              )}
              onClick={() => step.target && onFocus(step.target)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={cn(
                    'text-[13px] font-medium',
                    checked && 'line-through decoration-faint',
                  )}
                >
                  {step.title}
                </p>
                {step.tags?.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[11px]">
                    {tag}
                  </Badge>
                ))}
              </div>
              <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{step.detail}</p>
            </div>
            {step.target ? (
              <button
                type="button"
                title="在三维视图中高亮"
                onClick={() => onFocus(step.target as StepTarget)}
                className="mt-0.5 hidden shrink-0 rounded p-1 text-faint hover:bg-muted hover:text-primary sm:block print:hidden"
              >
                <Crosshair className="h-4 w-4" />
              </button>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

function IssueList({
  issues,
  focus,
  onFocus,
}: {
  issues: GuideIssue[]
  focus: StepTarget | null
  onFocus: (target: StepTarget) => void
}) {
  if (issues.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-success/30 bg-success/5 px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <span>
          基于本地几何检查（摆放 / 走线 / 线长），当前方案未发现未解决问题；接入真实算法与后端服务后以复查结果为准。
        </span>
      </div>
    )
  }
  return (
    <ul className="space-y-1.5">
      {issues.map((issue) => {
        const focused = Boolean(
          issue.target && focus && issue.target.type === focus.type && issue.target.id === focus.id,
        )
        return (
          <li
            key={issue.id}
            className={cn(
              'flex items-start gap-2 rounded-md border px-3 py-2',
              issue.severity === 'warning'
                ? 'border-warning/35 bg-warning/5'
                : 'border-border bg-muted/40',
              focused && 'ring-1 ring-primary/40',
            )}
          >
            {issue.severity === 'warning' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            ) : (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" />
            )}
            <span className="min-w-0 flex-1 text-[13px] leading-relaxed">{issue.message}</span>
            {issue.target ? (
              <button
                type="button"
                onClick={() => onFocus(issue.target as StepTarget)}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-primary hover:bg-primary-soft print:hidden"
              >
                定位
              </button>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export function GuidePage() {
  const { id } = useParams<{ id: string }>()
  const project = useProject(id)
  const navigate = useNavigate()

  const [view, setView] = useState<GuideView>('top')
  const [focus, setFocus] = useState<StepTarget | null>(null)
  const [shot, setShot] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const captureRef = useRef<ViewportCaptureHandle | null>(null)
  const accessoryPanelRef = useRef<HTMLDivElement | null>(null)

  const projectId = project?.id ?? ''
  const entry = useDeliverStore((s) => (projectId ? s.byProject[projectId] : undefined))
  const ensureEntry = useDeliverStore((s) => s.ensure)
  const regenerateEntry = useDeliverStore((s) => s.regenerate)
  const toggleStep = useDeliverStore((s) => s.toggleStep)
  const clearChecked = useDeliverStore((s) => s.clearChecked)
  const setAccessoryEntry = useDeliverStore((s) => s.setAccessory)

  const defaultAccessory = useMemo<AccessoryParams>(() => {
    if (!project) {
      return {
        kind: 'desk-clip',
        cableDiameter: 0.004,
        capacity: 2,
        deskThickness: 0.025,
        postSection: 0.04,
      }
    }
    return {
      kind: 'desk-clip',
      cableDiameter: 0.004,
      capacity: 2,
      deskThickness: project.room.desk.thickness,
      postSection: project.room.posts[0]?.section ?? 0.04,
    }
  }, [project])

  const bundle = useMemo(() => (project ? buildGuideBundle(project) : null), [project])

  useEffect(() => {
    if (project && bundle) ensureEntry(project.id, bundle.stamp, defaultAccessory)
  }, [project, bundle, ensureEntry, defaultAccessory])

  // 演示导览信号：进入方案交付页即视为完成「查看执行指南」步骤
  useEffect(() => {
    if (project) useTourStore.getState().signal(project.id, 'guide')
  }, [project])

  const checkedSet = useMemo(() => new Set(entry?.checked ?? []), [entry])
  const allSteps = useMemo(
    () => (bundle ? [...bundle.placement, ...bundle.connections, ...bundle.gathers] : []),
    [bundle],
  )
  const doneCount = useMemo(
    () => allSteps.filter((s) => checkedSet.has(s.id)).length,
    [allSteps, checkedSet],
  )
  const stale = Boolean(entry && bundle && entry.stamp !== bundle.stamp)

  /** 渲染一帧并更新打印用截图 */
  const refreshShot = useCallback(() => {
    const dataUrl = captureRef.current?.capture() ?? null
    if (dataUrl) setShot(dataUrl)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(refreshShot, 450)
    return () => window.clearTimeout(t)
  }, [refreshShot, view, focus])

  useEffect(() => {
    if (!notice) return
    const t = window.setTimeout(() => setNotice(null), 3200)
    return () => window.clearTimeout(t)
  }, [notice])

  if (!project || !bundle) {
    return (
      <EmptyState
        title="项目不存在或已被删除"
        description="请返回项目列表，或打开内置示例项目继续体验。"
        action={<Button onClick={() => navigate('/')}>返回项目列表</Button>}
      />
    )
  }

  const accessoryParams = entry?.accessory ?? defaultAccessory
  const { stats, accessories, issues } = bundle

  const focusLabel = (() => {
    if (!focus) return ''
    if (focus.type === 'object') {
      return `「${project.objects.find((o) => o.id === focus.id)?.name ?? '物品'}」`
    }
    const cable = project.cables.find((c) => c.id === focus.id)
    if (!cable) return '线缆'
    const from = endpointLabel(project.objects, cable.from).objectName
    const to = endpointLabel(project.objects, cable.to).objectName
    return `线缆「${from} → ${to}」（${CABLE_KIND_META[cable.kind].label}）`
  })()

  const onToggleStep = (stepId: string) => toggleStep(project.id, stepId)
  const onFocusTarget = (target: StepTarget) => setFocus(target)

  const onRegenerate = () => {
    regenerateEntry(project.id, bundle.stamp, defaultAccessory)
    setNotice({ tone: 'ok', text: '指南已按当前方案重新生成' })
  }

  const onAccessoryChange = (patch: Partial<AccessoryParams>) => {
    setAccessoryEntry(project.id, bundle.stamp, defaultAccessory, patch)
  }

  const openAccessoryPreview = (kind: AccessoryKind) => {
    onAccessoryChange({ kind })
    window.setTimeout(
      () => accessoryPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
      60,
    )
  }

  const handlePrint = () => {
    refreshShot()
    window.setTimeout(() => window.print(), 120)
  }

  const exportScreenshot = () => {
    const dataUrl = captureRef.current?.capture() ?? shot
    if (!dataUrl) {
      setNotice({ tone: 'error', text: '截图失败：三维视图尚未就绪，请稍后再试' })
      return
    }
    setShot(dataUrl)
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${project.name}-场景截图.png`
    a.click()
    setNotice({ tone: 'ok', text: '已导出场景截图（PNG）' })
  }

  const exportJson = () => {
    downloadJson(`${project.name}-方案交付.json`, {
      app: 'DormTopology 3D',
      kind: 'delivery-guide',
      exportedAt: new Date().toISOString(),
      mode: isMockMode ? 'mock' : 'service',
      project: {
        id: project.id,
        name: project.name,
        isDemo: project.isDemo,
        room: project.room,
        objects: project.objects,
        cables: project.cables,
      },
      guide: {
        stamp: bundle.stamp,
        generatedAt: entry?.generatedAt ?? null,
        checkedStepIds: entry?.checked ?? [],
        placementSteps: bundle.placement,
        connectionSteps: bundle.connections,
        gatherSteps: bundle.gathers,
        accessories: bundle.accessories,
        issues: bundle.issues,
        stats: bundle.stats,
      },
      accessoryPreview: entry
        ? {
            kind: entry.accessory.kind,
            paramsMm: {
              cableDiameter: Number(mToMm(entry.accessory.cableDiameter).toFixed(2)),
              capacity: entry.accessory.capacity,
              deskThickness: Number(mToMm(entry.accessory.deskThickness).toFixed(2)),
              postSection: Number(mToMm(entry.accessory.postSection).toFixed(2)),
            },
            capability: ACCESSORY_CAPABILITY,
          }
        : null,
      notes: [
        '所有步骤由当前项目数据实时推导，未写死演示步骤',
        '线长为本地估算（平滑采样折线 + 用户预留），配件数量为规则式估算（见各条目 reason）',
        '三维检查为本地几何规则（非真实算法验证）；GLB 为外观预览模型，STL 尚未接入',
      ],
    })
  }

  return (
    <div className="space-y-5">
      {/* 打印版式：标题 + 生成信息 + 场景截图（屏幕上隐藏） */}
      <div className="hidden print:block">
        <h1 className="text-lg font-semibold">方案交付 · {project.name}</h1>
        <p className="mt-1 text-xs text-muted-foreground">
          生成时间：{entry ? formatDateTime(entry.generatedAt) : '—'} · DormTopology 3D（演示模式：
          数值为本地计算 / 估算，界面已标注）
        </p>
        {shot ? (
          <img
            src={shot}
            alt="整理后的场景截图"
            className="mt-3 w-full rounded border border-border"
          />
        ) : (
          <p className="mt-3 rounded border border-dashed border-border px-3 py-2 text-xs text-faint">
            场景截图需在支持 WebGL 的浏览器中生成。
          </p>
        )}
      </div>

      {/* 工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-xl font-semibold">方案交付 · {project.name}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            按次序执行整理与走线；所有内容由当前方案实时生成，线长 / 配件为本地计算与估算。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ProjectSteps projectId={project.id} current="guide" className="hidden lg:flex" />
          <Button variant="outline" onClick={() => navigate(`/projects/${project.id}/workspace`)}>
            <ArrowLeft className="h-4 w-4" />
            返回工作台
          </Button>
          <Button variant={stale ? 'primary' : 'outline'} onClick={onRegenerate}>
            <RefreshCw className="h-4 w-4" />
            重新生成指南
          </Button>
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4" />
            打印 / 保存 PDF
          </Button>
          <Button variant="outline" onClick={exportJson}>
            <FileJson className="h-4 w-4" />
            导出 JSON
          </Button>
          <Button variant="outline" onClick={exportScreenshot}>
            <FileImage className="h-4 w-4" />
            导出截图
          </Button>
        </div>
      </div>

      {/* 方案修改提示 */}
      {stale ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 print:hidden">
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-medium">工作台方案已修改：指南内容已按最新方案更新</p>
            <p className="text-xs text-muted-foreground">
              步骤与数值始终实时生成；点击「重新生成指南」记录新的基准版本与生成时间（保留已勾选进度）。
            </p>
          </div>
          <Button size="sm" onClick={onRegenerate}>
            <RefreshCw className="h-3.5 w-3.5" />
            重新生成指南
          </Button>
        </div>
      ) : null}

      {/* 概览统计 */}
      <section className="grid break-inside-avoid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <p className="text-xs text-muted-foreground">物品</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {stats.visibleObjectCount} 件
            <span className="ml-1 text-xs font-normal text-faint">可见 / 共 {stats.objectCount}</span>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <p className="text-xs text-muted-foreground">线缆</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {stats.cableCount} 条
            <span className="ml-1 text-xs font-normal text-faint">
              已规划 {stats.plannedCableCount}
            </span>
          </p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            线缆总长（含预留） <DataBadge kind="computed" />
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {formatMeters(stats.requiredLengthM)}
          </p>
          <p className="text-xs text-faint">净估算 {formatMeters(stats.totalLengthM)}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
          <p className="text-xs text-muted-foreground">待解决问题</p>
          <p className="mt-1 text-lg font-semibold tabular-nums">
            {stats.warningCount} 处
            <span className="ml-1 text-xs font-normal text-faint">提示 {stats.infoCount}</span>
          </p>
          <p className="text-xs text-faint">本地几何检查结果</p>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* 左列：步骤与清单 */}
        <div className="space-y-5">
          <SectionCard
            icon={<ListOrdered />}
            title="物品摆放步骤"
            badge={<DataBadge kind="computed" label="按当前方案生成" />}
            description="按支撑面（桌面 → 书架 → 地面）排序；点击步骤可在右侧三维视图中高亮对应物品。"
          >
            <StepList
              steps={bundle.placement}
              checkedSet={checkedSet}
              focus={focus}
              onToggle={onToggleStep}
              onFocus={onFocusTarget}
              emptyText="当前方案没有可摆放的物品（载入示例物品库或添加物品后生成）。"
            />
          </SectionCard>

          <SectionCard
            icon={<Cable />}
            title="线缆连接次序"
            badge={<DataBadge kind="computed" label="长度 = 计算值" />}
            description="按接入端高度从高到低：先接桌面设备，后接地面排插 / 插座；长度按当前路径估算。"
          >
            <StepList
              steps={bundle.connections}
              checkedSet={checkedSet}
              focus={focus}
              onToggle={onToggleStep}
              onFocus={onFocusTarget}
              emptyText="暂无走线：到工作台切换到「规划走线」模式建立设备间的连接。"
            />
          </SectionCard>

          <SectionCard
            icon={<Wrench />}
            title="收拢与固定次序"
            badge={<DataBadge kind="computed" label="本地估算" />}
            description="按「桌沿 → 桌底 → 立柱 → 地面」的物理顺序分组固定；固定点数量见下方配件清单。"
          >
            <StepList
              steps={bundle.gathers}
              checkedSet={checkedSet}
              focus={focus}
              onToggle={onToggleStep}
              onFocus={onFocusTarget}
              emptyText="暂无线缆可收拢。"
            />
          </SectionCard>

          <SectionCard
            icon={<Wrench />}
            title="配件清单（卡扣 / 挂钩 / 扎带等）"
            badge={<DataBadge kind="computed" label="计算值 + 估算" />}
            description="「规划标注」来自走线规划中已记录的数量；其余为本地规则估算（见每条说明），采购时请按实际线径留余量。"
          >
            {accessories.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[13px] text-muted-foreground">
                当前方案还没有线缆，无需配件；完成走线规划后会给出数量估算。
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-md border border-border">
                {accessories.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                    <span className="w-12 text-lg font-semibold tabular-nums">×{a.count}</span>
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                        {a.label}
                        {a.fromPlan > 0 ? (
                          <Badge variant="outline" className="text-[11px]">
                            含规划标注 {a.fromPlan}
                          </Badge>
                        ) : null}
                        {a.estimated > 0 ? (
                          <Badge variant="outline" className="text-[11px]">
                            估算 {a.estimated}
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                        {a.reason}
                      </p>
                    </div>
                    {a.id === 'clip' || a.id === 'hook' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="print:hidden"
                        onClick={() => openAccessoryPreview(a.id === 'clip' ? 'desk-clip' : 'post-hook')}
                      >
                        <Wrench className="h-3.5 w-3.5" />
                        参数预览
                      </Button>
                    ) : (
                      <span className="text-xs text-faint">无几何预览</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <div ref={accessoryPanelRef}>
            <SectionCard
              icon={<Wrench />}
              title="配件参数预览"
              badge={<Badge variant="primary">外观预览</Badge>}
              description="输入线径 / 容纳数量 / 桌板厚度（或立柱截面），实时生成参数化几何预览；当前模型为外观预览，不能直接用于 3D 打印。"
            >
              <AccessoryPanel
                project={project}
                params={accessoryParams}
                accessories={accessories}
                onChange={onAccessoryChange}
              />
            </SectionCard>
          </div>

          <SectionCard
            icon={<AlertTriangle />}
            title="未解决的问题（尺寸 / 位置 / 线长）"
            badge={<DataBadge kind="computed" label="本地几何检查" />}
            description="来自摆放校验（越界 / 相交 / 悬空）与走线检查（边界 / 避让区 / 端点 / 线长）；接入真实算法后以复查结果为准。"
          >
            <IssueList issues={issues} focus={focus} onFocus={onFocusTarget} />
          </SectionCard>
        </div>

        {/* 右列：场景视图 + 进度 */}
        <aside className="space-y-4 print:hidden">
          <div className="rounded-lg border border-border bg-surface p-3 shadow-sm xl:sticky xl:top-20">
            <div className="mb-2 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">整理后的场景</h2>
              <Segmented<GuideView>
                size="sm"
                value={view}
                onChange={setView}
                options={[
                  { value: 'top', label: '俯视' },
                  { value: 'persp', label: '透视' },
                ]}
              />
            </div>
            <div className="h-72 overflow-hidden rounded-md border border-border">
              <DeliverViewport
                project={project}
                view={view}
                focus={focus}
                onFocus={setFocus}
                captureRef={captureRef}
              />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-faint">
              点击场景中的物品 / 线缆，或点击步骤右侧的定位按钮，可高亮对应对象；拖动旋转、滚轮缩放。
              「导出截图」与打印版式使用当前机位的画面。
            </p>
            {focus ? (
              <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-primary/35 bg-primary-soft/40 px-2.5 py-1.5">
                <span className="min-w-0 truncate text-xs text-foreground">
                  已高亮：{focusLabel}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setFocus(null)}>
                  取消高亮
                </Button>
              </div>
            ) : null}
          </div>

          <div className="rounded-lg border border-border bg-surface p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">执行进度</h2>
              <span className="text-sm font-semibold tabular-nums">
                {doneCount}/{allSteps.length}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${allSteps.length ? (doneCount / allSteps.length) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs leading-relaxed text-faint">
              勾选状态保存在本地（按方案版本记录）；修改工作台方案后可重新生成基准版本。
            </p>
            {doneCount > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                className="mt-1"
                onClick={() => clearChecked(project.id)}
              >
                清除全部勾选
              </Button>
            ) : null}
          </div>
        </aside>
      </div>

      {notice ? (
        <div
          className={cn(
            'fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md border px-4 py-2 text-[13px] shadow-md print:hidden',
            notice.tone === 'ok'
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-danger/40 bg-danger/10 text-danger',
          )}
        >
          {notice.text}
        </div>
      ) : null}
    </div>
  )
}
