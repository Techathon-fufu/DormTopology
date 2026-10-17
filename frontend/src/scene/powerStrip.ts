import type {
  CableConnection,
  CableEndpoint,
  Port,
  PowerStripConfig,
  PowerStripSocketCount,
  SceneObject,
} from '@/types/project'
import { POWER_STRIP_DEFAULTS, POWER_STRIP_MARGIN, POWER_STRIP_SOCKET_COUNTS } from '@/types/project'

/**
 * 插排规格（本地真实计算，非模拟）：
 * - 规格保存在 SceneObject.powerStrip（孔数 / 孔间距 / 最大建议负载）；
 * - 长度 = 2 × 端部留边 + (孔数 − 1) × 孔间距，随规格切换自动重算并写回 dimensions.width；
 * - 插孔端口 id 约定 `port-strip-<n>`：切换规格时保留仍存在的端口（复用 id 与标签），
 *   新孔补建、被移除插孔删除；插孔偏移与三维渲染共用同一布局公式（models.tsx）；
 * - 被移除插孔上原先连接的线缆不静默删除：本模块只返回 id 列表，由调用方标记为 conflict。
 */

export const POWER_STRIP_PORT_PREFIX = 'port-strip-'

/** 与 models.tsx 渲染口径一致：第 index 个（0 起）插孔的局部 x 偏移（米，设备自身坐标系） */
export function stripSocketOffsetX(index: number, count: number, width: number): number {
  if (count <= 1) return 0
  const usable = Math.max(0, width - POWER_STRIP_MARGIN * 2)
  return (index - (count - 1) / 2) * (usable / (count - 1))
}

/** 由长度与孔数反推孔间距（米） */
export function stripSocketSpacing(count: number, width: number): number {
  if (count <= 1) return 0
  return Math.max(0, width - POWER_STRIP_MARGIN * 2) / (count - 1)
}

/** 规格对应的插排长度（米） */
export function stripLengthFor(count: number, spacing: number): number {
  return Math.max(0, count - 1) * spacing + POWER_STRIP_MARGIN * 2
}

/** 是否为插排类物品（形状或已有规格字段） */
export function isPowerStripObject(o: SceneObject): boolean {
  return o.model.shape === 'powerStrip' || o.powerStrip !== undefined
}

/**
 * 规格归一化（读旧数据用）：缺 powerStrip 字段时按插孔端口编号与尺寸推断；
 * 孔数只支持 4 / 6 / 8（就近取合法值），间距由长度反推，负载取端口额定功率最大值。
 */
export function resolvePowerStripConfig(o: SceneObject): PowerStripConfig {
  if (o.powerStrip) return o.powerStrip
  const indices = o.ports
    .map((p) => new RegExp(`^${POWER_STRIP_PORT_PREFIX}(\\d+)$`).exec(p.id)?.[1])
    .filter((v): v is string => v !== undefined)
    .map(Number)
  const inferred = indices.length > 0 ? Math.max(...indices) : POWER_STRIP_DEFAULTS.socketCount
  let socketCount: PowerStripSocketCount = POWER_STRIP_SOCKET_COUNTS[0]
  for (const c of POWER_STRIP_SOCKET_COUNTS) {
    if (Math.abs(c - inferred) < Math.abs(socketCount - inferred)) socketCount = c
  }
  const spacing = stripSocketSpacing(socketCount, o.dimensions.width)
  const maxWatt = o.ports.reduce<number | undefined>(
    (acc, p) => (p.maxWatt !== undefined && (acc === undefined || p.maxWatt > acc) ? p.maxWatt : acc),
    undefined,
  )
  return {
    socketCount,
    socketSpacing: spacing > 0 ? Number(spacing.toFixed(4)) : POWER_STRIP_DEFAULTS.socketSpacing,
    maxLoadW: maxWatt ?? POWER_STRIP_DEFAULTS.maxLoadW,
  }
}

export interface PowerStripSpecChange {
  /** 规格变更后的物品（长度重算、插孔端口重建） */
  object: SceneObject
  config: PowerStripConfig
  /** 被移除插孔上的线缆：应标记 conflict（不删除） */
  removedPortCableIds: string[]
  /** 保留插孔上的线缆：孔位移动导致路径失效，应标记 stale（需重算） */
  affectedCableIds: string[]
}

/** 计算规格变更（纯函数）：孔数 / 孔间距 / 负载上限 → 新物品 + 受影响线缆清单 */
export function computePowerStripSpecChange(
  object: SceneObject,
  cables: CableConnection[],
  next: Partial<PowerStripConfig>,
): PowerStripSpecChange {
  const current = resolvePowerStripConfig(object)
  const config: PowerStripConfig = {
    socketCount: next.socketCount ?? current.socketCount,
    socketSpacing: next.socketSpacing ?? current.socketSpacing,
    maxLoadW: next.maxLoadW ?? current.maxLoadW,
  }
  const width = stripLengthFor(config.socketCount, config.socketSpacing)
  const portHeight = object.dimensions.height + 0.001
  const ports: Port[] = []
  for (let i = 0; i < config.socketCount; i += 1) {
    const id = `${POWER_STRIP_PORT_PREFIX}${i + 1}`
    const existing = object.ports.find((p) => p.id === id)
    const base: Port = existing ?? { id, type: 'power-ac', powered: true }
    ports.push({
      ...base,
      id,
      type: 'power-ac',
      label: `插孔 ${i + 1}`,
      powered: true,
      direction: 'up',
      offset: [stripSocketOffsetX(i, config.socketCount, width), portHeight, 0],
      maxWatt: config.maxLoadW,
    })
  }
  const removedPortIds = new Set(
    object.ports
      .filter((p) => p.id.startsWith(POWER_STRIP_PORT_PREFIX) && !ports.some((np) => np.id === p.id))
      .map((p) => p.id),
  )
  const endpointPortId = (e: CableEndpoint): string | null =>
    e.objectId === object.id && e.portId ? e.portId : null
  const removedPortCableIds: string[] = []
  const affectedCableIds: string[] = []
  for (const c of cables) {
    const fp = endpointPortId(c.from)
    const tp = endpointPortId(c.to)
    if ((fp && removedPortIds.has(fp)) || (tp && removedPortIds.has(tp))) {
      // 超出新容量的连接：冲突提示（不静默删除）
      removedPortCableIds.push(c.id)
      continue
    }
    if ((fp && ports.some((p) => p.id === fp)) || (tp && ports.some((p) => p.id === tp))) {
      affectedCableIds.push(c.id)
    }
  }
  const updated: SceneObject = {
    ...object,
    dimensions: { ...object.dimensions, width },
    powerStrip: config,
    ports,
  }
  return { object: updated, config, removedPortCableIds, affectedCableIds }
}

export interface PowerStripLoadSummary {
  /** 已连接插孔数（有连接线缆的插孔） */
  connectedSockets: number
  /** 已连接设备的额定功率合计（瓦；未填写额定功率的设备不计入） */
  wattSum: number
  /** 未填写额定功率、未计入合计的设备数（估算说明用） */
  unknownWattDevices: number
  overLimit: boolean
  maxLoadW: number
}

/** 负载估算：按连接在线缆另一端的设备接口额定功率（maxWatt）求和，与最大建议负载比较 */
export function powerStripLoad(
  strip: SceneObject,
  objects: SceneObject[],
  cables: CableConnection[],
): PowerStripLoadSummary {
  const config = resolvePowerStripConfig(strip)
  const portIds = new Set(strip.ports.map((p) => p.id))
  const connected = new Set<string>()
  let wattSum = 0
  let unknownWattDevices = 0
  for (const c of cables) {
    const fromOnStrip = c.from.objectId === strip.id && c.from.portId && portIds.has(c.from.portId)
    const toOnStrip = c.to.objectId === strip.id && c.to.portId && portIds.has(c.to.portId)
    if (!fromOnStrip && !toOnStrip) continue
    if (fromOnStrip && c.from.portId) connected.add(c.from.portId)
    if (toOnStrip && c.to.portId) connected.add(c.to.portId)
    const other = fromOnStrip ? c.to : c.from
    const otherObj = objects.find((o) => o.id === other.objectId)
    const otherPort = otherObj?.ports.find((p) => p.id === other.portId)
    if (otherPort?.maxWatt !== undefined) wattSum += otherPort.maxWatt
    else unknownWattDevices += 1
  }
  return {
    connectedSockets: connected.size,
    wattSum,
    unknownWattDevices,
    overLimit: wattSum > config.maxLoadW,
    maxLoadW: config.maxLoadW,
  }
}
