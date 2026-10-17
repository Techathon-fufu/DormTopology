import { useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  Lock,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sparkles,
  Star,
  Wand2,
  X,
} from 'lucide-react'
import type { Project, SceneObject } from '@/types/project'
import {
  CUP_CORNER_LABELS,
  CUP_CORNER_ORDER,
  resolveOrganizationPreferences,
  ZONE_COLORS,
  ZONE_DESCRIPTIONS,
  ZONE_LABELS,
  ZONE_ORDER,
  type CupCorner,
  type OrganizationPreferences,
} from '@/types/organization'
import { isMockMode, services } from '@/api'
import { SwitchToDemoButton } from '@/ui/service/SwitchToDemoButton'
import { useJobsStore } from '@/state/jobsStore'
import { useOrganizeStore } from '@/state/organizeStore'
import { usePlansStore } from '@/state/plansStore'
import { useProjectsStore } from '@/state/projectsStore'
import { useTourStore } from '@/state/tourStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { cn, formatDateTime } from '@/lib/utils'
import { organizationSource, canApplyOrganization } from '@/lib/organizationSession'
import { usePrefersReducedMotion } from '@/lib/motion'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { Segmented } from '@/ui/kit/segmented'
import { MmInput } from '@/ui/kit/mm-input'
import { Label, Separator } from '@/ui/kit/primitives'

/**
 * 空间整理面板（右侧停靠 / 抽屉复用）：
 * 偏好设置 → 生成整理方案（规则式演示）→ 整理结果预览 → 分批动画（暂停 / 跳过 / 重播）→ 接受 / 恢复原布局。
 * 整理前后对比使用同一镜头（不移动相机），指标全部来自本地场景数据计算并附口径说明。
 */

function Chip({
  active,
  tone = 'primary',
  disabled,
  title,
  onClick,
  children,
}: {
  active: boolean
  tone?: 'primary' | 'warning'
  disabled?: boolean
  title?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        active
          ? tone === 'warning'
            ? 'border-warning/50 bg-warning/10 text-warning'
            : 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border border-border px-2.5 py-2" title={hint}>
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums">{value}</p>
    </div>
  )
}

export function OrganizePanel({
  project,
  onFlash,
  className,
  onClose,
  onPreviewReady,
}: {
  project: Project
  onFlash: (msg: string) => void
  className?: string
  onPreviewReady?: () => void
  onClose?: () => void
}) {
  const status = useOrganizeStore((s) => s.status)
  const plan = useOrganizeStore((s) => s.plan)
  const commands = useOrganizeStore((s) => s.commands)
  const error = useOrganizeStore((s) => s.error)
  const compare = useOrganizeStore((s) => s.compare)
  const showZones = useOrganizeStore((s) => s.showZones)
  const batchIndex = useOrganizeStore((s) => s.batchIndex)
  const batchProgress = useOrganizeStore((s) => s.batchProgress)
  const sourceSignature = useOrganizeStore((s) => s.sourceSignature)
  const hidePanel = useOrganizeStore((s) => s.hidePanel)
  const closePanel = useOrganizeStore((s) => s.closePanel)
  const setCompare = useOrganizeStore((s) => s.setCompare)
  const setShowZones = useOrganizeStore((s) => s.setShowZones)
  const setStatus = useOrganizeStore((s) => s.setStatus)
  const setError = useOrganizeStore((s) => s.setError)
  const setPlan = useOrganizeStore((s) => s.setPlan)
  const startPlayback = useOrganizeStore((s) => s.startPlayback)
  const pausePlayback = useOrganizeStore((s) => s.pausePlayback)
  const resumePlayback = useOrganizeStore((s) => s.resumePlayback)
  const skipToEnd = useOrganizeStore((s) => s.skipToEnd)

  const createJob = useJobsStore((s) => s.create)
  const updateJob = useJobsStore((s) => s.update)
  const applyAssignments = useWorkspaceStore((s) => s.applyAssignments)
  const updateObject = useWorkspaceStore((s) => s.updateObject)
  const resetToBaseline = useWorkspaceStore((s) => s.resetToBaseline)
  const recaptureBaseline = usePlansStore((s) => s.recaptureBaseline)
  const baseline = usePlansStore((s) => s.baselines[project.id])
  const reducedMotion = usePrefersReducedMotion()

  const [stage, setStage] = useState('')

  const prefs = resolveOrganizationPreferences(project)
  const visibleObjects = project.objects.filter((o) => o.visible)

  const setPreferences = (patch: Partial<OrganizationPreferences>) => {
    if (useOrganizeStore.getState().isPreviewBlocking()) return
    useProjectsStore.getState().update(project.id, (p) => ({
      ...p,
      organization: { ...resolveOrganizationPreferences(p), ...patch },
    }))
  }

  const toggleFrequent = (o: SceneObject) => {
    if (useOrganizeStore.getState().isPreviewBlocking()) return
    updateObject(project.id, o.id, { frequent: !o.frequent }, false)
  }
  const toggleFixed = (o: SceneObject) => {
    if (useOrganizeStore.getState().isPreviewBlocking()) return
    updateObject(project.id, o.id, { fixed: !o.fixed }, false)
  }

  const typingOffsetKey: 'left' | 'center' | 'right' =
    prefs.typingOffsetX < -0.05 ? 'left' : prefs.typingOffsetX > 0.05 ? 'right' : 'center'

  const generate = async () => {
    const p = useProjectsStore.getState().projects[project.id]
    if (!p || useOrganizeStore.getState().status === 'planning') return
    const sessionToken = useOrganizeStore.getState().sessionToken
    const source = organizationSource(p)
    const job = createJob({
      projectId: p.id,
      type: 'layout',
      title: isMockMode ? '生成整理方案（规则式演示）' : '生成整理方案（真实后端）',
      mock: isMockMode,
    })
    setStatus('planning')
    setError(null)
    setStage('准备中')
    updateJob(job.id, { status: 'running', progress: 0.05, stageLabel: '准备中' })
    try {
      const result = await services.organizationPlanning.planOrganization({
        projectId: p.id,
        objects: p.objects,
        room: p.room,
        preferences: resolveOrganizationPreferences(p),
        onProgress: (progress, stageLabel) => {
          updateJob(job.id, { status: 'running', progress, stageLabel })
          if (stageLabel) setStage(stageLabel)
        },
      })
      const session = useOrganizeStore.getState()
      if (!session.open || session.sessionToken !== sessionToken) {
        updateJob(job.id, { status: 'canceled', resultNote: '预览已取消，本次结果未应用' })
        return
      }
      const current = useProjectsStore.getState().projects[p.id]
      if (!current || organizationSource(current) !== source || result.projectId !== p.id) {
        updateJob(job.id, { status: 'failed', error: '场景已变更，请重新生成方案' })
        if (useOrganizeStore.getState().open) { setStatus('config'); setError('场景已变更，请重新生成方案') }
        return
      }
      setPlan(result, p.objects, source)
      setShowZones(false)
      useWorkspaceStore.getState().setViewPreset('desk')
      startPlayback()
      onPreviewReady?.()
      updateJob(job.id, { status: 'success', progress: 1, resultNote: result.summary })
      const warnCount = result.serviceMeta?.warnings?.length ?? 0
      onFlash(
        isMockMode
          ? '整理方案已生成（规则式演示）：可播放整理动画、对比前后，再「接受方案」'
          : `整理方案已生成（真实后端${
              result.serviceMeta?.algorithmVersion
                ? `，算法版本 ${result.serviceMeta.algorithmVersion}`
                : ''
            }）${warnCount > 0 ? `；本地校验提示 ${warnCount} 条` : ''}：可播放整理动画、对比前后，再「接受方案」`,
      )
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (useOrganizeStore.getState().sessionToken === sessionToken) {
        setStatus('config')
        setError(msg)
      }
      updateJob(job.id, useOrganizeStore.getState().sessionToken === sessionToken ? { status: 'failed', error: msg } : { status: 'canceled', resultNote: '已取消本次预览' })
    }
  }

  const accept = () => {
    const current = useProjectsStore.getState().projects[project.id]
    if (!plan || commands.length === 0 || status !== 'finished' || compare !== 'after') return
    if (!current || !canApplyOrganization(sourceSignature, current)) {
      setError('场景已变更，此方案不能再应用。请取消预览后重新生成。')
      return
    }
    applyAssignments(
      project.id,
      plan.assignments.map((a) => ({
        objectId: a.objectId,
        position: a.position,
        rotationY: a.rotationY,
      })),
      true,
    )
    // 记录布局来源：保存候选方案时用于标注「算法来源」
    useProjectsStore.getState().update(project.id, (p) => ({
      ...p,
      layoutSource: plan.kind === 'algorithm' ? 'algorithm' : 'rule',
    }))
    closePanel()
    useTourStore.getState().signal(project.id, 'organize')
    onFlash(
      `已应用整理方案：${plan.metrics.placedCount} 件归位（可撤销；线缆仍为现状示意，可在走线模式重新规划）`,
    )
  }

  const discard = () => {
    closePanel()
    onFlash('已恢复整理前布局（整理的预览未应用）')
  }

  const planning = status === 'planning'
  const hasPlan = plan !== null
  const stale = hasPlan && !canApplyOrganization(sourceSignature, project)
  const batches = commands
  const currentBatch = batches.length > 0 ? batches[Math.min(batchIndex, batches.length - 1)] : null
  const progressPct = Math.round(
    batches.length > 0 ? ((batchIndex + batchProgress) / batches.length) * 100 : 100,
  )

  return (
    <aside className={cn('flex flex-col border-border bg-surface', className)}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Wand2 className="h-4 w-4 text-primary" />
          空间整理
        </h2>
        <div className="flex items-center gap-1.5">
          {isMockMode ? (
            <DataBadge kind="computed" label="规则式演示" />
          ) : (
            <DataBadge kind="real" label="真实后端算法" />
          )}
          {onClose ? (
            <Button variant="ghost" size="icon" className="h-7 w-7" title="关闭面板" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              title="收起整理面板（保留当前预览）"
              onClick={hidePanel}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {hasPlan ? <p className="rounded-lg border border-primary/20 bg-primary-soft px-3 py-2 text-xs leading-6 text-primary">方案仅在预览中。关闭面板会保留进度；接受后才写入项目。</p> : null}
        {hasPlan && (error || stale) ? <p role="alert" className="rounded-lg bg-warning/10 px-3 py-2 text-xs leading-6 text-warning">{error ?? '场景已变更，请取消预览后重新生成。'}</p> : null}
        {/* 分区说明 */}
        <section className="space-y-2 rounded-lg border border-border p-3">
          <h3 className="text-[13px] font-semibold">三个分区</h3>
          {ZONE_ORDER.map((z) => (
            <div key={z} className="flex items-start gap-2 text-xs leading-relaxed">
              <span
                className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: ZONE_COLORS[z] }}
              />
              <span>
                <span className="font-medium">{ZONE_LABELS[z]}</span>
                <span className="text-muted-foreground">：{ZONE_DESCRIPTIONS[z]}</span>
              </span>
            </div>
          ))}
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              className="accent-[#0F9D8A]"
              checked={showZones}
              onChange={(e) => setShowZones(e.target.checked)}
            />
            在三维视图中显示分区参考线
          </label>
        </section>

        {!hasPlan ? (
          <>
            {/* 可调整项 */}
            <fieldset disabled={planning} className="space-y-3 disabled:opacity-60">
            <section className="space-y-3 rounded-lg border border-border p-3">
              <h3 className="text-[13px] font-semibold">整理偏好（可调整）</h3>

              <div className="space-y-1.5">
                <Label>常用物品（优先放在易取位置）</Label>
                <div className="flex flex-wrap gap-1">
                  {visibleObjects.map((o) => (
                    <Chip
                      key={o.id}
                      active={Boolean(o.frequent)}
                      tone="warning"
                      title="点击切换：常用物品优先放在桌面常用区前排与两侧"
                      onClick={() => toggleFrequent(o)}
                    >
                      <Star className={cn('h-3 w-3', o.frequent && 'fill-current')} />
                      {o.name}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>固定位置物品（保持原位，不参与整理）</Label>
                <div className="flex flex-wrap gap-1">
                  {visibleObjects.map((o) => (
                    <Chip
                      key={o.id}
                      active={Boolean(o.fixed)}
                      tone="warning"
                      title={
                        o.locked ? '已锁定位置：请先在属性面板解锁' : '点击切换：固定物品保持原位'
                      }
                      onClick={() => {
                        if (!o.locked) toggleFixed(o)
                      }}
                    >
                      {o.locked ? <Lock className="h-3 w-3" /> : null}
                      {o.name}
                      {o.locked ? '（已锁定）' : ''}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>打字活动区（键鼠操作空间）</Label>
                <div className="flex items-center gap-2">
                  <Segmented
                    size="sm"
                    value={typingOffsetKey}
                    onChange={(v) =>
                      setPreferences({
                        typingOffsetX: v === 'left' ? -0.15 : v === 'right' ? 0.15 : 0,
                      })
                    }
                    options={[
                      { value: 'left', label: '偏左' },
                      { value: 'center', label: '居中' },
                      { value: 'right', label: '偏右' },
                    ]}
                  />
                  <MmInput
                    className="w-24"
                    value={prefs.typingWidth}
                    min={320}
                    max={Math.round((project.room.desk.width - 0.5) * 1000)}
                    onChange={(v) => setPreferences({ typingWidth: v })}
                  />
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  区域自动贴桌面靠人一侧；其它物品默认避让（高件避让书架搁板投影时可跨其后缘）。
                </p>
              </div>

              <div className="space-y-1.5">
                <Label>水杯活动区</Label>
                <Segmented
                  size="sm"
                  className="w-full"
                  value={prefs.cupCorner}
                  onChange={(v) => setPreferences({ cupCorner: v as CupCorner })}
                  options={CUP_CORNER_ORDER.map((c) => ({ value: c, label: CUP_CORNER_LABELS[c] }))}
                />
                <p className="text-[11px] text-faint">以使用者面向桌面时的方位为准</p>
              </div>

              <div className="space-y-1.5">
                <Label>偏好收纳分区（收纳容器优先去向）</Label>
                <Segmented
                  size="sm"
                  className="w-full"
                  value={prefs.preferredStorageZone}
                  onChange={(v) => setPreferences({ preferredStorageZone: v })}
                  options={ZONE_ORDER.map((z) => ({ value: z, label: ZONE_LABELS[z] }))}
                />
              </div>
            </section>

            {/* 整理前状态快照：接受方案后可一键恢复（“再恢复整理前状态”流程） */}
            </fieldset>
            <section className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold">整理前状态（快照）</h3>
                {baseline ? (
                  <span className="text-[11px] text-faint">{formatDateTime(baseline.createdAt)}</span>
                ) : null}
              </div>
              {baseline ? (
                <>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    接受整理方案后，可一键恢复到进入工作台时采集的整理前状态（一次记录，可撤销）。
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={planning}
                      onClick={() => {
                        resetToBaseline(project.id)
                        useTourStore.getState().signal(project.id, 'compare')
                        onFlash('已恢复到整理前状态（可撤销；相关线缆标记为需重算）')
                      }}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      恢复整理前状态
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={planning}
                      title="把当前布局记录为新的「整理前状态」快照（演示可重新开始对比）"
                      onClick={() => {
                        if (!window.confirm('将当前布局记录为新的「整理前状态」快照？')) return
                        const p = useProjectsStore.getState().projects[project.id]
                        if (!p) return
                        recaptureBaseline(p)
                        onFlash('已重新采集整理前状态快照')
                      }}
                    >
                      重新采集
                    </Button>
                  </div>
                </>
              ) : (
                <p className="text-[11px] text-faint">尚未采集：进入工作台时自动采集。</p>
              )}
            </section>

            {error ? (
              <div className="flex flex-wrap items-center gap-2 rounded-lg bg-danger/10 px-3 py-2 text-xs leading-relaxed text-danger">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span className="flex-1">方案生成失败：{error}</span>
                <SwitchToDemoButton />
              </div>
            ) : null}

            <Button className="w-full" size="sm" disabled={planning} onClick={() => void generate()}>
              {planning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {planning ? `生成中 · ${stage || '准备中'}` : '生成整理方案'}
            </Button>
            {planning ? <Button variant="ghost" size="sm" className="w-full" onClick={discard}>取消本次预览</Button> : null}
            <p className="text-xs leading-relaxed text-muted-foreground">
              {isMockMode
                ? '演示算法为可解释的规则式布局（本地计算，标注「规则式演示方案」）；真实布局 / 搬运优化算法入口已接入服务层（VITE_API_MODE=real 时调用后端）。'
                : '真实模式：方案由后端布局算法生成（经前端本地边界与引用校验，标注「真实后端算法」）；不可用时不会自动降级，请重试或切换到演示模式。'}
            </p>
          </>
        ) : (
          <>
            {/* 方案摘要 + 指标 */}
            <section className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[13px] font-semibold">整理结果预览</h3>
                <span className="text-[11px] text-faint">{formatDateTime(plan.createdAt)}</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">{plan.summary.replace(/，动画 \d+ 组/, `，操作 ${commands.length} 步`)}</p>
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="桌面可用面积"
                  hint="估算口径见下方说明"
                  value={
                    <span className="text-[13px]">
                      {plan.metrics.deskFreeAreaBefore.toFixed(2)} →{' '}
                      {plan.metrics.deskFreeAreaAfter.toFixed(2)} m²
                    </span>
                  }
                />
                <Stat
                  label="已归位物品"
                  value={`${plan.metrics.placedCount}/${plan.metrics.movableCount} 件`}
                />
                <Stat
                  label="未解决问题"
                  value={`${plan.metrics.unplacedCount + plan.metrics.overlapCount + plan.metrics.outOfBoundsCount} 项`}
                  hint={`未放置 ${plan.metrics.unplacedCount} · 相交 ${plan.metrics.overlapCount} · 越界 ${plan.metrics.outOfBoundsCount}`}
                />
              </div>
              <details className="text-xs leading-relaxed text-muted-foreground">
                <summary className="cursor-pointer select-none">指标口径说明</summary>
                <p className="mt-1">{plan.metrics.method}</p>
              </details>
            </section>

            {/* 动画 */}
            <section className="space-y-2 rounded-lg border border-border p-3">
              <h3 className="text-[13px] font-semibold">模型操作指令（逐步执行）</h3>
              {batches.length === 0 ? (
                <p className="text-xs text-muted-foreground">物品已在目标位置，无需动画。</p>
              ) : (
                <ul className="space-y-1">
                  {batches.map((b, i) => {
                    const done = status === 'finished' || i < batchIndex
                    const activeBatch = status === 'playing' || status === 'paused' ? i === batchIndex : false
                    return (
                      <li key={b.id} className={cn('rounded-lg border px-2.5 py-2 text-xs', activeBatch ? 'border-primary/30 bg-primary-soft text-primary' : 'border-border/70 text-muted-foreground')}>
                        <details>
                          <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                            {done ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : activeBatch ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> : <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[10px] tabular-nums">{i + 1}</span>}
                            <span className="min-w-0 flex-1 leading-5">{b.label}</span>
                            <span className="shrink-0 text-[10px] text-faint">理由</span>
                          </summary>
                          <p className="mt-2 border-t border-border/60 pt-2 leading-6 text-muted-foreground">{b.reason}</p>
                        </details>
                      </li>
                    )
                  })}
                </ul>
              )}

              {batches.length > 0 && status !== 'preview' ? (
                <div className="space-y-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="text-[11px] tabular-nums text-faint">
                    {status === 'finished'
                      ? '整理动画已完成（位置为目标布局）'
                      : `第 ${Math.min(batchIndex + 1, batches.length)}/${batches.length} 步 · ${currentBatch?.label ?? ''}`}
                  </p>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-1.5">
                {status === 'playing' ? (
                  <Button size="sm" variant="outline" onClick={pausePlayback}>
                    <Pause className="h-3.5 w-3.5" />
                    暂停
                  </Button>
                ) : status === 'paused' ? (
                  <Button size="sm" variant="outline" onClick={resumePlayback}>
                    <Play className="h-3.5 w-3.5" />
                    继续
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={batches.length === 0}
                    onClick={startPlayback}
                  >
                    {status === 'finished' ? (
                      <>
                        <RotateCcw className="h-3.5 w-3.5" />
                        重播
                      </>
                    ) : (
                      <>
                        <Play className="h-3.5 w-3.5" />
                        播放整理动画
                      </>
                    )}
                  </Button>
                )}
                {(status === 'playing' || status === 'paused') && batches.length > 0 ? (
                  <Button size="sm" variant="outline" onClick={skipToEnd}>
                    <SkipForward className="h-3.5 w-3.5" />
                    查看最终效果
                  </Button>
                ) : null}
              </div>
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3 w-3 shrink-0" />
                动画仅用于方案展示，根据物品位置与朝向逐条执行展示指令，不代表真实搬运路径已经过碰撞验证。
              </p>
              {reducedMotion ? (
                <p className="rounded-md bg-info/10 px-2 py-1.5 text-[11px] leading-relaxed text-info">
                  已检测到系统「减少动态效果」偏好：播放时直接显示目标布局，直接呈现执行结果。
                </p>
              ) : null}
            </section>

            {/* 对比 */}
            <section className="space-y-2 rounded-lg border border-border p-3">
              <h3 className="text-[13px] font-semibold">整理前后对比</h3>
              <Segmented
                size="sm"
                className="w-full"
                value={compare}
                onChange={(v) => {
                  if (v === 'after') skipToEnd()
                  else setCompare(v)
                  useTourStore.getState().signal(project.id, 'compare')
                }}
                options={[
                  { value: 'before', label: '查看整理前' },
                  { value: 'after', label: '查看整理后' },
                ]}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                一键切换即时对比；相机保持同一视角不变。切换到「整理前」会暂停演示；继续播放会回到操作预览。
              </p>
            </section>

            {/* 规则解释 */}
            <section className="space-y-2 rounded-lg border border-border p-3">
              <h3 className="text-[13px] font-semibold">规则解释（按执行顺序）</h3>
              <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-muted-foreground">
                {plan.rules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            </section>

            {/* 落位示例 */}
            <section className="space-y-2 rounded-lg border border-border p-3">
              <h3 className="text-[13px] font-semibold">为什么这样放（示例）</h3>
              <ul className="space-y-1.5">
                {plan.assignments.slice(0, 6).map((a) => {
                  const obj = project.objects.find((o) => o.id === a.objectId)
                  return (
                    <li key={a.objectId} className="text-[11px] leading-relaxed">
                      <span className="font-medium">{obj?.name ?? a.objectId}</span>
                      <span className="text-muted-foreground"> → {ZONE_LABELS[a.zone]}：{a.reason}</span>
                    </li>
                  )
                })}
              </ul>
              {plan.assignments.length > 6 ? (
                <p className="text-[11px] text-faint">其余 {plan.assignments.length - 6} 件按相同规则落位。</p>
              ) : null}
            </section>

            {/* 未放置 */}
            <section className="space-y-2 rounded-lg border border-border p-3">
              <h3 className="text-[13px] font-semibold">未放置物品（空间不足）</h3>
              {plan.unplaced.length === 0 ? (
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-success">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  全部可移动物品均已放置。
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {plan.unplaced.map((u) => (
                    <li
                      key={u.objectId}
                      className="rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning"
                    >
                      <span className="font-medium">{u.name}</span>：{u.reason}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {hasPlan ? (
        <>
          <Separator />
          <div className="space-y-1.5 p-3">
            <div className="flex gap-2">
              <Button className="flex-1" size="sm" disabled={status !== 'finished' || compare !== 'after' || stale || commands.length === 0} onClick={accept}>
                <CheckCircle2 className="h-3.5 w-3.5" />
                {commands.length === 0 ? '无需应用变更' : '接受方案'}
              </Button>
              <Button className="flex-1" size="sm" variant="outline" onClick={discard}>
                <RotateCcw className="h-3.5 w-3.5" />
                取消预览
              </Button>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              查看最终效果后可接受。接受后写入项目（一次可撤销记录，Ctrl+Z 可回到整理前）；预览与动画不会修改项目数据。
            </p>
          </div>
        </>
      ) : null}
    </aside>
  )
}
