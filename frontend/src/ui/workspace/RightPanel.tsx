import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Cable,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Magnet,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import type {
  ModelStatus,
  ObjectCategory,
  Port,
  PortDirection,
  PortType,
  Project,
  SceneObject,
} from '@/types/project'
import {
  CATEGORY_LABELS,
  MODEL_STATUS_LABELS,
  PORT_DIRECTION_LABELS,
  PORT_TYPE_LABELS,
} from '@/types/project'
import { isMockMode } from '@/api'
import { nearestSupport, type SceneIssue } from '@/scene/sceneValidation'
import { cableDisplayPoints } from '@/scene/cables'
import { estimateCableLength } from '@/scene/cableRoute'
import { PORT_TYPE_COLORS, portWorldPosition, resolvePortOffset } from '@/scene/ports'
import { useCableLink } from '@/lib/useCableLink'
import { degToRad, formatMeters, formatMm, mToMm, radToDeg } from '@/lib/units'
import { cn, formatDateTime, uid } from '@/lib/utils'
import { useDeskModelStore } from '@/state/deskModelStore'
import { useWorkspaceStore, type ObjectPatch } from '@/state/workspaceStore'
import { Badge } from '@/ui/kit/badge'
import { Button } from '@/ui/kit/button'
import { DataBadge } from '@/ui/kit/data-badge'
import { Input, Label, Select, Separator } from '@/ui/kit/primitives'
import { MmInput } from '@/ui/kit/mm-input'
import { ObjectIcon } from './objectIcons'

const MODEL_BADGE: Record<ModelStatus, 'default' | 'warning' | 'success' | 'danger' | 'primary'> = {
  none: 'default',
  generating: 'primary',
  placeholder: 'warning',
  ready: 'success',
  failed: 'danger',
}

function TextField({
  value,
  onCommit,
}: {
  value: string
  onCommit: (v: string) => void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim()) onCommit(draft.trim())
        else setDraft(value)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

function DegInput({
  value,
  onCommit,
  disabled,
}: {
  value: number
  onCommit: (deg: number) => void
  disabled?: boolean
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n)) onCommit(n)
    else setDraft(String(value))
  }
  return (
    <Input
      className="text-right tabular-nums"
      inputMode="numeric"
      value={draft}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          commit()
          ;(e.target as HTMLInputElement).blur()
        }
      }}
    />
  )
}

function PortsEditor({
  project,
  object,
  onPatch,
}: {
  project: Project
  object: SceneObject
  onPatch: (p: ObjectPatch) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const setMode = useWorkspaceStore((s) => s.setMode)
  const select = useWorkspaceStore((s) => s.select)
  const onPortClick = useCableLink()
  const ports = object.ports
  const updatePort = (id: string, patch: Partial<Port>) =>
    onPatch({ ports: ports.map((p) => (p.id === id ? { ...p, ...patch } : p)) })

  return (
    <div className="space-y-1.5">
      {ports.length === 0 ? (
        <p className="text-xs leading-relaxed text-faint">
          暂无接口。为电气设备补充供电 / 数据接口后，走线规划才能连接到对应设备的正确位置。
        </p>
      ) : null}
      {ports.map((p) => {
        const expanded = expandedId === p.id
        // 未显式设置偏移时展示派生默认值；编辑任一坐标即写入显式偏移
        const offset = resolvePortOffset(object, p)
        const world = portWorldPosition(object, p)
        return (
          <div key={p.id} className="rounded-md border border-border">
            <div className="flex items-center gap-1.5 px-1.5 py-1">
              <button
                type="button"
                className="text-faint hover:text-foreground"
                title="展开：接口位置 / 朝向 / 世界坐标"
                onClick={() => setExpandedId(expanded ? null : p.id)}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: PORT_TYPE_COLORS[p.type] }}
              />
              <Select
                className="h-8 flex-1 text-[13px]"
                value={p.type}
                onChange={(e) => updatePort(p.id, { type: e.target.value as PortType })}
              >
                {(Object.keys(PORT_TYPE_LABELS) as PortType[]).map((k) => (
                  <option key={k} value={k}>
                    {PORT_TYPE_LABELS[k]}
                  </option>
                ))}
              </Select>
              <label
                className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                title="是否为供电接口（走线规划按此判断电源线）"
              >
                <input
                  type="checkbox"
                  className="accent-[#0F9D8A]"
                  checked={p.powered}
                  onChange={(e) => updatePort(p.id, { powered: e.target.checked })}
                />
                供电
              </label>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="删除接口"
                onClick={() => onPatch({ ports: ports.filter((x) => x.id !== p.id) })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {expanded ? (
              <div className="space-y-2 border-t border-border px-2 py-2">
                <p className="text-[11px] leading-relaxed text-faint">
                  位置以「相对设备底面中心的偏移」保存，设备移动 / 旋转后接口世界坐标自动同步。
                </p>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="space-y-1">
                    <Label className="text-[11px]">X 偏移</Label>
                    <MmInput
                      value={offset[0]}
                      onChange={(v) => updatePort(p.id, { offset: [v, offset[1], offset[2]] })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Y 偏移</Label>
                    <MmInput
                      value={offset[1]}
                      onChange={(v) => updatePort(p.id, { offset: [offset[0], v, offset[2]] })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Z 偏移</Label>
                    <MmInput
                      value={offset[2]}
                      onChange={(v) => updatePort(p.id, { offset: [offset[0], offset[1], v] })}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="shrink-0 text-[11px]">朝向</Label>
                  <Select
                    className="h-8 flex-1 text-[13px]"
                    value={p.direction ?? 'back'}
                    onChange={(e) =>
                      updatePort(p.id, { direction: e.target.value as PortDirection })
                    }
                  >
                    {(Object.keys(PORT_DIRECTION_LABELS) as PortDirection[]).map((d) => (
                      <option key={d} value={d}>
                        {PORT_DIRECTION_LABELS[d]}
                      </option>
                    ))}
                  </Select>
                </div>
                <p className="text-[11px] tabular-nums text-muted-foreground">
                  世界坐标（计算值）：
                  {Math.round(mToMm(world[0]))} , {Math.round(mToMm(world[1]))} ,{' '}
                  {Math.round(mToMm(world[2]))} mm
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 w-full text-[12px]"
                  onClick={() => {
                    setMode('cable')
                    select(object.id)
                    onPortClick(project, object.id, p.id)
                  }}
                >
                  <Cable className="h-3 w-3" />
                  以此接口连线（切换到走线模式）
                </Button>
              </div>
            ) : null}
          </div>
        )
      })}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          onPatch({ ports: [...ports, { id: uid('port'), type: 'usb-a', powered: false }] })
        }
      >
        <Plus className="h-3.5 w-3.5" />
        添加接口
      </Button>
      <p className="text-[11px] leading-relaxed text-faint">
        新接口默认位于设备背面中心；展开后可修正位置偏移与朝向（相对设备保存）。
      </p>
    </div>
  )
}

function ObjectInspector({
  project,
  object,
  issues,
  onGenerateModel,
}: {
  project: Project
  object: SceneObject
  issues: SceneIssue[]
  onGenerateModel: (object: SceneObject) => void
}) {
  const updateObject = useWorkspaceStore((s) => s.updateObject)
  const removeObject = useWorkspaceStore((s) => s.removeObject)
  const patch = (p: ObjectPatch) => updateObject(project.id, object.id, p)

  const dims = object.dimensions
  const pos = object.transform.position
  const deg = Math.round(radToDeg(object.transform.rotationY))
  const status = object.model.status
  const locked = object.locked

  // 下方最近的支撑面（用于「吸附到支撑面」与悬空提示）；高度优先取桌体 GLB 实测锚点
  const deskMetrics = useDeskModelStore((s) => s.metrics)
  const support = nearestSupport(project.room, pos[0], pos[2], pos[1], deskMetrics)
  const supportDeltaMm = support ? Math.round((pos[1] - support.y) * 1000) : null

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">
            <ObjectIcon shape={object.model.shape} category={object.category} />
          </span>
          <TextField value={object.name} onCommit={(v) => patch({ name: v })} />
          <Button
            variant="ghost"
            size="icon"
            title="删除物品（可撤销）"
            onClick={() => {
              if (window.confirm(`确定删除「${object.name}」吗？可用 Ctrl+Z 撤销。`)) {
                removeObject(project.id, object.id)
              }
            }}
          >
            <Trash2 className="h-4 w-4 text-danger" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label>分类</Label>
            <Select
              value={object.category}
              onChange={(e) => patch({ category: e.target.value as ObjectCategory })}
            >
              {(Object.keys(CATEGORY_LABELS) as ObjectCategory[]).map((k) => (
                <option key={k} value={k}>
                  {CATEGORY_LABELS[k]}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <Label>数量</Label>
            <Input
              type="number"
              min={1}
              max={99}
              className="tabular-nums"
              value={object.quantity}
              onChange={(e) => patch({ quantity: Math.max(1, Number(e.target.value) || 1) })}
            />
          </div>
        </div>
      </div>

      <Separator />

      <section className="space-y-1.5">
        <Label>尺寸（毫米）</Label>
        <div className="grid grid-cols-3 gap-1.5">
          <div className="space-y-0.5">
            <MmInput value={dims.width} min={10} onChange={(v) => patch({ dimensions: { width: v } })} />
            <p className="text-center text-[11px] text-faint">宽</p>
          </div>
          <div className="space-y-0.5">
            <MmInput value={dims.height} min={5} onChange={(v) => patch({ dimensions: { height: v } })} />
            <p className="text-center text-[11px] text-faint">高</p>
          </div>
          <div className="space-y-0.5">
            <MmInput value={dims.depth} min={10} onChange={(v) => patch({ dimensions: { depth: v } })} />
            <p className="text-center text-[11px] text-faint">深</p>
          </div>
        </div>
      </section>

      <section className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label>位置（毫米，原点：后墙 / 桌面中心 / 地面）</Label>
          {locked ? <span className="text-[11px] text-warning">已锁定</span> : null}
        </div>
        <div className={cn('grid grid-cols-3 gap-1.5', locked && 'opacity-60')}>
          <div className="space-y-0.5">
            <MmInput
              value={pos[0]}
              disabled={locked}
              onChange={(v) => patch({ transform: { position: [v, pos[1], pos[2]] } })}
            />
            <p className="text-center text-[11px] text-faint">X</p>
          </div>
          <div className="space-y-0.5">
            <MmInput
              value={pos[1]}
              min={0}
              disabled={locked}
              onChange={(v) => patch({ transform: { position: [pos[0], v, pos[2]] } })}
            />
            <p className="text-center text-[11px] text-faint">Y（离地）</p>
          </div>
          <div className="space-y-0.5">
            <MmInput
              value={pos[2]}
              disabled={locked}
              onChange={(v) => patch({ transform: { position: [pos[0], pos[1], v] } })}
            />
            <p className="text-center text-[11px] text-faint">Z（离墙）</p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={locked || !support || supportDeltaMm === 0}
          title={support ? `吸附到「${support.label}」表面` : '当前位置在房间外，没有支撑面'}
          onClick={() => {
            if (support) patch({ transform: { position: [pos[0], support.y, pos[2]] } })
          }}
        >
          <Magnet className="h-3.5 w-3.5" />
          {support ? `吸附到${support.label}` : '无可吸附的支撑面'}
          {support && supportDeltaMm !== 0 ? `（${supportDeltaMm! > 0 ? '+' : ''}${supportDeltaMm} mm）` : ''}
        </Button>
      </section>

      <section className="space-y-1.5">
        <Label>旋转（度）</Label>
        <div className="flex gap-1">
          {[0, 90, 180, 270].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={deg === d ? 'primary' : 'outline'}
              disabled={locked}
              className="h-8 flex-1 px-0 text-xs"
              onClick={() => patch({ transform: { rotationY: degToRad(d) } })}
            >
              {d}°
            </Button>
          ))}
        </div>
        <DegInput value={deg} disabled={locked} onCommit={(d) => patch({ transform: { rotationY: degToRad(d) } })} />
      </section>

      <section className="space-y-1.5">
        <Label>位置校验</Label>
        {issues.length === 0 ? (
          <p className="flex items-start gap-1.5 text-xs leading-relaxed text-success">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            未越界、无相交、已贴合支撑面
          </p>
        ) : (
          <ul className="space-y-1">
            {issues.map((issue, idx) => (
              <li
                key={`${issue.type}-${idx}`}
                className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs leading-relaxed text-warning"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {issue.message}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] leading-relaxed text-faint">
          校验为本地实时计算：红色线框与左侧 ⚠ 标记表示该物品越界或与其它物品相交。拖拽释放时若落点无效，将恢复到本次拖拽中最后一次有效位置；直接在坐标输入框中填写数值可保留越界 / 相交位置（仅提示）。
        </p>
      </section>

      <Separator />

      <section className="space-y-2">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="accent-[#0F9D8A]"
            checked={object.needsPower}
            onChange={(e) => patch({ needsPower: e.target.checked })}
          />
          是否带电（需要通过线缆供电）
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="accent-[#0F9D8A]"
            checked={object.fixed}
            onChange={(e) => patch({ fixed: e.target.checked })}
          />
          固定摆放（整理方案中保持位置）
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="accent-[#0F9D8A]"
            checked={Boolean(object.frequent)}
            onChange={(e) => patch({ frequent: e.target.checked })}
          />
          常用物品（空间整理时优先放在易取位置）
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="accent-[#0F9D8A]"
            checked={Boolean(object.locked)}
            onChange={(e) => patch({ locked: e.target.checked })}
          />
          锁定位置（禁止拖拽 / 旋转 / 坐标编辑）
        </label>
        <Label>接口 / 端口</Label>
        <PortsEditor project={project} object={object} onPatch={patch} />
      </section>

      <Separator />

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>3D 模型</Label>
          {isMockMode ? <DataBadge kind="mock" /> : <DataBadge kind="real" label="真实后端" />}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={MODEL_BADGE[status]}>{MODEL_STATUS_LABELS[status]}</Badge>
          {status !== 'failed' && object.model.note ? (
            <span className="min-w-0 flex-1 truncate text-[11px] text-faint" title={object.model.note}>
              {object.model.note}
            </span>
          ) : null}
        </div>
        {status === 'generating' && object.model.stage ? (
          <p className="text-xs text-muted-foreground">阶段：{object.model.stage}（模拟任务不提供精确进度）</p>
        ) : null}
        {status === 'failed' && object.model.note ? (
          <p className="text-xs leading-relaxed text-danger">{object.model.note}</p>
        ) : null}
        {status !== 'ready' && modelFallbackHint(status) ? (
          <p className="text-[11px] leading-relaxed text-faint">{modelFallbackHint(status)}</p>
        ) : null}
        <Button
          size="sm"
          variant={status === 'failed' ? 'primary' : 'outline'}
          disabled={status === 'generating'}
          onClick={() => onGenerateModel(object)}
        >
          {status === 'generating' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : status === 'failed' ? (
            <RefreshCw className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          {status === 'generating' ? '生成中…' : status === 'failed' ? '重试生成' : '生成模型'}
        </Button>
      </section>

      <p className="text-[11px] leading-relaxed text-faint">
        来源：
        {object.source === 'demo' ? '演示数据' : object.source === 'recognized' ? '照片识别' : '手动添加'}
        {object.recognition ? ` · 识别置信度 ${Math.round(object.recognition.confidence * 100)}%` : ''}
        {object.recognition?.dimensionSource === 'estimated'
          ? ' · 尺寸：AI 估计值（建议实测确认）'
          : object.recognition?.dimensionSource === 'user'
            ? ' · 尺寸：已确认'
            : ''}
        {object.fixed ? ' · 固定摆放' : ''}
        {object.frequent ? ' · 常用物品' : ''}
        {object.locked ? ' · 已锁定位置' : ''}
        {!object.visible ? ' · 已隐藏' : ''}
      </p>
    </div>
  )
}

/** 模型未就绪时的兜底说明：几何占位物保持可选中、可拖拽 */
function modelFallbackHint(status: ModelStatus): string | null {
  switch (status) {
    case 'generating':
      return '模型生成期间使用匹配尺寸的几何占位物，可正常选中与拖拽。'
    case 'failed':
      return '生成失败：当前保留匹配尺寸的几何占位物，可重试生成。'
    case 'none':
      return '尚未生成模型：当前使用匹配尺寸的几何占位物。'
    default:
      return null
  }
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  )
}

function ProjectSummary({ project }: { project: Project }) {
  const navigate = useNavigate()
  // 线缆总长：按「端点到接口贴合后的平滑路径」实时估算（计算值）
  const totalCableLength = project.cables.reduce(
    (sum, c) => sum + estimateCableLength(cableDisplayPoints(c, project.objects, 'suggested')),
    0,
  )
  const electrical = project.objects.filter((o) => o.category === 'electrical').length
  const mm3 = (v: number[]) => `${v.map((x) => Math.round(mToMm(x))).join(' × ')} mm`

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border p-3">
        <h3 className="mb-2 text-[13px] font-semibold">空间尺寸</h3>
        <dl className="space-y-1.5 text-[13px]">
          <Row label="房间（长×宽×高）" value={mm3([project.room.length, project.room.width, project.room.height])} />
          <Row
            label="桌面（长×宽）"
            value={`${mm3([project.room.desk.width, project.room.desk.depth])} · 台面高 ${formatMm(project.room.desk.height)}`}
          />
          <Row label="书架" value={project.room.shelf.enabled ? `${project.room.shelf.levels} 层` : '无'} />
          <Row label="出线孔" value={`${project.room.cableHoles.length} 个`} />
          <Row label="电源" value={`${project.room.outlets.length} 处`} />
        </dl>
        {project.room.note ? (
          <p className="mt-2 rounded-md bg-warning/10 px-2 py-1.5 text-[11px] leading-relaxed text-warning">
            {project.room.note}
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-border p-3">
        <h3 className="mb-2 text-[13px] font-semibold">项目信息</h3>
        <dl className="space-y-1.5 text-[13px]">
          <Row label="物品总数" value={`${project.objects.length} 件（电气 ${electrical}）`} />
          <Row
            label="线缆"
            value={
              <span
                className="inline-flex items-center gap-1.5"
                title="按端点到接口贴合后的平滑路径实时估算（本地计算值）"
              >
                {project.cables.length} 条 · 约 {formatMeters(totalCableLength)}
                <DataBadge kind="computed" />
              </span>
            }
          />
          <Row label="创建时间" value={formatDateTime(project.createdAt)} />
          <Row label="最近更新" value={formatDateTime(project.updatedAt)} />
        </dl>
      </section>

      <div className="flex flex-col gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${project.id}/setup`)}>
          修改空间配置
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${project.id}/import`)}>
          修改物品与照片
        </Button>
        <Button variant="outline" size="sm" onClick={() => navigate(`/projects/${project.id}/guide`)}>
          查看交付方案
        </Button>
      </div>

      <p className="text-[11px] leading-relaxed text-faint">
        提示：在场景中直接拖拽物品即可移动（自动吸附桌面 / 书架 / 地面）；选中后在此编辑尺寸（mm）、位置（mm）、旋转、接口与模型状态。
      </p>
    </div>
  )
}

/**
 * 右侧属性面板：随选中对象显示尺寸 / 位置 / 旋转 / 接口 / 模型状态 / 位置校验；
 * 未选中时显示空间与项目摘要。停靠（宽屏）或抽屉（窄屏）复用同一内容。
 */
export function RightPanel({
  project,
  issuesById,
  onGenerateModel,
  className,
  onClose,
}: {
  project: Project
  issuesById: Map<string, SceneIssue[]>
  onGenerateModel: (object: SceneObject) => void
  className?: string
  onClose?: () => void
}) {
  const selectedId = useWorkspaceStore((s) => s.selectedId)
  const select = useWorkspaceStore((s) => s.select)
  const selected = project.objects.find((o) => o.id === selectedId) ?? null

  return (
    <aside className={cn('flex flex-col border-border bg-surface', className)}>
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <h2 className="text-sm font-semibold">
          {selected ? '对象属性' : '空间与项目'}
          {selected?.locked ? <span className="ml-2 text-[11px] font-normal text-warning">已锁定</span> : null}
        </h2>
        {onClose ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" title="关闭面板" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : selected ? (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="取消选中"
            onClick={() => select(null)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-3">
        {selected ? (
          <ObjectInspector
            project={project}
            object={selected}
            issues={issuesById.get(selected.id) ?? []}
            onGenerateModel={onGenerateModel}
          />
        ) : (
          <ProjectSummary project={project} />
        )}
      </div>
    </aside>
  )
}
