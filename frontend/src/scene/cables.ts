import type {
  CableConnection,
  CableEndpoint,
  CableKind,
  CableThickness,
  CableVisibility,
  Port,
  Project,
  RoomConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import { portWorldDirection, portWorldPosition, inferCableKind } from '@/scene/ports'
import { hasFixedFurniture } from './fixedFurniture'
import { uid } from '@/lib/utils'
import { clonePoints } from '@/types/cable'
import { isPowerStripObject } from '@/scene/powerStrip'

/**
 * 线缆端点与展示辅助：
 * - 端点世界坐标由「设备 + 接口」实时推导（设备移动 / 旋转后自动同步）；
 * - 接口缺失时退回端点快照位置（历史数据兼容）。
 */

export function findPort(object: SceneObject, portId?: string): Port | null {
  if (!portId) return null
  return object.ports.find((p) => p.id === portId) ?? null
}

/** 端点世界坐标（优先由接口实时推导） */
export function resolveEndpointPosition(
  objects: SceneObject[],
  endpoint: CableEndpoint,
): Vec3 {
  const object = objects.find((o) => o.id === endpoint.objectId)
  if (object) {
    const port = findPort(object, endpoint.portId)
    if (port) return portWorldPosition(object, port)
    // 接口被删除：退回设备背面中心（仍跟随设备位姿）
    return portWorldPosition(object, {
      id: '__fallback__',
      type: 'power-ac',
      powered: false,
      offset: [0, Math.min(0.35 * object.dimensions.height, 0.05), -object.dimensions.depth / 2 - 0.01],
    })
  }
  return clonePoints([endpoint.position])[0]
}

/** 端点世界朝向（接口缺失时朝后） */
export function resolveEndpointDirection(
  objects: SceneObject[],
  endpoint: CableEndpoint,
): Vec3 {
  const object = objects.find((o) => o.id === endpoint.objectId)
  if (!object) return [0, 0, -1]
  const port = findPort(object, endpoint.portId)
  if (!port) return [0, 0, -1]
  return portWorldDirection(object, port)
}

/** 由设备 + 接口生成线缆端点（position 为快照，渲染时实时推导覆盖） */
export function endpointOf(object: SceneObject, port: Port | undefined | null): CableEndpoint {
  const portId = port?.id
  const position = port ? portWorldPosition(object, port) : ([...object.transform.position] as Vec3)
  return { objectId: object.id, portId, position }
}

export interface CableRouteView {
  /** 已贴合接口端点的控制点（米） */
  points: Vec3[]
  nodeIds: (string | null)[]
}

/**
 * 线缆展示控制点：route.points 首末点替换为接口实时世界坐标。
 * view = 'original' 时读取 originalRoute（没有则退回当前 route）。
 */
export function cableDisplayPoints(
  cable: CableConnection,
  objects: SceneObject[],
  view: 'suggested' | 'original' = 'suggested',
): Vec3[] {
  const route = view === 'original' && cable.originalRoute ? cable.originalRoute : cable.route
  return cableDisplayRoute(cable, objects, route.points, route.nodeIds)
}

/** 指定控制点 -> 端点贴合后的展示控制点（节点拖拽预览也走这里） */
export function cableDisplayRoute(
  cable: CableConnection,
  objects: SceneObject[],
  points: Vec3[],
  nodeIds?: (string | null)[],
): Vec3[] {
  const pts = clonePoints(points)
  if (pts.length === 0) return pts
  const fromPos = resolveEndpointPosition(objects, cable.from)
  const toPos = resolveEndpointPosition(objects, cable.to)
  pts[0] = fromPos
  if (pts.length > 1) pts[pts.length - 1] = toPos
  else pts.push(toPos)
  void nodeIds
  return pts
}

export type CreateCableResult = { ok: true; cable: CableConnection } | { ok: false; reason: string }

export type CableConnectionValidation = { ok: true } | { ok: false; reason: string }

export function invalidateCableRoutes(cables: CableConnection[]): CableConnection[] {
  let changed = false
  const next = cables.map((cable) => {
    if ((cable.status === 'stale' || cable.status === 'conflict') && !cable.route.verification && cable.route.pathLengthM === undefined) return cable
    changed = true
    const { verification: _verification, pathLengthM: _pathLengthM, ...route } = cable.route
    return { ...cable, route, status: cable.status === 'conflict' ? 'conflict' as const : 'stale' as const, updatedAt: Date.now() }
  })
  return changed ? next : cables
}

/** Appearance replacement keeps geometry; primitive and prefab changes do not. */
export function cableRoutingObjectsSignature(objects: SceneObject[]): string {
  return JSON.stringify(objects.map(({ model, ...object }) => ({ ...object, shape: model.shape, prefabId: model.prefabId })))
}

export function hasUsableCableRoute(cable: CableConnection): boolean {
  return (cable.status === 'planned' || cable.status === 'adjusted')
    && cable.planSource !== 'demo-rule'
    && cable.route.points.length >= 2
    && cable.route.verification?.status !== 'failed'
    && (cable.planSource !== 'algorithm' || (cable.route.verification?.status === 'valid'
      && cable.route.verification.pathStyle === 'orthogonal'
      && (!['power', 'video', 'network'].includes(cable.kind) || cable.route.strategy === 'backboard')))
}

/** `powered` describes a power input on ordinary devices; strip sockets supply power. */
export function isPowerSourcePort(object: SceneObject, port: Port): boolean {
  if (isPowerStripObject(object)) return !/bus|input|inlet/i.test(port.id)
  return !port.powered
}

/** Shared capacity/type rules for new connections, endpoint edits and planning. */
export function validateCableConnection(
  project: Pick<Project, 'objects' | 'cables'>,
  from: CableEndpoint,
  to: CableEndpoint,
  options: { excludeCableId?: string; kind?: CableKind } = {},
): CableConnectionValidation {
  const fromObject = project.objects.find((o) => o.id === from.objectId)
  const toObject = project.objects.find((o) => o.id === to.objectId)
  const fromPort = fromObject ? findPort(fromObject, from.portId) : null
  const toPort = toObject ? findPort(toObject, to.portId) : null
  if (!fromObject || !toObject || !fromPort || !toPort) {
    return { ok: false, reason: '接口不存在（设备或接口可能已被删除）' }
  }
  if (from.objectId === to.objectId && from.portId === to.portId) {
    return { ok: false, reason: '不能把接口连接到它自身' }
  }
  if (fromPort.type === 'wireless' || toPort.type === 'wireless') {
    return { ok: false, reason: '无线接口不能建立实体线缆连接' }
  }
  const usb = (port: Port) => port.type === 'usb-a' || port.type === 'usb-c'
  const isUsb = usb(fromPort) && usb(toPort)
  if (!isUsb && fromPort.type !== toPort.type) {
    return { ok: false, reason: '两端接口类型不兼容；供电转换需要独立的适配器接口' }
  }
  const power = fromPort.type === 'power-ac' || fromPort.type === 'dc'
  if (power && isPowerSourcePort(fromObject, fromPort) === isPowerSourcePort(toObject, toPort)) {
    return { ok: false, reason: '电源线需要连接一个供电端与一个受电端' }
  }
  const acceptedKinds: CableKind[] = isUsb ? ['data', 'charging', 'power']
    : fromPort.type === 'rj45' ? ['network']
      : fromPort.type === 'hdmi' ? ['video']
        : fromPort.type === 'audio' ? ['data']
          : fromPort.type === 'dc' ? ['power', 'charging'] : ['power']
  if (options.kind && !acceptedKinds.includes(options.kind)) {
    return { ok: false, reason: '线缆用途与两端接口类型不兼容，请选择匹配的线缆用途' }
  }
  const samePort = (a: CableEndpoint, b: CableEndpoint) =>
    a.objectId === b.objectId && a.portId === b.portId
  const others = project.cables.filter((c) => c.id !== options.excludeCableId)
  if (others.some((c) =>
    (samePort(c.from, from) && samePort(c.to, to)) ||
    (samePort(c.from, to) && samePort(c.to, from)),
  )) return { ok: false, reason: '这两个接口之间已存在连接' }
  if (others.some((c) =>
    samePort(c.from, from) || samePort(c.to, from) || samePort(c.from, to) || samePort(c.to, to),
  )) return { ok: false, reason: '接口已被其他线缆占用；每个插孔或接口只能连接一条线缆' }
  return { ok: true }
}

// ───────────────────────────── 线材类型（可见线 / 隐藏线） ─────────────────────────────

/**
 * 设备名称关键词 → 默认隐藏线（沿背板后面走线）：
 * 「显示器-插排」「台灯-插排」等固定设备默认把线藏到背板后。
 */
const HIDDEN_NAME_KEYWORDS = [
  '显示器', '屏幕', '投影', '台灯', '落地灯', '主机', '路由器', '交换机',
  '音箱', '打印机', '扫描仪', '摄像头',
  'monitor', 'screen', 'lamp', 'router', 'switch', 'speaker', 'printer', 'camera',
]

/**
 * 设备名称关键词 → 默认可见线（从桌面出线槽走线）：
 * 「手机-插排」「笔记本-插排」等频繁插拔的随身设备默认可见。
 */
const VISIBLE_NAME_KEYWORDS = [
  '手机', '平板', '笔记本', '耳机', '手表', '充电宝', '充电器', '键盘', '鼠标',
  'phone', 'tablet', 'laptop', 'earbuds', 'watch', 'keyboard', 'mouse', 'charger',
]

export type CableVisibilitySource = 'policy' | 'explicit' | 'keyword' | 'default'

export interface CableVisibilityInfo {
  visibility: CableVisibility
  source: CableVisibilitySource
  /** 命中的关键词（source = keyword 时，界面展示推断依据） */
  keyword?: string
}

/** 按两端设备名称推断线材类型：命中隐藏关键词优先（显示器 / 台灯…），否则可见（手机 / 笔记本…），无匹配默认可见 */
export function inferCableVisibility(
  objects: SceneObject[],
  from: CableEndpoint,
  to: CableEndpoint,
): CableVisibilityInfo {
  const names = [from.objectId, to.objectId].map(
    (id) => objects.find((o) => o.id === id)?.name ?? '',
  )
  for (const name of names) {
    const lower = name.toLowerCase()
    const hit = HIDDEN_NAME_KEYWORDS.find((k) => name.includes(k) || lower.includes(k))
    if (hit) return { visibility: 'hidden', source: 'keyword', keyword: hit }
  }
  for (const name of names) {
    const lower = name.toLowerCase()
    const hit = VISIBLE_NAME_KEYWORDS.find((k) => name.includes(k) || lower.includes(k))
    if (hit) return { visibility: 'visible', source: 'keyword', keyword: hit }
  }
  return { visibility: 'visible', source: 'default' }
}

/** 解析线材类型：用户显式设置优先，否则按两端设备名称推断（不写入数据，重命名后自动跟随） */
export function resolveCableVisibility(
  cable: CableConnection,
  objects: SceneObject[],
  room?: RoomConfig,
): CableVisibilityInfo {
  if (room && hasFixedFurniture(room)) return { visibility: 'hidden', source: 'policy' }
  if (cable.kind === 'power' || cable.kind === 'video' || cable.kind === 'network') return { visibility: 'hidden', source: 'policy' }
  if (cable.visibility) return { visibility: cable.visibility, source: 'explicit' }
  return inferCableVisibility(objects, cable.from, cable.to)
}

/** 解析线径：用户显式设置优先，否则按线缆类型推断（电源 / 网线 / 视频 = 粗线，数据 / 充电 = 细线） */
export function resolveCableThickness(cable: CableConnection): CableThickness {
  if (cable.thickness) return cable.thickness
  return cable.kind === 'power' || cable.kind === 'network' || cable.kind === 'video'
    ? 'thick'
    : 'thin'
}

/**
 * 在两个接口之间建立连接（新建线缆）：
 * - 拒绝同一接口自连 / 重复连接；
 * - 线材类型 / 线径留空 = 按设备名称与线缆类型自动推断（用户可在面板中手动指定）；
 * - 初始路径为直连两点（未规划），用户可点击「规划走线」生成建议路径。
 */
export function createCableBetween(
  project: Project,
  fromObjectId: string,
  fromPortId: string,
  toObjectId: string,
  toPortId: string,
): CreateCableResult {
  const fromObject = project.objects.find((o) => o.id === fromObjectId)
  const toObject = project.objects.find((o) => o.id === toObjectId)
  const fromPort = fromObject ? findPort(fromObject, fromPortId) : null
  const toPort = toObject ? findPort(toObject, toPortId) : null
  if (!fromObject || !toObject || !fromPort || !toPort) {
    return { ok: false, reason: '接口不存在（设备或接口可能已被删除）' }
  }
  const validation = validateCableConnection(project, endpointOf(fromObject, fromPort), endpointOf(toObject, toPort))
  if (!validation.ok) return validation

  const fromPos = portWorldPosition(fromObject, fromPort)
  const toPos = portWorldPosition(toObject, toPort)
  const mid: Vec3 = [
    (fromPos[0] + toPos[0]) / 2,
    Math.max(fromPos[1], toPos[1]) + 0.02,
    (fromPos[2] + toPos[2]) / 2,
  ]

  const cable: CableConnection = {
    id: uid('cable'),
    projectId: project.id,
    kind: fromPort.type === 'rj45' ? 'network' : inferCableKind(fromPort, toPort),
    from: endpointOf(fromObject, fromPort),
    to: endpointOf(toObject, toPort),
    route: { channels: ['free'], points: [fromPos, mid, toPos], nodeIds: [null, null, null] },
    status: 'existing',
    planSource: 'manual',
    accessories: [],
    note: '手动建立连接：线材类型与线径按设备名称自动推断；尚未规划路径（可点击「规划走线」生成建议路径）',
    updatedAt: Date.now(),
  }
  return { ok: true, cable }
}

/** 端点描述文本：设备名 · 接口名 */
export function endpointLabel(
  objects: SceneObject[],
  endpoint: CableEndpoint,
): { objectName: string; portLabel: string } {
  const object = objects.find((o) => o.id === endpoint.objectId)
  const port = object ? findPort(object, endpoint.portId) : null
  return {
    objectName: object?.name ?? '（设备已删除）',
    portLabel: port?.label ?? (port ? port.type : '（接口缺失）'),
  }
}
