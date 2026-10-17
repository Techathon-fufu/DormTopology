import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, GitCompareArrows, Pencil, Save, Search, Star, Trash2, X } from 'lucide-react'
import type { LayoutPlan, Project } from '@/types/project'
import { PLAN_CABLE_SOURCE_LABELS, PLAN_LAYOUT_SOURCE_LABELS } from '@/types/project'
import { resolveOrganizationPreferences } from '@/types/organization'
import { usePlansStore } from '@/state/plansStore'
import { useProjectsStore } from '@/state/projectsStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import {
  MAX_COMPARE_PLANS,
  PLAN_SORT_OPTIONS,
  computePlanMetrics,
  filterSortPlans,
  formatPlanTime,
  type PlanMetrics,
  type PlanSortKey,
} from '@/lib/planMetrics'
import { cn } from '@/lib/utils'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { EmptyState } from '@/ui/kit/empty-state'
import { EstimateBadge } from '@/ui/kit/estimate-badge'
import { Input, Select } from '@/ui/kit/primitives'

/** 无方案时的稳定空数组（避免每次都新建引用触发重渲染） */
const EMPTY_PLANS: LayoutPlan[] = []

function MetricRow({
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
    <div className="flex items-center justify-between gap-1" title={title}>
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1 font-medium tabular-nums text-foreground">
        {value}
        {estimate ? <EstimateBadge /> : null}
      </span>
    </div>
  )
}

/**
 * 候选方案面板（工作台右侧停靠 / 小屏抽屉）：
 * 列表（名称 / 时间 / 数量 / 面积 / 走线长度 / 问题数 / 算法来源）、搜索与排序、
 * 重命名 / 复制 / 删除（二次确认）/ 设为当前方案，勾选 1–3 个进入对比页。
 * 指标全部由方案快照实时计算，不写死；旧版本方案按「旧版本」标注并显示「—」。
 */
export function PlanPanel({
  project,
  onFlash,
  className,
  onClose,
}: {
  project: Project
  onFlash: (msg: string) => void
  className?: string
  onClose?: () => void
}) {
  const navigate = useNavigate()
  const candidates = usePlansStore((s) => s.candidates[project.id] ?? EMPTY_PLANS)
  const saveCandidate = usePlansStore((s) => s.saveCandidate)
  const renameCandidate = usePlansStore((s) => s.renameCandidate)
  const duplicateCandidate = usePlansStore((s) => s.duplicateCandidate)
  const removeCandidate = usePlansStore((s) => s.removeCandidate)

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<PlanSortKey>('updated')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const metricsById = useMemo(() => {
    const preferences = resolveOrganizationPreferences(project)
    const map: Record<string, PlanMetrics | undefined> = {}
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

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds])
  const currentPlanId = project.lastAppliedPlan?.planId ?? null

  const toggleSelect = (planId: string) => {
    setSelectedIds((ids) => {
      if (ids.includes(planId)) return ids.filter((id) => id !== planId)
      if (ids.length >= MAX_COMPARE_PLANS) return ids
      return [...ids, planId]
    })
  }

  const handleSave = () => {
    const p = useProjectsStore.getState().projects[project.id]
    if (!p) return
    const plan = saveCandidate(p)
    onFlash(`已保存「${plan.name}」：含物品布局、线缆路径与来源快照，可在本面板对比`)
  }

  const handleSetCurrent = (plan: LayoutPlan) => {
    let discardedPreview = false
    if (useOrganizeStore.getState().isPreviewBlocking()) {
      useOrganizeStore.getState().closePanel()
      discardedPreview = true
    }
    const summary = useWorkspaceStore.getState().applyPlanSnapshot(project.id, plan)
    if (!summary) return
    const parts = [`已将「${plan.name}」设为当前方案`]
    if (summary.legacy) {
      parts.push(`旧版本方案：仅恢复 ${summary.objects} 件物品位置（无线缆快照，相关走线已标记需重算）`)
    } else {
      parts.push(`恢复 ${summary.objects} 件物品位姿 / 插排规格与 ${summary.cables} 条走线`)
      if (summary.keptCables > 0) parts.push(`保留 ${summary.keptCables} 条保存后新增的线缆`)
      if (summary.skippedObjects > 0) parts.push(`跳过 ${summary.skippedObjects} 件已不存在的物品`)
      if (summary.skippedCables > 0) parts.push(`跳过 ${summary.skippedCables} 条接口已变化的线缆`)
    }
    if (discardedPreview) parts.push('未接受的整理预览已丢弃')
    parts.push('可撤销')
    onFlash(parts.join('；'))
  }

  const handleRenameSubmit = (plan: LayoutPlan) => {
    const name = renameValue.trim()
    if (!name || name === plan.name) {
      setRenameId(null)
      return
    }
    renameCandidate(project.id, plan.id, name)
    setRenameId(null)
    onFlash(`方案已重命名为「${name}」`)
  }

  const handleDuplicate = (plan: LayoutPlan) => {
    const copy = duplicateCandidate(project.id, plan.id)
    if (copy) onFlash(`已复制「${plan.name}」为「${copy.name}」（含场景快照）`)
  }

  const handleDelete = (plan: LayoutPlan) => {
    removeCandidate(project.id, plan.id)
    setDeletingId(null)
    setSelectedIds((ids) => ids.filter((id) => id !== plan.id))
    onFlash(`已删除方案「${plan.name}」（不影响当前场景与其它方案）`)
  }

  const goCompare = () => {
    if (selectedIds.length === 0) return
    navigate(`/projects/${project.id}/compare?plans=${selectedIds.join(',')}`)
  }

  return (
    <aside className={cn('flex flex-col border-border bg-surface', className)}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <GitCompareArrows className="h-4 w-4 text-primary" />
          候选方案
          {candidates.length > 0 ? (
            <span className="text-xs font-normal text-muted-foreground">（{candidates.length}）</span>
          ) : null}
        </h2>
        {onClose ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="关闭面板"
            onClick={onClose}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        <Button variant="outline" size="sm" className="w-full" onClick={handleSave}>
          <Save className="h-3.5 w-3.5" />
          保存当前方案（含线缆快照）
        </Button>

        {candidates.length === 0 ? (
          <EmptyState
            className="px-4 py-8"
            title="还没有候选方案"
            description="点「保存方案」把当前布局、物品与线缆保存为方案；之后可在这里对比、复制或设为当前。最多可并排对比 3 个方案。"
            action={
              <Button size="sm" onClick={handleSave}>
                <Save className="h-3.5 w-3.5" />
                保存当前方案
              </Button>
            }
          />
        ) : (
          <>
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
                className="h-8 w-32 shrink-0 text-xs"
                value={sort}
                onChange={(e) => setSort(e.target.value as PlanSortKey)}
                title="排序方式"
              >
                {PLAN_SORT_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </div>

            <p className="text-[11px] text-muted-foreground">
              勾选 {selectedIds.length}/{MAX_COMPARE_PLANS} 个方案进入对比
              {selectedIds.length > 0 ? (
                <button
                  type="button"
                  className="ml-2 text-primary hover:underline"
                  onClick={() => setSelectedIds([])}
                >
                  清空选择
                </button>
              ) : null}
            </p>

            {visiblePlans.length === 0 ? (
              <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[13px] text-muted-foreground">
                没有匹配「{query}」的方案
              </p>
            ) : null}

            {visiblePlans.map((plan) => {
              const metrics = metricsById[plan.id]
              const selected = selectedSet.has(plan.id)
              const isCurrent = currentPlanId === plan.id
              const legacy = !plan.scene
              const sourceLabel = plan.source
                ? `${PLAN_LAYOUT_SOURCE_LABELS[plan.source.layout]} · ${
                    PLAN_CABLE_SOURCE_LABELS[plan.source.cable]
                  }`
                : '未记录（旧版本方案）'
              const metricsTitle = metrics
                ? [
                    `物品 ${metrics.objectCount} 件（可见）`,
                    metrics.cableCount === null ? '线缆：旧版本方案无数据' : `连接线缆 ${metrics.cableCount} 条`,
                    metrics.deskFreeAreaM2 === null
                      ? '桌面可用面积：无法估算'
                      : `桌面可用面积 ≈ ${metrics.deskFreeAreaM2.toFixed(2)} m²（估算口径）`,
                    metrics.cableLengthM === null
                      ? '走线总长度：无数据'
                      : `走线总长度 ≈ ${metrics.cableLengthM.toFixed(2)} m（按路径折线估算）`,
                    metrics.issueCount === null
                      ? '未解决问题：旧版本方案无法回溯'
                      : `未解决问题 ${metrics.issueCount} 条 = 摆放 ${metrics.placementIssueCount} + 走线 ${metrics.cableIssueCount}`,
                    metrics.cableSummary
                      ? `走线：可见线 ${metrics.cableSummary.visibleCount} · 隐藏线 ${metrics.cableSummary.hiddenCount} · 粗线 ${metrics.cableSummary.thickCount} · 细线 ${metrics.cableSummary.thinCount}${
                          metrics.cableSummary.unplannedCount > 0
                            ? ` · 未规划 ${metrics.cableSummary.unplannedCount}`
                            : ''
                        }`
                      : '',
                  ]
                    .filter(Boolean)
                    .join('\n')
                : undefined

              return (
                <div
                  key={plan.id}
                  className={cn(
                    'space-y-2 rounded-lg border p-3',
                    selected ? 'border-primary bg-primary-soft/40' : 'border-border',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      title={
                        selected
                          ? '取消选择'
                          : selectedIds.length >= MAX_COMPARE_PLANS
                            ? `最多选择 ${MAX_COMPARE_PLANS} 个方案`
                            : '选中用于对比'
                      }
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        selected
                          ? 'border-primary bg-primary text-white'
                          : 'border-border bg-surface text-transparent hover:border-primary',
                      )}
                      onClick={() => toggleSelect(plan.id)}
                    >
                      <Check className="h-3 w-3" />
                    </button>

                    <div className="min-w-0 flex-1">
                      {renameId === plan.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            className="h-7 text-[13px]"
                            value={renameValue}
                            autoFocus
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRenameSubmit(plan)
                              if (e.key === 'Escape') setRenameId(null)
                            }}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="保存名称"
                            onClick={() => handleRenameSubmit(plan)}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="取消"
                            onClick={() => setRenameId(null)}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="truncate text-[13px] font-semibold" title={plan.name}>
                            {plan.name}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            title="重命名"
                            onClick={() => {
                              setRenameId(plan.id)
                              setRenameValue(plan.name)
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      )}
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {isCurrent ? (
                          <Badge
                            variant="primary"
                            title={`当前方案：${
                              project.updatedAt > (project.lastAppliedPlan?.at ?? 0) + 1000
                                ? '应用后场景又有改动（Ctrl+Z 可撤销应用）'
                                : '与工作台场景一致'
                            }`}
                          >
                            <Star className="h-3 w-3" />
                            当前方案
                          </Badge>
                        ) : null}
                        {legacy ? (
                          <Badge
                            variant="warning"
                            title="0.8.0 之前保存：无场景 / 线缆快照，线缆与问题数只能显示「—」，面积按现有物品尺寸估算"
                          >
                            旧版本快照
                          </Badge>
                        ) : null}
                        <span className="text-[11px] tabular-nums text-muted-foreground">
                          创建 {formatPlanTime(plan.createdAt)} · 更新{' '}
                          {formatPlanTime(plan.updatedAt ?? plan.createdAt)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 rounded-md bg-muted/50 px-2 py-1.5 text-xs" title={metricsTitle}>
                    <MetricRow label="物品" value={metrics ? String(metrics.objectCount) : '—'} />
                    <MetricRow
                      label="线缆"
                      value={metrics?.cableCount == null ? '—' : String(metrics.cableCount)}
                    />
                    <MetricRow
                      label="桌面可用"
                      value={metrics?.deskFreeAreaM2 == null ? '—' : `${metrics.deskFreeAreaM2.toFixed(2)} m²`}
                      estimate={metrics?.deskFreeAreaM2 != null}
                    />
                    <MetricRow
                      label="走线总长"
                      value={metrics?.cableLengthM == null ? '—' : `${metrics.cableLengthM.toFixed(2)} m`}
                      estimate={metrics?.cableLengthM != null}
                    />
                    <MetricRow
                      label="未解决问题"
                      value={metrics?.issueCount == null ? '—' : String(metrics.issueCount)}
                    />
                  </div>
                  <p className="-mt-1 text-[11px] leading-relaxed text-muted-foreground" title={sourceLabel}>
                    来源：{sourceLabel}
                  </p>
                  {metrics && metrics.powerStrips.length > 0 ? (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      插排：
                      {metrics.powerStrips
                        .map(
                          (s) =>
                            `${s.name} ${s.socketCount} 位 / 孔距 ${s.socketSpacingMm}mm / ${s.maxLoadW}W`,
                        )
                        .join('；')}
                    </p>
                  ) : null}

                  {deletingId === plan.id ? (
                    <div className="flex items-center gap-2 rounded-md border border-danger/40 bg-danger/5 p-2">
                      <span className="flex-1 text-[11px] leading-snug text-danger">
                        删除「{plan.name}」？删除后不可恢复（不影响当前场景）
                      </span>
                      <Button variant="danger" size="sm" className="h-7 px-2 text-xs" onClick={() => handleDelete(plan)}>
                        确认删除
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setDeletingId(null)}
                      >
                        取消
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        title="用该方案覆盖当前场景（物品位姿 / 插排规格 / 线缆），可撤销"
                        onClick={() => handleSetCurrent(plan)}
                      >
                        <Star className="h-3 w-3" />
                        设为当前
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        title="复制方案（含场景快照）"
                        onClick={() => handleDuplicate(plan)}
                      >
                        <Copy className="h-3 w-3" />
                        复制
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs text-danger hover:bg-danger/10"
                        title="删除方案（需二次确认）"
                        onClick={() => setDeletingId(plan.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                        删除
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <Button
          className="w-full"
          disabled={selectedIds.length === 0}
          title={
            selectedIds.length === 0
              ? `先勾选 1–${MAX_COMPARE_PLANS} 个方案`
              : '打开对比页：统一三维视口 + 并排卡片 + 指标对比表'
          }
          onClick={goCompare}
        >
          <GitCompareArrows className="h-3.5 w-3.5" />
          对比选中方案（{selectedIds.length}/{MAX_COMPARE_PLANS}）
        </Button>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          对比页使用同一相机角度与场景尺寸；切换方案不修改任何已保存数据。
        </p>
      </div>
    </aside>
  )
}
