import { Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Canvas } from '@react-three/fiber'
import { ArrowLeft, Check, MonitorOff, RotateCcw, Search, Star } from 'lucide-react'
import type { CableConnection, LayoutPlan, SceneObject } from '@/types/project'
import {
  CABLE_KIND_META,
  CABLE_STATUS_META,
  CABLE_STRATEGY_META,
  CABLE_THICKNESS_META,
  CABLE_VISIBILITY_META,
  PLAN_CABLE_SOURCE_LABELS,
  PLAN_LAYOUT_SOURCE_LABELS,
} from '@/types/project'
import type { PlanZoneCount, PlanMetrics, ResolvedPlanScene } from '@/lib/planMetrics'
import {
  MAX_COMPARE_PLANS,
  PLAN_SORT_OPTIONS,
  computePlanDiff,
  computePlanMetrics,
  filterSortPlans,
  formatPlanTime,
  planUpdatedAt,
  resolvePlanScene,
} from '@/lib/planMetrics'
import type { PlanSortKey } from '@/lib/planMetrics'
import { resolveOrganizationPreferences, ZONE_COLORS } from '@/types/organization'
import { detectWebGL } from '@/lib/webgl'
import { cn } from '@/lib/utils'
import { useProject } from '@/state/projectsStore'
import { usePlansStore } from '@/state/plansStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore, type ViewPreset } from '@/state/workspaceStore'
import { useDeskModelStore } from '@/state/deskModelStore'
import { CameraRig } from '@/scene/CameraRig'
import { RoomShell } from '@/scene/RoomShell'
import { DormDeskModel } from '@/scene/DormDeskModel'
import { CompareCables, CompareObjectMesh, DIFF_COLOR } from '@/scene/PlanCompareScene'
import { resolveCableThickness, resolveCableVisibility } from '@/scene/cables'
import { cablePathLength } from '@/scene/cableGeometry'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { EmptyState } from '@/ui/kit/empty-state'
import { EstimateBadge } from '@/ui/kit/estimate-badge'
import { Input, Select } from '@/ui/kit/primitives'
import { Segmented } from '@/ui/kit/segmented'

const EMPTY_PLANS: LayoutPlan[] = []

function MetricLine({
  label,
  value,
  estimate,
  title,
}: {
  label: string
  value: string
  estimate?: boolean
  title?: string
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 font-medium tabular-nums">
        {value}
        {estimate ? <EstimateBadge /> : null}
      </span>
    </div>
  )
}

function ZoneChips({ counts }: { counts: PlanZoneCount[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {counts.map((z) => (
        <span
          key={z.zone}
          className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px text-[10px] text-muted-foreground"
        >
          <span className="h-2 w-2 rounded-full" style={{ background: ZONE_COLORS[z.zone] }} />
          {z.label} {z.count}
        </span>
      ))}
    </div>
  )
}

function sourceLabel(plan: LayoutPlan): string {
  return plan.source
    ? `${PLAN_LAYOUT_SOURCE_LABELS[plan.source.layout]} · ${PLAN_CABLE_SOURCE_LABELS[plan.source.cable]}`
    : '未记录（旧版本方案）'
}

/** 指标对比表：列为所选方案，行为实时计算的指标；较优值带勾选标记 */
function PlanMetricsTable({
  plans,
  metricsById,
}: {
  plans: LayoutPlan[]
  metricsById: Record<string, PlanMetrics | undefined>
}) {
  type Row = {
    label: string
    title: string
    value: (m: PlanMetrics | undefined) => string
    raw?: (m: PlanMetrics | undefined) => number | null
    estimate?: (m: PlanMetrics | undefined) => boolean
    better?: 'higher' | 'lower'
  }
  const rows: Row[] = [
    {
      label: '物品数量',
      title: '方案快照中的可见物品数（旧版本方案按指派数计）',
      value: (m) => (m ? String(m.objectCount) : '—'),
      raw: (m) => m?.objectCount ?? null,
    },
    {
      label: '已连接线缆',
      title: '方案快照中的线缆条数；旧版本方案无该数据',
      value: (m) => (m?.cableCount == null ? '—' : String(m.cableCount)),
      raw: (m) => m?.cableCount ?? null,
    },
    {
      label: '桌面可用面积',
      title: '桌面矩形 − 平放物品包围盒相交面积（与整理方案同口径，估算值）',
      value: (m) => (m?.deskFreeAreaM2 == null ? '—' : `${m.deskFreeAreaM2.toFixed(2)} m²`),
      raw: (m) => m?.deskFreeAreaM2 ?? null,
      estimate: (m) => m?.deskFreeAreaM2 != null,
      better: 'higher',
    },
    {
      label: '走线总长度',
      title: '真实曲线采用后端验证长度，演示路径按当前采样估算；任意线路尚无有效路径时总长未知',
      value: (m) => (m?.cableLengthM == null ? '—' : `${m.cableLengthM.toFixed(2)} m`),
      raw: (m) => m?.cableLengthM ?? null,
      estimate: (m) => Boolean(m?.estimated.cableLength),
      better: 'lower',
    },
    {
      label: '未解决问题',
      title: '摆放校验问题（越界 / 相交 / 悬空）+ 线缆几何检查问题条数之和',
      value: (m) => (m?.issueCount == null ? '—' : String(m.issueCount)),
      raw: (m) => m?.issueCount ?? null,
      better: 'lower',
    },
    {
      label: '布局来源',
      title: '最近一次接受整理方案时的来源记录（手动摆放 / 未记录表示无来源数据）',
      value: (m) =>
        m?.source ? PLAN_LAYOUT_SOURCE_LABELS[m.source.layout] : '未记录（旧版本方案）',
    },
    {
      label: '走线来源',
      title: '按方案各线缆的来源汇总（历史未验证路径 / 后端算法 / 手动调整）',
      value: (m) =>
        m?.source ? PLAN_CABLE_SOURCE_LABELS[m.source.cable] : '未记录（旧版本方案）',
    },
  ]

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-xs">
        <thead>
          <tr className="border-b border-border text-left">
            <th className="py-1.5 pr-3 font-medium text-muted-foreground">指标</th>
            {plans.map((plan) => (
              <th key={plan.id} className="max-w-[180px] truncate py-1.5 pr-3 font-semibold" title={plan.name}>
                {plan.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            let bestId: string | null = null
            if (row.raw && row.better && plans.length > 1) {
              let bestValue: number | null = null
              for (const plan of plans) {
                const v = row.raw(metricsById[plan.id])
                if (v == null) continue
                if (
                  bestValue === null ||
                  (row.better === 'higher' ? v > bestValue : v < bestValue)
                ) {
                  bestValue = v
                  bestId = plan.id
                } else if (v === bestValue) {
                  bestId = null // 并列最优不单独标注
                }
              }
            }
            return (
              <tr key={row.label} className="border-b border-border/60" title={row.title}>
                <td className="py-1.5 pr-3 text-muted-foreground">{row.label}</td>
                {plans.map((plan) => {
                  const m = metricsById[plan.id]
                  return (
                    <td key={plan.id} className="py-1.5 pr-3">
                      <span className="inline-flex items-center gap-1 tabular-nums">
                        {row.value(m)}
                        {row.estimate?.(m) ? <EstimateBadge /> : null}
                        {bestId === plan.id ? (
                          <Check className="h-3.5 w-3.5 text-success" aria-label="该指标较优" />
                        ) : null}
                      </span>
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
        指标由各方案数据实时计算，不使用写死的演示数字；「估算值」= 近似口径；旧版本方案缺失的数据显示「—」。
        绿色勾选 = 该行数值较优（面积越大 / 走线越短 / 问题越少），仅供参考，口径见行标题。
      </p>
    </div>
  )
}

function CableRow({
  cable,
  objects,
  diff,
}: {
  cable: CableConnection
  objects: SceneObject[]
  diff: boolean
}) {
  const nameOf = (id: string) => objects.find((o) => o.id === id)?.name ?? '未知设备'
  const visibility = resolveCableVisibility(cable, objects).visibility
  const thickness = resolveCableThickness(cable)
  const strategy = cable.route.strategy ?? CABLE_VISIBILITY_META[visibility].strategy
  const lengthM = cablePathLength(cable, objects)
  return (
    <div
      className={cn(
        'rounded-md border p-2 text-[11px] leading-relaxed',
        diff ? 'border-warning/60 bg-warning/5' : 'border-border',
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: diff ? DIFF_COLOR : CABLE_KIND_META[cable.kind].color }}
        />
        <span className="truncate font-medium">
          {nameOf(cable.from.objectId)} → {nameOf(cable.to.objectId)}
        </span>
        {diff ? <span className="text-[10px] font-medium text-warning">差异</span> : null}
      </div>
      <div className="text-muted-foreground">
        {CABLE_VISIBILITY_META[visibility].label} · {CABLE_THICKNESS_META[thickness].label} ·{' '}
        {CABLE_STRATEGY_META[strategy].label} · {CABLE_STATUS_META[cable.status].label}
        {lengthM !== null ? ` · ${cable.route.pathLengthM === undefined ? '≈' : ''}${lengthM.toFixed(2)} m` : ' · 路径长度未知'}
      </div>
    </div>
  )
}

/**
 * 候选方案对比页（/projects/:id/compare）：
 * - 勾选 1–3 个方案；统一三维视口（同一相机 / 场景尺寸，切换方案不重置镜头）+ 并排卡片 + 指标对比表；
 * - 差异对象（位姿不同 / 仅部分方案存在）与差异线缆高亮；可按分区着色；
 * - 查看为只读（不修改任何方案数据）；「设为当前方案并返回工作台」是唯一写入操作（可撤销）。
 */
export function PlanComparePage() {
  const { id } = useParams<{ id: string }>()
  const project = useProject(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const candidates = usePlansStore((s) => (project ? (s.candidates[project.id] ?? EMPTY_PLANS) : EMPTY_PLANS))
  const viewPreset = useWorkspaceStore((s) => s.viewPreset)
  const setViewPreset = useWorkspaceStore((s) => s.setViewPreset)
  const resetView = useWorkspaceStore((s) => s.resetView)
  const applyPlanSnapshot = useWorkspaceStore((s) => s.applyPlanSnapshot)
  const deskGlbLoaded = useDeskModelStore((s) => s.status === 'loaded')

  const webglOk = useMemo(detectWebGL, [])

  const [tab, setTab] = useState<'viewport' | 'cards'>('viewport')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PlanSortKey>('updated')
  const [showCables, setShowCables] = useState(true)
  const [zoneTint, setZoneTint] = useState(false)
  const [applyError, setApplyError] = useState<string | null>(null)

  // 初始选择：优先取 URL 传入的方案 id，其次最近更新的最多 3 个
  useEffect(() => {
    if (initialized || !project) return
    const available = new Set(candidates.map((p) => p.id))
    const raw = searchParams.get('plans')
    const fromQuery = (raw ? raw.split(',').filter(Boolean) : [])
      .filter((qid) => available.has(qid))
      .slice(0, MAX_COMPARE_PLANS)
    const fallback = [...candidates]
      .sort((a, b) => planUpdatedAt(b) - planUpdatedAt(a))
      .slice(0, MAX_COMPARE_PLANS)
      .map((p) => p.id)
    setSelectedIds(fromQuery.length > 0 ? fromQuery : fallback)
    setInitialized(true)
  }, [initialized, project, candidates, searchParams])

  // 方案被删除等导致的选择失效：自动剔除
  useEffect(() => {
    setSelectedIds((ids) => {
      const next = ids.filter((sid) => candidates.some((c) => c.id === sid))
      return next.length === ids.length ? ids : next
    })
  }, [candidates])

  // 视口当前方案：失效时回退到第一个已选方案
  useEffect(() => {
    setActiveId((cur) => (cur && selectedIds.includes(cur) ? cur : (selectedIds[0] ?? null)))
  }, [selectedIds])

  const metricsById = useMemo(() => {
    const map: Record<string, PlanMetrics | undefined> = {}
    if (!project) return map
    const preferences = resolveOrganizationPreferences(project)
    for (const plan of candidates) {
      map[plan.id] = computePlanMetrics(plan, {
        projectRoom: project.room,
        projectObjects: project.objects,
        preferences,
      })
    }
    return map
  }, [candidates, project])

  const visiblePlans = useMemo(
    () => filterSortPlans(candidates, query, sort, metricsById),
    [candidates, query, sort, metricsById],
  )

  const selectedPlans = useMemo(
    () =>
      selectedIds
        .map((sid) => candidates.find((c) => c.id === sid))
        .filter((p): p is LayoutPlan => Boolean(p)),
    [selectedIds, candidates],
  )

  const resolvedScenes: ResolvedPlanScene[] = useMemo(
    () => (project ? selectedPlans.map((plan) => resolvePlanScene(plan, project)) : []),
    [selectedPlans, project],
  )

  const diff = useMemo(() => computePlanDiff(resolvedScenes), [resolvedScenes])

  // 对比基准房间：所有方案共用（保证场景尺寸 / 显示比例一致）
  const baselineRoom = useMemo(
    () => selectedPlans.find((p) => p.scene?.room)?.scene?.room ?? project?.room ?? null,
    [selectedPlans, project],
  )

  const roomMismatchIds = useMemo(() => {
    const ids = new Set<string>()
    if (!baselineRoom) return ids
    const base = JSON.stringify(baselineRoom)
    for (const plan of selectedPlans) {
      if (plan.scene?.room && JSON.stringify(plan.scene.room) !== base) ids.add(plan.id)
    }
    return ids
  }, [selectedPlans, baselineRoom])

  const activePlan = selectedPlans.find((p) => p.id === activeId) ?? selectedPlans[0] ?? null
  const activeScene = activePlan
    ? (resolvedScenes.find((s) => s.planId === activePlan.id) ?? null)
    : null
  const activeMetrics = activePlan ? metricsById[activePlan.id] : undefined
  const activeDiff = activePlan ? diff.byPlan[activePlan.id] : null

  const toggleSelect = (planId: string) => {
    setSelectedIds((ids) => {
      if (ids.includes(planId)) return ids.filter((i) => i !== planId)
      if (ids.length >= MAX_COMPARE_PLANS) return ids
      return [...ids, planId]
    })
  }

  const handleSetCurrentAndBack = (plan: LayoutPlan) => {
    if (!project) return
    let summary
    try {
      summary = applyPlanSnapshot(project.id, plan)
    } catch (error) {
      setApplyError(error instanceof Error ? error.message : String(error))
      return
    }
    if (!summary) return
    if (useOrganizeStore.getState().isPreviewBlocking()) useOrganizeStore.getState().closePanel()
    const parts = [`已将「${plan.name}」设为当前方案`]
    if (summary.legacy) parts.push(`旧版本方案：仅恢复 ${summary.objects} 件物品位置（相关走线标记需重算）`)
    else parts.push(`恢复 ${summary.objects} 件物品与 ${summary.cables} 条走线`)
    if (summary.keptCables > 0) parts.push(`保留 ${summary.keptCables} 条保存后新增的线缆`)
    if (summary.skippedObjects > 0) parts.push(`跳过 ${summary.skippedObjects} 件已不存在的物品`)
    if (summary.skippedCables > 0) parts.push(`跳过 ${summary.skippedCables} 条接口已变化的线缆`)
    parts.push('可撤销')
    navigate(`/projects/${project.id}/workspace`, { state: { flash: parts.join('；') } })
  }

  if (!project) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <EmptyState
          title="项目不存在或已被删除"
          description="请返回项目列表，或打开内置示例项目继续体验。"
          action={<Button onClick={() => navigate('/')}>返回项目列表</Button>}
        />
      </div>
    )
  }

  const currentPlanId = project.lastAppliedPlan?.planId ?? null

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {applyError ? <p role="alert" className="bg-danger/10 px-4 py-2 text-xs text-danger">{applyError}</p> : null}
      <header className="z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-4 py-2">
        <Button
          variant="ghost"
          size="sm"
          title="返回工作台（不应用任何方案）"
          onClick={() => navigate(`/projects/${project.id}/workspace`)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          返回工作台
        </Button>
        <span className="text-sm font-semibold">方案对比</span>
        <span className="text-faint">/</span>
        <span className="max-w-[200px] truncate text-sm" title={project.name}>
          {project.name}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-muted-foreground sm:inline">
            所有方案共用同一相机角度与场景尺寸
          </span>
          <Segmented
            size="sm"
            value={viewPreset}
            onChange={(v) => setViewPreset(v as ViewPreset)}
            options={[
              { value: 'persp', label: '等距' },
              { value: 'top', label: '俯视' },
              { value: 'front', label: '正视' },
              { value: 'desk', label: '桌面' },
            ]}
          />
          <Button variant="ghost" size="icon" title="重置视角" onClick={resetView}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 方案选择：宽屏为左栏；窄屏为顶部可滚动列表 */}
        <aside className="flex max-h-44 w-full shrink-0 flex-col border-b border-border bg-surface lg:max-h-none lg:w-72 lg:border-b-0 lg:border-r">
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold">选择方案</span>
              <span className="text-[11px] text-muted-foreground">
                已选 {selectedIds.length}/{MAX_COMPARE_PLANS}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
                <Input
                  className="h-8 pl-7 text-[13px]"
                  placeholder="搜索方案名称"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <Select
                className="h-8 w-28 shrink-0 text-xs"
                value={sort}
                onChange={(e) => setSort(e.target.value as PlanSortKey)}
              >
                {PLAN_SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>
            <p className="text-[11px] text-muted-foreground">最多选择 3 个方案并排对比</p>
          </div>

          <div className="flex-1 space-y-1.5 overflow-y-auto p-3">
            {candidates.length === 0 ? (
              <EmptyState
                className="px-3 py-6"
                title="还没有候选方案"
                description="返回工作台点「保存方案」，把当前布局与线缆保存为方案后再来对比。"
                action={
                  <Button size="sm" onClick={() => navigate(`/projects/${project.id}/workspace`)}>
                    返回工作台
                  </Button>
                }
              />
            ) : visiblePlans.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
                没有匹配「{query}」的方案
              </p>
            ) : null}

            {visiblePlans.map((plan) => {
              const selected = selectedIds.includes(plan.id)
              const metrics = metricsById[plan.id]
              return (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => toggleSelect(plan.id)}
                  title={
                    selected
                      ? '取消选择'
                      : selectedIds.length >= MAX_COMPARE_PLANS
                        ? `最多选择 ${MAX_COMPARE_PLANS} 个方案`
                        : '选择该方案参与对比'
                  }
                  className={cn(
                    'flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors',
                    selected
                      ? 'border-primary bg-primary-soft/40'
                      : 'border-border hover:bg-muted/60',
                  )}
                >
                  <span
                    className={cn(
                      'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                      selected
                        ? 'border-primary bg-primary text-white'
                        : 'border-border bg-surface text-transparent',
                    )}
                  >
                    <Check className="h-3 w-3" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1">
                      <span className="truncate text-[13px] font-medium" title={plan.name}>
                        {plan.name}
                      </span>
                      {currentPlanId === plan.id ? (
                        <Star className="h-3 w-3 shrink-0 text-primary" aria-label="当前方案" />
                      ) : null}
                      {!plan.scene ? (
                        <span className="shrink-0 rounded border border-warning/50 px-1 py-px text-[10px] text-warning">
                          旧版本
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-[11px] tabular-nums text-muted-foreground">
                      更新 {formatPlanTime(planUpdatedAt(plan))}
                    </span>
                    {metrics ? (
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        物品 {metrics.objectCount} · 线缆 {metrics.cableCount ?? '—'} · 问题{' '}
                        {metrics.issueCount ?? '—'}
                      </span>
                    ) : null}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* 主区域 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <Segmented
              size="sm"
              value={tab}
              onChange={(v) => setTab(v as 'viewport' | 'cards')}
              options={[
                { value: 'viewport', label: '统一三维视口' },
                { value: 'cards', label: '并排卡片' },
              ]}
            />
            <span className="truncate text-[11px] text-muted-foreground">
              {selectedPlans.length > 0
                ? `已选：${selectedPlans.map((p) => p.name).join(' · ')}`
                : '请在左侧勾选 1–3 个方案'}
            </span>
          </div>

          {selectedPlans.length === 0 ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState
                title="选择要对比的方案"
                description="在左侧勾选 1–3 个候选方案：可在统一三维视口中切换查看，也可并排卡片与指标对比表对照。"
              />
            </div>
          ) : (
            <div className="flex min-h-0 flex-1">
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {tab === 'viewport' ? (
                  <>
                    <div className="flex flex-wrap items-center gap-1 border-b border-border px-3 py-2">
                      <span className="mr-1 text-xs text-muted-foreground">视口中查看：</span>
                      {selectedPlans.map((plan) => (
                        <button
                          key={plan.id}
                          type="button"
                          onClick={() => setActiveId(plan.id)}
                          className={cn(
                            'max-w-[160px] truncate rounded-full border px-2.5 py-1 text-xs transition-colors',
                            activePlan?.id === plan.id
                              ? 'border-primary bg-primary-soft text-primary'
                              : 'border-border hover:bg-muted',
                          )}
                          title={plan.name}
                        >
                          {plan.name}
                          {!plan.scene ? '（旧版本）' : ''}
                        </button>
                      ))}
                      {activePlan && roomMismatchIds.has(activePlan.id) ? (
                        <span className="text-[11px] text-warning">
                          * 该方案的房间配置与对比基准不同，视口按基准房间显示
                        </span>
                      ) : null}
                    </div>

                    <div className="relative min-h-0 flex-1">
                      {webglOk ? (
                        <Canvas
                          shadows
                          dpr={[1, 2]}
                          camera={{ position: [1.9, 1.6, 2.6], fov: 42 }}
                        >
                          <color attach="background" args={['#F4F1EA']} />
                          <fog attach="fog" args={['#F4F1EA', 9, 20]} />
                          <ambientLight intensity={0.55} />
                          <hemisphereLight args={['#FFF8EC', '#C9BFAC', 0.45]} />
                          <directionalLight
                            position={[2.5, 4, 3]}
                            intensity={1.1}
                            castShadow
                            shadow-mapSize-width={2048}
                            shadow-mapSize-height={2048}
                            shadow-camera-left={-3}
                            shadow-camera-right={3}
                            shadow-camera-top={3}
                            shadow-camera-bottom={-3}
                            shadow-camera-near={0.5}
                            shadow-camera-far={14}
                          />
                          <Suspense fallback={null}>
                            {baselineRoom ? (
                              <>
                                <RoomShell
                                  room={baselineRoom}
                                  deskMode="none"
                                  showBed={!deskGlbLoaded}
                                  showCableHoles={deskGlbLoaded}
                                />
                                <DormDeskModel room={baselineRoom} hideBedParts={viewPreset === 'top'} />
                              </>
                            ) : null}
                            {activeScene
                              ? activeScene.objects.map((object) => (
                                  <CompareObjectMesh
                                    key={object.id}
                                    object={object}
                                    zone={activeMetrics?.objectZones[object.id]}
                                    zoneTint={zoneTint}
                                    diff={activeDiff?.objectIds.has(object.id) ?? false}
                                  />
                                ))
                              : null}
                            {activeScene && showCables ? (
                              <CompareCables
                                cables={activeScene.cables}
                                objects={activeScene.objects}
                                diffIds={activeDiff?.cableIds ?? new Set()}
                              />
                            ) : null}
                          </Suspense>
                          <CameraRig preset={viewPreset} furnitureModel={activeScene?.room.furnitureModel} />
                        </Canvas>
                      ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/40 p-6 text-center">
                          <MonitorOff className="h-8 w-8 text-faint" />
                          <p className="text-sm font-medium">当前环境不支持 WebGL，三维对比不可用</p>
                          <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                            可改用「并排卡片」查看各方案的指标与详情；指标对比表同样可用。
                          </p>
                        </div>
                      )}

                      {/* 图例与显示开关（覆盖在视口上） */}
                      <div className="pointer-events-none absolute left-3 top-3 space-y-1">
                        <div className="rounded-md border border-border bg-surface/95 px-2.5 py-1.5 text-[11px] shadow-sm">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="inline-block h-2.5 w-2.5 rounded-sm border"
                              style={{ borderColor: DIFF_COLOR }}
                            />
                            琥珀色 = 与其它方案不同的物品 / 线缆
                          </span>
                        </div>
                        {activeDiff && (activeDiff.objectIds.size > 0 || activeDiff.cableIds.size > 0) ? (
                          <div className="rounded-md border border-border bg-surface/95 px-2.5 py-1 text-[11px] shadow-sm">
                            「{activePlan?.name}」差异：{activeDiff.objectIds.size} 件物品 ·{' '}
                            {activeDiff.cableIds.size} 条线缆
                          </div>
                        ) : selectedPlans.length > 1 ? (
                          <div className="rounded-md border border-border bg-surface/95 px-2.5 py-1 text-[11px] shadow-sm">
                            「{activePlan?.name}」与其它方案在物品位姿 / 线缆路径上一致
                          </div>
                        ) : null}
                      </div>
                      <div className="absolute right-3 top-3 flex flex-col items-end gap-1">
                        <label className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface/95 px-2 py-1 text-[11px] shadow-sm">
                          <input
                            type="checkbox"
                            className="accent-[#0F9D8A]"
                            checked={showCables}
                            onChange={(e) => setShowCables(e.target.checked)}
                          />
                          显示线缆
                        </label>
                        <label className="pointer-events-auto flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface/95 px-2 py-1 text-[11px] shadow-sm">
                          <input
                            type="checkbox"
                            className="accent-[#0F9D8A]"
                            checked={zoneTint}
                            onChange={(e) => setZoneTint(e.target.checked)}
                          />
                          按分区着色
                        </label>
                        {activePlan && !activePlan.scene ? (
                          <span className="rounded-md border border-warning/50 bg-surface/95 px-2 py-1 text-[11px] text-warning shadow-sm">
                            旧版本方案：无走线快照
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* 指标对比表 */}
                    <div className="max-h-[32%] shrink-0 overflow-y-auto border-t border-border px-4 py-3">
                      <h3 className="mb-2 text-[13px] font-semibold">指标对比表</h3>
                      <PlanMetricsTable plans={selectedPlans} metricsById={metricsById} />
                    </div>
                  </>
                ) : (
                  <div className="min-h-0 flex-1 overflow-y-auto p-4">
                    <div
                      className={cn(
                        'grid gap-3',
                        selectedPlans.length === 1
                          ? 'grid-cols-1 lg:grid-cols-1'
                          : selectedPlans.length === 2
                            ? 'grid-cols-1 lg:grid-cols-2'
                            : 'grid-cols-1 lg:grid-cols-2 xl:grid-cols-3',
                      )}
                    >
                      {selectedPlans.map((plan) => {
                        const metrics = metricsById[plan.id]
                        const planDiff = diff.byPlan[plan.id]
                        return (
                          <div key={plan.id} className="space-y-3 rounded-lg border border-border bg-surface p-4">
                            <div className="space-y-1">
                              <div className="flex items-center gap-1.5">
                                <span className="truncate text-sm font-semibold" title={plan.name}>
                                  {plan.name}
                                </span>
                                {currentPlanId === plan.id ? (
                                  <Badge variant="primary">当前方案</Badge>
                                ) : null}
                                {!plan.scene ? (
                                  <Badge
                                    variant="warning"
                                    title="0.8.0 之前保存：无线缆快照，线缆与问题数显示「—」，面积按现有物品估算"
                                  >
                                    旧版本快照
                                  </Badge>
                                ) : null}
                                {roomMismatchIds.has(plan.id) ? (
                                  <Badge variant="warning" title="该方案的房间配置与对比基准不同">
                                    房间不同
                                  </Badge>
                                ) : null}
                              </div>
                              <p className="text-[11px] tabular-nums text-muted-foreground">
                                创建 {formatPlanTime(plan.createdAt)} · 更新{' '}
                                {formatPlanTime(planUpdatedAt(plan))}
                              </p>
                              <p className="text-[11px] text-muted-foreground">来源：{sourceLabel(plan)}</p>
                            </div>

                            <div className="space-y-1 rounded-md bg-muted/50 px-3 py-2">
                              <MetricLine label="物品数量" value={metrics ? String(metrics.objectCount) : '—'} />
                              <MetricLine
                                label="已连接线缆"
                                value={metrics?.cableCount == null ? '—' : String(metrics.cableCount)}
                              />
                              <MetricLine
                                label="桌面可用面积"
                                value={
                                  metrics?.deskFreeAreaM2 == null
                                    ? '—'
                                    : `${metrics.deskFreeAreaM2.toFixed(2)} m²`
                                }
                                estimate={metrics?.deskFreeAreaM2 != null}
                                title="桌面矩形 − 平放物品包围盒相交面积（与整理方案同口径）"
                              />
                              <MetricLine
                                label="走线总长度"
                                value={
                                  metrics?.cableLengthM == null
                                    ? '—'
                                    : `${metrics.cableLengthM.toFixed(2)} m`
                                }
                                estimate={Boolean(metrics?.estimated.cableLength)}
                                title="按路径控制点折线估算"
                              />
                              <MetricLine
                                label="未解决问题"
                                value={metrics?.issueCount == null ? '—' : String(metrics.issueCount)}
                                title={
                                  metrics?.issueCount == null
                                    ? '旧版本方案无法回溯问题'
                                    : `摆放 ${metrics.placementIssueCount} 条 + 走线 ${metrics.cableIssueCount} 条`
                                }
                              />
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[11px] font-medium text-muted-foreground">
                                与其它所选方案差异
                              </p>
                              <p className="text-[11px] leading-relaxed text-muted-foreground">
                                {selectedPlans.length === 1
                                  ? '仅选了一个方案：勾选更多方案后显示差异'
                                  : planDiff && planDiff.objectIds.size + planDiff.cableIds.size > 0
                                    ? `${planDiff.objectIds.size} 件物品位姿不同 · ${planDiff.cableIds.size} 条线缆路径不同`
                                    : '物品位姿与线缆路径均一致'}
                                {!plan.scene ? '（旧版本方案无走线快照，线缆差异不可比）' : ''}
                              </p>
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[11px] font-medium text-muted-foreground">物品分区（估算）</p>
                              {metrics && metrics.zoneCounts.length > 0 ? (
                                <ZoneChips counts={metrics.zoneCounts} />
                              ) : (
                                <p className="text-[11px] text-muted-foreground">—</p>
                              )}
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[11px] font-medium text-muted-foreground">插排规格</p>
                              {metrics && metrics.powerStrips.length > 0 ? (
                                metrics.powerStrips.map((strip) => (
                                  <p key={strip.objectId} className="text-[11px] text-muted-foreground">
                                    {strip.name}：{strip.socketCount} 位 · 孔距 {strip.socketSpacingMm}mm · 负载上限{' '}
                                    {strip.maxLoadW}W
                                  </p>
                                ))
                              ) : (
                                <p className="text-[11px] text-muted-foreground">
                                  {plan.scene ? '无排插' : '旧版本方案不记录插排规格'}
                                </p>
                              )}
                            </div>

                            <div className="space-y-1.5">
                              <p className="text-[11px] font-medium text-muted-foreground">走线策略</p>
                              {metrics?.cableSummary ? (
                                <p className="text-[11px] leading-relaxed text-muted-foreground">
                                  可见线 {metrics.cableSummary.visibleCount} · 隐藏线{' '}
                                  {metrics.cableSummary.hiddenCount} · 出线槽{' '}
                                  {metrics.cableSummary.strategyCableHole} · 背板后{' '}
                                  {metrics.cableSummary.strategyBackboard} · 粗线{' '}
                                  {metrics.cableSummary.thickCount} · 细线 {metrics.cableSummary.thinCount}
                                  {metrics.cableSummary.unplannedCount > 0
                                    ? ` · 未规划 ${metrics.cableSummary.unplannedCount}`
                                    : ''}
                                </p>
                              ) : (
                                <p className="text-[11px] text-muted-foreground">旧版本方案无线缆数据</p>
                              )}
                            </div>

                            <div className="flex flex-wrap gap-1.5 pt-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setActiveId(plan.id)
                                  setTab('viewport')
                                }}
                              >
                                在视口中查看
                              </Button>
                              <Button
                                size="sm"
                                className="h-7 px-2 text-xs"
                                title="用该方案覆盖当前场景（可撤销）并返回工作台"
                                onClick={() => handleSetCurrentAndBack(plan)}
                              >
                                <Star className="h-3 w-3" />
                                设为当前方案并返回工作台
                              </Button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* 右侧：当前方案详情（视口 tab 的「切换查看」内容） */}
              {tab === 'viewport' && activePlan ? (
                <aside className="hidden w-72 shrink-0 flex-col overflow-y-auto border-l border-border bg-surface p-3 xl:flex">
                  <h3 className="text-[13px] font-semibold">当前视口方案详情</h3>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={activePlan.name}>
                    {activePlan.name} · 来源：{sourceLabel(activePlan)}
                  </p>

                  <div className="mt-2 space-y-1.5">
                    <p className="text-[11px] font-medium text-muted-foreground">物品分区（估算）</p>
                    {activeMetrics && activeMetrics.zoneCounts.length > 0 ? (
                      <ZoneChips counts={activeMetrics.zoneCounts} />
                    ) : (
                      <p className="text-[11px] text-muted-foreground">—</p>
                    )}
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      物品（{(activeScene?.objects ?? []).filter((o) => o.visible).length}）与差异标记
                    </p>
                    <div className="space-y-0.5">
                      {(activeScene?.objects ?? [])
                        .filter((o) => o.visible)
                        .map((object) => {
                          const isDiff = activeDiff?.objectIds.has(object.id) ?? false
                          return (
                            <div key={object.id} className="flex items-center gap-1.5 text-[11px]">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{
                                  background: ZONE_COLORS[activeMetrics?.objectZones[object.id] ?? 'desk'],
                                }}
                              />
                              <span className={cn('truncate', isDiff && 'font-medium text-warning')}>
                                {object.name}
                              </span>
                              {isDiff ? (
                                <span className="shrink-0 text-[10px] text-warning">差异</span>
                              ) : null}
                            </div>
                          )
                        })}
                    </div>
                  </div>

                  <div className="mt-3 space-y-1.5">
                    <p className="text-[11px] font-medium text-muted-foreground">插排规格</p>
                    {activeMetrics && activeMetrics.powerStrips.length > 0 ? (
                      activeMetrics.powerStrips.map((strip) => (
                        <p key={strip.objectId} className="text-[11px] text-muted-foreground">
                          {strip.name}：{strip.socketCount} 位 · 孔距 {strip.socketSpacingMm}mm · 负载上限{' '}
                          {strip.maxLoadW}W
                        </p>
                      ))
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        {activePlan.scene ? '无排插' : '旧版本方案不记录插排规格'}
                      </p>
                    )}
                  </div>

                  <div className="mt-3 space-y-1.5 pb-2">
                    <p className="text-[11px] font-medium text-muted-foreground">
                      走线（{activeScene?.cables.length ?? 0} 条，琥珀色 = 差异）
                    </p>
                    {activeScene && activeScene.cables.length > 0 ? (
                      activeScene.cables.map((cable) => (
                        <CableRow
                          key={cable.id}
                          cable={cable}
                          objects={activeScene.objects}
                          diff={activeDiff?.cableIds.has(cable.id) ?? false}
                        />
                      ))
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        {activePlan.scene ? '该方案未连接线缆' : '旧版本方案无走线快照'}
                      </p>
                    )}
                  </div>
                </aside>
              ) : null}
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
