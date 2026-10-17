import { useMemo } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Pause,
  Play,
  Plus,
  RefreshCw,
  SkipForward,
  Trash2,
  X,
} from 'lucide-react'
import type { CableConnection, Project, Vec3 } from '@/types/project'
import {
  CABLE_KIND_META,
  CABLE_STATUS_META,
  PORT_TYPE_LABELS,
  type CableKind,
} from '@/types/project'
import { resolveOrganizationPreferences } from '@/types/organization'
import { cableDisplayPoints, endpointOf, endpointLabel } from '@/scene/cables'
import { checkCableRoute } from '@/scene/cableRoute'
import { computeCableAvoidZones, computeRouteNodes, routeNodeMap } from '@/scene/routeNodes'
import { PORT_TYPE_COLORS } from '@/scene/ports'
import { formatMm, formatMeters } from '@/lib/units'
import { startCollectAnim } from '@/lib/collectAnim'
import { useCableStore } from '@/state/cableStore'
import { useTourStore } from '@/state/tourStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { usePrefersReducedMotion } from '@/lib/motion'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { MmInput } from '@/ui/kit/mm-input'
import { Label, Select, Separator } from '@/ui/kit/primitives'
import { Segmented } from '@/ui/kit/segmented'
import { cn } from '@/lib/utils'

/**
 * 走线模式·右侧面板（选中线缆属性）：
 * 连接信息编辑 / 路径节点列表与微调 / 实际线长与预留 / 平滑路径障碍检查 / 原始-建议对比 / 收拢动画。
 * 所有检查与估算均为本地计算（规则式演示），界面就地标注，不显示为「已完成真实算法验证」。
 */
export function CablePanel({
  project,
  busy,
  onPlanCables,
  onFlash,
  className,
  onClose,
}: {
  project: Project
  busy: boolean
  onPlanCables: (targetIds?: string[]) => void
  onFlash: (msg: string) => void
  className?: string
  onClose?: () => void
}) {
  const selectedCableId = useCableStore((s) => s.selectedCableId)
  const selectCable = useCableStore((s) => s.selectCable)
  const selectedNodeIndex = useCableStore((s) => s.selectedNodeIndex)
  const selectNode = useCableStore((s) => s.selectNode)
  const routeView = useCableStore((s) => s.routeView)
  const setRouteView = useCableStore((s) => s.setRouteView)
  const animStatus = useCableStore((s) => s.animStatus)
  const updateCable = useWorkspaceStore((s) => s.updateCable)
  const removeCable = useWorkspaceStore((s) => s.removeCable)
  const reducedMotion = usePrefersReducedMotion()

  const cable = project.cables.find((c) => c.id === selectedCableId) ?? null
  const routeNodes = useMemo(() => computeRouteNodes(project.room), [project.room])
  const nodeMap = useMemo(() => routeNodeMap(routeNodes), [routeNodes])
  const avoidZones = useMemo(
    () => computeCableAvoidZones(project.room, resolveOrganizationPreferences(project)),
    [project],
  )

  const displayPoints = useMemo(
    () => (cable ? cableDisplayPoints(cable, project.objects, routeView) : []),
    [cable, project.objects, routeView],
  )

  const check = useMemo(() => {
    if (!cable) return null
    return checkCableRoute({
      points: displayPoints,
      from: cable.from,
      to: cable.to,
      objects: project.objects,
      room: project.room,
      avoidZones,
    })
  }, [cable, displayPoints, project.objects, project.room, avoidZones])

  if (!cable || !check) {
    return (
      <aside className={cn('flex flex-col border-border bg-surface', className)}>
        <div className="px-3 pt-3 text-sm font-semibold">线缆属性</div>
        <p className="px-3 py-3 text-xs text-muted-foreground">
          未选中线缆：在左侧列表或三维视图中点击一条线缆查看 / 编辑属性。
        </p>
      </aside>
    )
  }

  const status = CABLE_STATUS_META[cable.status]
  const kindMeta = CABLE_KIND_META[cable.kind]
  const innerCount = Math.max(0, cable.route.points.length - 2)
  const ids: (string | null)[] =
    cable.route.nodeIds && cable.route.nodeIds.length === cable.route.points.length
      ? cable.route.nodeIds
      : cable.route.points.map(() => null)

  const est = check.lengthM
  const reserve = cable.reserveLengthM ?? 0
  const actual = cable.actualLengthM ?? 0
  const required = est + reserve
  const shortage = actual > 0 && actual < required - 0.0005

  const usedNodeLabels = Array.from(
    new Set(ids.filter((id): id is string => Boolean(id))),
  ).map((id) => nodeMap.get(id)?.label ?? id)

  const portOptions = project.objects
    .filter((o) => o.visible && o.ports.length > 0 && (o.category === 'electrical' || o.needsPower))
    .flatMap((o) =>
      o.ports.map((p) => ({
        value: `${o.id}::${p.id}`,
        label: `${o.name} · ${p.label ?? PORT_TYPE_LABELS[p.type]}`,
      })),
    )

  const setEndpoint = (which: 'from' | 'to', value: string) => {
    const [objectId, portId] = value.split('::')
    const object = project.objects.find((o) => o.id === objectId)
    const port = object?.ports.find((p) => p.id === portId)
    if (!object || !port) return
    updateCable(project.id, cable.id, (c) => ({
      ...c,
      [which]: endpointOf(object, port),
      status: 'stale',
      note: '连接端点已修改：走线需重新计算',
      updatedAt: Date.now(),
    }))
    onFlash('已更新连接端点：走线标记为「需重新计算」')
  }

  const swapEndpoints = () => {
    updateCable(project.id, cable.id, (c) => ({
      ...c,
      from: c.to,
      to: c.from,
      status: 'stale',
      note: '已交换起止端点：建议重新计算走线',
      updatedAt: Date.now(),
    }))
  }

  const mutateRoute = (
    fn: (points: Vec3[], ids: (string | null)[]) => { points: Vec3[]; ids: (string | null)[] },
    note: string,
  ) => {
    updateCable(project.id, cable.id, (c) => {
      const curIds =
        c.route.nodeIds && c.route.nodeIds.length === c.route.points.length
          ? c.route.nodeIds
          : c.route.points.map(() => null)
      const next = fn(c.route.points.map((p) => [...p] as Vec3), [...curIds])
      return {
        ...c,
        route: { ...c.route, points: next.points, nodeIds: next.ids, smooth: true },
        status: 'adjusted',
        note,
        updatedAt: Date.now(),
      }
    })
  }

  const moveNode = (index: number, dir: -1 | 1) => {
    mutateRoute((points, nids) => {
      const j = index + dir
      if (j < 1 || j > points.length - 2) return { points, ids: nids }
      const pts = [...points]
      const ns = [...nids]
      ;[pts[index], pts[j]] = [pts[j], pts[index]]
      ;[ns[index], ns[j]] = [ns[j], ns[index]]
      return { points: pts, ids: ns }
    }, '已调整路径节点顺序')
    selectNode(index + dir)
  }

  const removeNode = (index: number) => {
    if (cable.route.points.length <= 3) {
      onFlash('路径至少保留 3 个控制点（含两端接口），无法继续删除')
      return
    }
    mutateRoute((points, nids) => {
      const pts = points.filter((_, i) => i !== index)
      const ns = nids.filter((_, i) => i !== index)
      return { points: pts, ids: ns }
    }, '已删除路径节点')
    selectNode(null)
  }

  const insertNodeAfter = (index: number) => {
    mutateRoute((points, nids) => {
      const a = points[index]
      const b = points[Math.min(index + 1, points.length - 1)]
      const mid: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
      const pts = [...points.slice(0, index + 1), mid, ...points.slice(index + 1)]
      const ns = [...nids.slice(0, index + 1), null, ...nids.slice(index + 1)]
      return { points: pts, ids: ns }
    }, '已插入自由节点（可在三维视图中拖动）')
    selectNode(index + 1)
  }

  const setNodeCoord = (axis: 0 | 1 | 2, value: number) => {
    if (selectedNodeIndex === null) return
    mutateRoute((points, nids) => {
      const pts = points.map((p, i) =>
        i === selectedNodeIndex ? ([axis === 0 ? value : p[0], axis === 1 ? value : p[1], axis === 2 ? value : p[2]] as Vec3) : p,
      )
      return { points: pts, ids: nids }
    }, '已微调路径节点坐标（本地障碍检查将重新执行）')
  }

  return (
    <aside className={cn('flex flex-col border-border bg-surface', className)}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-sm font-semibold">线缆属性</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          title={onClose ? '关闭面板' : '取消选中'}
          onClick={() => {
            if (onClose) onClose()
            else selectCable(null)
          }}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-3 pb-3">
        {/* 状态 */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px]"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: kindMeta.color }} />
            {kindMeta.label}
          </span>
          <Badge variant={status.tone}>{status.label}</Badge>
          {cable.planSource === 'demo-rule' ? (
            <DataBadge kind="computed" label="规则式演示" />
          ) : null}
        </div>

        {cable.status === 'stale' ? (
          <div className="space-y-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning">
            <p className="flex items-start gap-1">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
              关联设备已移动 / 接口已修改：当前路径基于旧位置，建议重新计算。
            </p>
            <Button
              size="sm"
              variant="outline"
              className="h-7 w-full border-warning/50 text-warning"
              disabled={busy}
              onClick={() => onPlanCables([cable.id])}
            >
              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              更新此走线
            </Button>
          </div>
        ) : null}

        {/* 连接信息 */}
        <section className="space-y-2">
          <Label>连接信息</Label>
          <p className="text-[11px] leading-relaxed text-faint">
            端点绑定接口：设备移动 / 旋转后端点自动跟随；修改端点后走线需重新计算。
          </p>
          <div className="space-y-1.5">
            <EndpointRow
              label="起点"
              value={`${cable.from.objectId}::${cable.from.portId ?? ''}`}
              options={portOptions}
              meta={endpointMeta(project, cable, 'from')}
              onChange={(v) => setEndpoint('from', v)}
            />
            <div className="flex justify-center">
              <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={swapEndpoints}>
                <ArrowLeftRight className="h-3 w-3" />
                交换起止
              </Button>
            </div>
            <EndpointRow
              label="终点"
              value={`${cable.to.objectId}::${cable.to.portId ?? ''}`}
              options={portOptions}
              meta={endpointMeta(project, cable, 'to')}
              onChange={(v) => setEndpoint('to', v)}
            />
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="shrink-0">类型</Label>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: kindMeta.color }} />
              <Select
                className="h-8 w-36 text-[13px]"
                value={cable.kind}
                onChange={(e) => {
                  const kind = e.target.value as CableKind
                  updateCable(project.id, cable.id, (c) => ({
                    ...c,
                    kind,
                    updatedAt: Date.now(),
                  }))
                }}
              >
                {(Object.keys(CABLE_KIND_META) as CableKind[]).map((k) => (
                  <option key={k} value={k}>
                    {CABLE_KIND_META[k].label}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </section>

        <Separator />

        {/* 路径节点 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>路径节点（{innerCount} 个）</Label>
            <span className="text-[11px] text-faint">拖拽三维白点也可调整</span>
          </div>
          {usedNodeLabels.length > 0 ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              经过：{usedNodeLabels.join(' → ')}
            </p>
          ) : (
            <p className="text-[11px] leading-relaxed text-faint">当前路径未经过场景路径节点（自由直连）。</p>
          )}
          <div className="space-y-1">
            {cable.route.points.map((p, index) => {
              if (index === 0 || index === cable.route.points.length - 1) return null
              const nodeId = ids[index]
              const nodeLabel = nodeId ? nodeMap.get(nodeId)?.label ?? nodeId : '自由节点'
              const focused = selectedNodeIndex === index
              return (
                <div
                  key={index}
                  className={cn(
                    'rounded-md border px-2 py-1 text-[11px]',
                    focused ? 'border-primary/60 bg-primary-soft/40' : 'border-border',
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left"
                      title="在三维视图中选中该节点"
                      onClick={() => selectNode(focused ? null : index)}
                    >
                      #{index} {nodeLabel}
                      <span className="ml-1 text-faint">
                        ({Math.round(p[0] * 1000)}, {Math.round(p[1] * 1000)}, {Math.round(p[2] * 1000)} mm)
                      </span>
                    </button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" title="上移" onClick={() => moveNode(index, -1)}>
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" title="下移" onClick={() => moveNode(index, 1)}>
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" title="在此后插入节点" onClick={() => insertNodeAfter(index)}>
                      <Plus className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6" title="删除节点" onClick={() => removeNode(index)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                  {focused ? (
                    <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                      <MmInput value={p[0]} onChange={(v) => setNodeCoord(0, v)} className="text-[11px]" />
                      <MmInput value={p[1]} onChange={(v) => setNodeCoord(1, v)} className="text-[11px]" />
                      <MmInput value={p[2]} onChange={(v) => setNodeCoord(2, v)} className="text-[11px]" />
                    </div>
                  ) : null}
                </div>
              )
            })}
            {innerCount === 0 ? (
              <p className="text-[11px] leading-relaxed text-faint">
                路径为两端直连；点击节点行右侧「+」可插入自由节点后再拖动调整。
              </p>
            ) : null}
          </div>
        </section>

        <Separator />

        {/* 长度与预留 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>长度与预留</Label>
            <DataBadge kind="computed" />
          </div>
          <div className="flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground">估算走线长度（{routeView === 'original' ? '原始走线' : '当前走线'}）</span>
            <span className="font-medium tabular-nums">{formatMeters(est)}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-[11px]">预留长度</Label>
              <MmInput
                value={reserve}
                min={0}
                max={5000}
                onChange={(v) =>
                  updateCable(project.id, cable.id, (c) => ({
                    ...c,
                    reserveLengthM: v,
                    updatedAt: Date.now(),
                  }))
                }
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[11px]">实际线长（0=未填写）</Label>
              <MmInput
                value={actual}
                min={0}
                max={10000}
                onChange={(v) =>
                  updateCable(project.id, cable.id, (c) => ({
                    ...c,
                    actualLengthM: v > 0 ? v : undefined,
                    updatedAt: Date.now(),
                  }))
                }
              />
            </div>
          </div>
          <p className="text-[12px] text-muted-foreground">
            需求 = 估算 {formatMm(est)} + 预留 {formatMm(reserve)} = <span className="font-medium">{formatMm(required)}</span>
          </p>
          {actual > 0 ? (
            shortage ? (
              <p className="rounded-md bg-danger/10 px-2 py-1.5 text-[12px] font-medium text-danger">
                长度不足：实际 {formatMm(actual)}，还差 {formatMm(required - actual)}（建议更换更长线缆或减少预留）
              </p>
            ) : (
              <p className="rounded-md bg-success/10 px-2 py-1.5 text-[12px] text-success">
                长度充足：余量 {formatMm(actual - required)}
              </p>
            )
          ) : (
            <p className="text-[11px] text-faint">填写「实际线长」后会给出长度不足提示。</p>
          )}
        </section>

        <Separator />

        {/* 路径检查 */}
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>路径检查（平滑后）</Label>
            <DataBadge kind="computed" label="本地规则" />
          </div>
          {check.ok ? (
            <p className="flex items-center gap-1.5 rounded-md bg-success/10 px-2 py-1.5 text-[12px] text-success">
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              未发现与避让区 / 物品 / 桌板相交（演示规则检查）
            </p>
          ) : (
            <ul className="space-y-1">
              {check.issues.slice(0, 5).map((issue, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 rounded-md bg-danger/10 px-2 py-1.5 text-[11px] leading-relaxed text-danger"
                >
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  {issue.message}
                </li>
              ))}
              {check.issues.length > 5 ? (
                <li className="text-[11px] text-faint">… 另有 {check.issues.length - 5} 处问题</li>
              ) : null}
              <li className="text-[11px] text-muted-foreground">
                提示：可拖拽三维视图中该线缆的白点调整路径节点，避开上述障碍后检查自动更新。
              </li>
            </ul>
          )}
          <p className="text-[11px] leading-relaxed text-faint">
            平滑曲线（Catmull-Rom）仅用于显示与长度估算；检查对象为平滑后的采样点，不是真实寻路算法。
          </p>
        </section>

        <Separator />

        {/* 对比与收拢动画 */}
        <section className="space-y-2">
          <Label>走线对比与收拢动画</Label>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-muted-foreground">显示路径</span>
            <Segmented
              size="sm"
              value={routeView}
              onChange={(v) => {
                setRouteView(v)
                useTourStore.getState().signal(project.id, 'compare')
              }}
              options={[
                { value: 'original', label: '原始', disabled: !cable.originalRoute, title: '首次规划前保留的走线' },
                { value: 'suggested', label: '建议', title: '规划 / 调整后的走线' },
              ]}
            />
          </div>
          <div className="flex items-center gap-1.5">
            {animStatus === 'playing' ? (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => useCableStore.getState().pauseAnim()}>
                <Pause className="h-3.5 w-3.5" />
                暂停
              </Button>
            ) : animStatus === 'paused' ? (
              <Button size="sm" variant="outline" className="flex-1" onClick={() => useCableStore.getState().resumeAnim()}>
                <Play className="h-3.5 w-3.5" />
                继续
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => startCollectAnim(project, onFlash)}
              >
                <Play className="h-3.5 w-3.5" />
                {animStatus === 'finished' ? '重播收拢动画' : '播放收拢动画'}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={animStatus === 'idle'}
              title="跳到结束"
              onClick={() => useCableStore.getState().skipAnim()}
            >
              <SkipForward className="h-3.5 w-3.5" />
              跳过
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-faint">
            收拢动画仅用于展示（原始走线 → 当前走线平滑过渡），不代表真实收拢过程经过碰撞验证。
          </p>
          {reducedMotion ? (
            <p className="rounded-md bg-info/10 px-2 py-1.5 text-[11px] leading-relaxed text-info">
              已检测到系统「减少动态效果」偏好：播放时直接显示收拢后的走线。
            </p>
          ) : null}
        </section>

        <Separator />

        <Button
          size="sm"
          variant="outline"
          className="w-full border-danger/40 text-danger hover:bg-danger/10"
          onClick={() => {
            removeCable(project.id, cable.id)
            onFlash('已删除线缆（Ctrl+Z 可撤销）')
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
          删除线缆
        </Button>
      </div>
    </aside>
  )
}

function endpointMeta(project: Project, cable: CableConnection, which: 'from' | 'to') {
  const label = endpointLabel(project.objects, which === 'from' ? cable.from : cable.to)
  const object = project.objects.find(
    (o) => o.id === (which === 'from' ? cable.from.objectId : cable.to.objectId),
  )
  const port = object?.ports.find(
    (p) => p.id === (which === 'from' ? cable.from.portId : cable.to.portId),
  )
  return {
    text: `${label.objectName} · ${label.portLabel}`,
    color: port ? PORT_TYPE_COLORS[port.type] : '#94A3B8',
  }
}

function EndpointRow({
  label,
  value,
  options,
  meta,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  meta: { text: string; color: string }
  onChange: (value: string) => void
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[12px]">
        <span className="text-muted-foreground">{label}</span>
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
        <span className="min-w-0 flex-1 truncate">{meta.text}</span>
      </div>
      <Select className="h-8 text-[13px]" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.some((o) => o.value === value) ? null : <option value={value}>（当前接口缺失）</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
    </div>
  )
}
