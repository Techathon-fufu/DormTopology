import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Magnet } from 'lucide-react'
import type { PowerStripConfig, PowerStripSocketCount, Project, SceneObject } from '@/types/project'
import { POWER_STRIP_SOCKET_COUNTS } from '@/types/project'
import {
  computePowerStripSpecChange,
  powerStripLoad,
  resolvePowerStripConfig,
  stripLengthFor,
} from '@/scene/powerStrip'
import { DESK_BEAM_INSET, DESK_BEAM_Z, deskBeamTopY } from '@/scene/sceneValidation'
import { hasFixedFurniture } from '@/scene/fixedFurniture'
import { useCableStore } from '@/state/cableStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { Button } from '@/ui/kit/button'
import { Input, Label, Separator } from '@/ui/kit/primitives'
import { MmInput } from '@/ui/kit/mm-input'
import { Segmented } from '@/ui/kit/segmented'

/**
 * 插排规格面板（属性检查器中显示，仅排插类物品）：
 * - 4 / 6 / 8 位切换、孔距调整、最大建议负载：长度自动重算，插孔（接口）同步；
 * - 切换前预览影响：超出新容量的连接会提示确认，切换后标记「冲突」（不删除）；
 * - 负载估算按已连接设备的额定功率求和；实物桌推荐背板，旧参数化桌保留横梁入口。
 */

/** 瓦特输入（失焦 / 回车提交，避免逐键提交大量历史记录） */
function WattInput({
  value,
  disabled,
  onCommit,
}: {
  value: number
  disabled?: boolean
  onCommit: (watt: number) => void
}) {
  const [draft, setDraft] = useState(() => String(value))
  useEffect(() => setDraft(String(value)), [value])
  const commit = () => {
    const n = Number(draft)
    if (Number.isFinite(n) && n >= 50 && n <= 10000) onCommit(Math.round(n))
    else setDraft(String(value))
  }
  return (
    <div className="relative">
      <Input
        className="w-24 pr-7 text-right tabular-nums"
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
      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">W</span>
    </div>
  )
}

export function PowerStripSection({ project, object }: { project: Project; object: SceneObject }) {
  const applyPowerStripSpec = useWorkspaceStore((s) => s.applyPowerStripSpec)
  const updateObject = useWorkspaceStore((s) => s.updateObject)
  const setNotice = useCableStore((s) => s.setNotice)

  const config = useMemo(() => resolvePowerStripConfig(object), [object])
  const load = useMemo(
    () => powerStripLoad(object, project.objects, project.cables),
    [object, project.objects, project.cables],
  )
  const pos = object.transform.position
  const locked = Boolean(object.locked)
  const beamY = deskBeamTopY(project.room)
  const onBeam = Math.abs(pos[1] - beamY) < 0.002 && Math.abs(pos[2] - DESK_BEAM_Z) < 0.004

  /** 规格变更（带冲突确认）：长度重算 + 插孔重建 + 线缆状态更新，一次提交可撤销 */
  const changeSpec = (next: Partial<PowerStripConfig>, label: string) => {
    if (locked) return
    const preview = computePowerStripSpecChange(object, project.cables, next)
    if (preview.removedPortCableIds.length > 0) {
      const names = preview.removedPortCableIds
        .slice(0, 6)
        .map((id) => {
          const c = project.cables.find((x) => x.id === id)
          if (!c) return id
          const a = project.objects.find((o) => o.id === c.from.objectId)?.name ?? '（已删除）'
          const b = project.objects.find((o) => o.id === c.to.objectId)?.name ?? '（已删除）'
          return `${a} → ${b}`
        })
        .join('、')
      const more = preview.removedPortCableIds.length > 6 ? ' 等' : ''
      const ok = window.confirm(
        `切换后将有 ${preview.removedPortCableIds.length} 条线缆超出新容量（所在插孔被移除）：\n${names}${more}\n\n` +
          '这些线缆不会被删除，将标记为「冲突」，等待改插到保留的插孔。继续切换吗？',
      )
      if (!ok) return
    }
    const result = applyPowerStripSpec(project.id, object.id, next)
    if (!result) return
    const parts: string[] = [`插排已切换为 ${result.socketCount} 位（${label}）`]
    if (result.removed > 0) parts.push(`${result.removed} 条线缆标记冲突（未删除，可改插保留插孔）`)
    if (result.affected > 0) parts.push(`${result.affected} 条线缆需重算走线`)
    setNotice(`${parts.join('；')}（Ctrl+Z 可撤销）`)
  }

  /** 放到桌面下方横梁（推荐位置）：X 夹紧在横梁范围内，贴横梁上表面并对齐横梁方向 */
  const moveToBeam = () => {
    if (locked) return
    const halfSpan = project.room.desk.width / 2 - DESK_BEAM_INSET - object.dimensions.width / 2 - 0.01
    const x = Math.max(-halfSpan, Math.min(halfSpan, pos[0]))
    updateObject(project.id, object.id, {
      transform: { position: [x, beamY, DESK_BEAM_Z], rotationY: 0 },
    })
    setNotice('排插已放到桌面下方横梁（推荐位置，走线 / 插拔方便；Ctrl+Z 可撤销）')
  }

  return (
    <section className="space-y-2 rounded-lg border border-border p-2.5">
      <div className="flex items-center justify-between">
        <Label>插排规格</Label>
        <span className="text-[11px] text-faint">长度 = 两端留边 + (孔数−1) × 孔距</span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">插孔位数</span>
        <Segmented
          size="sm"
          value={String(config.socketCount)}
          onChange={(v) => changeSpec({ socketCount: Number(v) as PowerStripSocketCount }, `孔数 ${v}`)}
          options={POWER_STRIP_SOCKET_COUNTS.map((n) => ({
            value: String(n),
            label: `${n} 位`,
            title: `切换为 ${n} 位插排（长度与插孔自动重算）`,
          }))}
        />
      </div>

      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">插孔间距</span>
        <MdConvertedSpacing
          value={config.socketSpacing}
          disabled={locked}
          onCommit={(v) => changeSpec({ socketSpacing: v }, '调整孔距')}
        />
        <span className="text-[11px] leading-snug text-faint">
          20–80 mm；当前长度 ≈ {Math.round(stripLengthFor(config.socketCount, config.socketSpacing) * 1000)} mm
        </span>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-xs text-muted-foreground">建议负载</span>
        <WattInput
          value={config.maxLoadW}
          disabled={locked}
          onCommit={(w) => changeSpec({ maxLoadW: w }, `负载上限 ${w} W`)}
        />
        <span className="text-[11px] leading-snug text-faint">
          已连接 {load.connectedSockets} 个插孔 · 额定功率合计 {load.wattSum} W
          {load.unknownWattDevices > 0 ? `（另有 ${load.unknownWattDevices} 台设备未填额定功率，未计入）` : ''}
        </span>
      </div>

      {load.overLimit ? (
        <p className="flex items-start gap-1.5 rounded-md bg-warning/10 px-2 py-1.5 text-xs leading-relaxed text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          已连接设备额定功率合计 {load.wattSum} W，超过建议负载 {load.maxLoadW} W（估算值，请分流到其它插排 / 墙面插座）
        </p>
      ) : null}

      <Separator />

      {hasFixedFurniture(project.room) ? <p className="text-xs text-muted-foreground">
        {object.powerStrip?.mount === 'backboard' ? '已吸附桌下背板，插孔朝向座位。' : '可拖到桌下背板，或使用下方的背板吸附按钮。'}
      </p> : <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={locked || onBeam}
          title={locked ? '已锁定位置' : `放到桌面下方横梁（离地 ${Math.round(beamY * 1000)} mm，离墙 ${Math.round(DESK_BEAM_Z * 1000)} mm）`}
          onClick={moveToBeam}
        >
          <Magnet className="h-3.5 w-3.5" />
          {onBeam ? '已在桌下横梁' : '放到桌下横梁'}
        </Button>
        <span className="text-[11px] leading-snug text-faint">
          推荐位置：桌面下方横梁（也可直接拖拽 / 用坐标输入移到任意位置）
        </span>
      </div>}
    </section>
  )
}

/** 孔距输入（内部单位：米，展示毫米）：复用 MmInput 的毫米语义与 20–80 mm 限幅 */
function MdConvertedSpacing({
  value,
  disabled,
  onCommit,
}: {
  value: number
  disabled?: boolean
  onCommit: (valueM: number) => void
}) {
  return <MmInput className="w-24" value={value} min={20} max={80} disabled={disabled} onChange={onCommit} />
}
