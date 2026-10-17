import { useMemo, useState } from 'react'
import {
  Cable,
  ChevronDown,
  ChevronRight,
  Link2,
  Loader2,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  SkipForward,
  Wand2,
  X,
} from 'lucide-react'
import type { Project, SceneObject } from '@/types/project'
import {
  CABLE_KIND_META,
  CABLE_STATUS_META,
  CABLE_THICKNESS_META,
  CABLE_VISIBILITY_META,
  PORT_TYPE_LABELS,
} from '@/types/project'
import { cableDisplayPoints, hasUsableCableRoute, resolveCableThickness, resolveCableVisibility } from '@/scene/cables'
import { estimateCableLength } from '@/scene/cableRoute'
import { PORT_TYPE_COLORS } from '@/scene/ports'
import { useCableLink } from '@/lib/useCableLink'
import { formatMm } from '@/lib/units'
import { startCollectAnim } from '@/lib/collectAnim'
import { useCableStore } from '@/state/cableStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { Badge } from '@/ui/kit/badge'
import { Segmented } from '@/ui/kit/segmented'
import { cn } from '@/lib/utils'
import { CableManagementPanel } from './CableManagementPanel'

/**
 * 走线模式·左侧面板：线缆列表（状态 / 长度不足提示）+ 设备与接口浏览（点击两个接口建立连接）。
 * 规划调用后端算法，历史未验证路径按数据来源单独标记。
 */
export function CableListPanel({
  project,
  routingConfirmed,
  onConfirmRouting,
  busy,
  onPlanCables,
  onFlash,
  className,
  onClose,
  onAfterSelect,
}: {
  project: Project
  routingConfirmed: boolean
  onConfirmRouting: (confirmed: boolean) => void
  busy: boolean
  onPlanCables: (targetIds?: string[]) => void
  onFlash: (msg: string) => void
  className?: string
  onClose?: () => void
  onAfterSelect?: () => void
}) {
  const cables = project.cables
  const selectedCableId = useCableStore((s) => s.selectedCableId)
  const selectCable = useCableStore((s) => s.selectCable)
  const linkFrom = useCableStore((s) => s.linkFrom)
  const setLinkFrom = useCableStore((s) => s.setLinkFrom)
  const routeView = useCableStore((s) => s.routeView)
  const setRouteView = useCableStore((s) => s.setRouteView)
  const showPorts = useCableStore((s) => s.showPorts)
  const setShowPorts = useCableStore((s) => s.setShowPorts)
  const showRouteNodes = useCableStore((s) => s.showRouteNodes)
  const setShowRouteNodes = useCableStore((s) => s.setShowRouteNodes)
  const animStatus = useCableStore((s) => s.animStatus)
  const workspaceSelect = useWorkspaceStore((s) => s.select)
  const onPortClick = useCableLink()
  const [devicesOpen, setDevicesOpen] = useState(true)

  const staleIds = useMemo(
    () => cables.filter((c) => c.status === 'stale' || (c.planSource === 'demo-rule' && c.status !== 'conflict')).map((c) => c.id),
    [cables],
  )
  const conflictCount = cables.filter((c) => c.status === 'conflict').length
  const unverifiedHistoryCount = cables.filter((c) => c.planSource === 'demo-rule').length

  /** 每条线缆的长度估算与「长度不足」提示（按当前对比视图的路径实时计算） */
  const rows = useMemo(
    () =>
      cables.map((cable) => {
        const points = cableDisplayPoints(cable, project.objects, routeView)
        const est = routeView === 'suggested' && (cable.planSource === 'demo-rule' || cable.status === 'conflict' || points.length < 2) ? null
          : routeView === 'suggested' && cable.route.pathLengthM !== undefined
          ? cable.route.pathLengthM
          : estimateCableLength(points, routeView === 'original' || cable.route.smooth !== false)
        const reserve = cable.reserveLengthM ?? 0
        const actual = cable.actualLengthM ?? 0
        const required = est === null ? null : est + reserve
        return {
          cable,
          est,
          required,
          actual,
          shortage: required !== null && actual > 0 && actual < required - 0.0005,
        }
      }),
    [cables, project.objects, routeView],
  )

  const plannedCount = useMemo(
    () => cables.filter(hasUsableCableRoute).length,
    [cables],
  )

  const kinds = useMemo(
    () => Array.from(new Set(cables.map((c) => c.kind))),
    [cables],
  )

  const electricalWithPorts = project.objects.filter(
    (o) => o.visible && o.ports.length > 0 && (o.category === 'electrical' || o.needsPower),
  )
  const missingPorts = project.objects.filter(
    (o) => o.visible && o.ports.length === 0 && (o.category === 'electrical' || o.needsPower),
  ).length

  const handleEnsurePorts = () => {
    const count = useWorkspaceStore.getState().ensureDefaultPorts(project.id)
    onFlash(
      count > 0
        ? `已为 ${count} 台电气设备补充默认电源接口（可撤销）`
        : '所有电气设备都已有接口，无需补充',
    )
  }

  return (
    <aside className={cn('flex flex-col border-border bg-surface', className)}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold">
          <Cable className="h-4 w-4 text-primary" />
          线缆列表
          <span className="text-xs font-normal text-muted-foreground">（{cables.length} 条）</span>
        </h2>
        {onClose ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" title="关闭面板" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {/* 颜色 + 文字图例：电源线 / 视频线 / 数据线等 */}
        <div className="flex flex-wrap gap-1.5">
          {kinds.map((kind) => (
            <span
              key={kind}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: CABLE_KIND_META[kind].color }}
              />
              {CABLE_KIND_META[kind].label}
            </span>
          ))}
          {kinds.length === 0 ? (
            <p className="text-[11px] leading-relaxed text-faint">
              暂无线缆：展开下方「设备与接口」，依次点击两个接口即可建立连接。
            </p>
          ) : null}
        </div>

        {/* 规划操作 */}
        <div className="space-y-1.5">
          <label className="flex items-start gap-2 py-1 text-xs">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#0F9D8A]"
              checked={routingConfirmed}
              disabled={busy}
              onChange={(event) => onConfirmRouting(event.target.checked)}
            />
            已核对尺寸、位置与接口
          </label>
          <Button
            size="sm"
            className="w-full"
            disabled={busy || cables.length === 0}
            onClick={() => onPlanCables()}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
            {busy ? '规划走线中…' : '规划全部走线（真实后端）'}
          </Button>
          {staleIds.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              className="w-full border-warning/50 text-warning"
              disabled={busy}
              onClick={() => onPlanCables(staleIds)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              更新 {staleIds.length} 条「需重算」走线
            </Button>
          ) : null}
          {missingPorts > 0 ? (
            <Button size="sm" variant="outline" className="w-full" onClick={handleEnsurePorts}>
              <PlugZap className="h-3.5 w-3.5" />
              为 {missingPorts} 台设备补充默认接口
            </Button>
          ) : null}
        </div>

        {(staleIds.length > 0 || conflictCount > 0) && (
          <div className="space-y-1 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning">
            {staleIds.length > 0 ? <p>{staleIds.length} 条走线需重新计算</p> : null}
            {conflictCount > 0 ? <p>{conflictCount} 条走线未通过检查</p> : null}
          </div>
        )}

        {/* 原始 / 建议走线切换 + 叠加显示开关 */}
        <div className="space-y-2 rounded-lg border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">走线对比</span>
            <Segmented
              size="sm"
              value={routeView}
              onChange={setRouteView}
              options={[
                { value: 'original', label: '原始', title: '显示首次规划前保留的原始走线' },
                { value: 'suggested', label: '建议', title: '显示规划 / 调整后的走线' },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px]">
            <Toggle checked={showPorts} onChange={setShowPorts} label="显示接口" />
            <Toggle checked={showRouteNodes} onChange={setShowRouteNodes} label="路径节点" />
          </div>
          {/* 收拢动画（全部线缆）：路演三幕「原始 → 建议」对比入口，无需先选中某条线缆 */}
          <div className="flex items-center gap-1.5">
            {animStatus === 'playing' ? (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => useCableStore.getState().pauseAnim()}
              >
                <Pause className="h-3.5 w-3.5" />
                暂停收拢动画
              </Button>
            ) : animStatus === 'paused' ? (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => useCableStore.getState().resumeAnim()}
              >
                <Play className="h-3.5 w-3.5" />
                继续
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={busy}
                title="全部线缆从「原始走线」过渡到「建议走线」（展示用，可跳过）"
                onClick={() => startCollectAnim(project, onFlash)}
              >
                <Play className="h-3.5 w-3.5" />
                {animStatus === 'finished' ? '重播收拢动画（全部）' : '收拢动画（全部线缆）'}
              </Button>
            )}
            {animStatus !== 'idle' ? (
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                title="跳到结束"
                onClick={() => useCableStore.getState().skipAnim()}
              >
                <SkipForward className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
        </div>

        <CableManagementPanel project={project} busy={busy} onFlash={onFlash} />

        {/* 线缆列表 */}
        <div className="space-y-1.5">
          {rows.map(({ cable, est, required, actual, shortage }) => {
            const status = CABLE_STATUS_META[cable.planSource === 'demo-rule' && cable.status !== 'conflict' ? 'stale' : cable.status]
            const selected = cable.id === selectedCableId
            return (
              <button
                key={cable.id}
                type="button"
                onClick={() => {
                  selectCable(cable.id)
                  workspaceSelect(null)
                  onAfterSelect?.()
                }}
                className={cn(
                  'w-full rounded-lg border px-2.5 py-2 text-left transition-colors',
                  selected
                    ? 'border-primary/60 bg-primary-soft/50'
                    : 'border-border hover:border-primary/40 hover:bg-muted/40',
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: CABLE_KIND_META[cable.kind].color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {deviceName(project, cable.from.objectId)} → {deviceName(project, cable.to.objectId)}
                  </span>
                  <Badge variant={status.tone}>{status.label}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span>
                    {CABLE_KIND_META[cable.kind].label} ·{' '}
                    {CABLE_VISIBILITY_META[resolveCableVisibility(cable, project.objects).visibility].label} ·{' '}
                    {CABLE_THICKNESS_META[resolveCableThickness(cable)].label}
                  </span>
                  <span>·</span>
                  <span>估算 {est === null ? '未知' : formatMm(est)}</span>
                  {actual > 0 ? (
                    <>
                      <span>·</span>
                      <span>实际 {formatMm(actual)}</span>
                    </>
                  ) : null}
                  {shortage && required !== null ? (
                    <span className="font-medium text-danger">长度不足（差 {formatMm(required - actual)}）</span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>

        {/* 设备与接口 */}
        <section className="rounded-lg border border-border">
          <button
            type="button"
            className="flex w-full items-center gap-1.5 px-2.5 py-2 text-left text-[13px] font-medium"
            onClick={() => setDevicesOpen((v) => !v)}
          >
            {devicesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            设备与接口（{electricalWithPorts.length} 台）
          </button>
          {devicesOpen ? (
            <div className="space-y-2 px-2.5 pb-2.5">
              {linkFrom ? (
                <div className="flex items-center justify-between gap-1 rounded-md bg-primary-soft/60 px-2 py-1 text-[11px] text-primary">
                  <span>连线模式：已选起点，点击另一个接口完成连接</span>
                  <button
                    type="button"
                    className="shrink-0 underline"
                    onClick={() => setLinkFrom(null)}
                  >
                    取消
                  </button>
                </div>
              ) : (
                <p className="text-[11px] leading-relaxed text-faint">
                  点击设备接口开始连线：先点起点接口，再点终点接口。
                </p>
              )}
              {electricalWithPorts.map((object) => (
                <PortChips
                  key={object.id}
                  object={object}
                  linkFrom={linkFrom}
                  onPortClick={(portId) => onPortClick(project, object.id, portId)}
                />
              ))}
            </div>
          ) : null}
        </section>

        <div className="space-y-1 text-[11px] leading-relaxed text-faint">
          <p className="flex items-center gap-1.5">
            <DataBadge kind="real" label="后端算法" />
          </p>
          {unverifiedHistoryCount > 0 ? <p className="text-warning">历史未验证路径 {unverifiedHistoryCount} 条，需重新规划。</p> : null}
          {plannedCount > 0 ? <p>已规划走线 {plannedCount} 条（设备移动后会自动标记「需重算」）。</p> : null}
        </div>
      </div>
    </aside>
  )
}

function deviceName(project: Project, objectId: string): string {
  return project.objects.find((o) => o.id === objectId)?.name ?? '（已删除）'
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
      <input
        type="checkbox"
        className="accent-[#0F9D8A]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label}
    </label>
  )
}

function PortChips({
  object,
  linkFrom,
  onPortClick,
}: {
  object: SceneObject
  linkFrom: { objectId: string; portId: string } | null
  onPortClick: (portId: string) => void
}) {
  return (
    <div>
      <p className="mb-1 text-[12px] font-medium">{object.name}</p>
      <div className="flex flex-wrap gap-1">
        {object.ports.map((port) => {
          const active = linkFrom?.objectId === object.id && linkFrom?.portId === port.id
          return (
            <button
              key={port.id}
              type="button"
              onClick={() => onPortClick(port.id)}
              title={port.powered ? '供电接口' : '数据接口'}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
                active
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border hover:border-primary/50',
              )}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: PORT_TYPE_COLORS[port.type] }}
              />
              {port.label ?? PORT_TYPE_LABELS[port.type]}
              {active ? <Link2 className="h-3 w-3" /> : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}
