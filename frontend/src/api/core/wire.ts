import { assertAssetUrl } from '@/scene/assetPolicy'
import { exportCollision, type CompoundCollision } from '@/scene/collisionGeometry'
/**
 * 前后端 wire 契约（snake_case）与转换 / 校验层。
 *
 * 约定：
 * - 内部领域模型（camelCase、米制）不直接充当 wire format；在本模块双向转换。
 * - 真实后端返回的布局 / 路径一律先经本地校验（有限数、引用存在、房间边界、相交复核），
 *   不合格的条目显式丢弃并记录原因，不静默采用。
 * - 契约与字段缺口（如 scene_revision / regions / routing_graph 等待后端定稿）见
 *   frontend/docs/api-integration.md。
 */

import { uid } from '@/lib/utils'
import { localDirVec, resolvePortOffset } from '@/scene/ports'
import { resolveCableThickness, resolveCableVisibility } from '@/scene/cables'
import { CABLE_THICKNESS_META } from '@/types/project'
import type {
  CableChannel,
  CableConnection,
  CableKind,
  CableRouteStrategy,
  LayoutAssignment,
  ObjectCategory,
  Port,
  PortDirection,
  PortType,
  RoomConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import type { OrganizationPreferences } from '@/types/organization'
import type {
  CablePlanningResult,
  LayoutPlanningResult,
  ModelGenerationResult,
  RecognitionResult,
  RecognizedItem,
} from '../types'

// ───────────────────────────── 任务信封 ─────────────────────────────

export type RemoteCapability = 'recognition' | 'model' | 'organization' | 'cable' | 'layout'

export const REMOTE_CAPABILITY_LABELS: Record<RemoteCapability, string> = {
  recognition: '照片识别',
  model: '模型生成',
  organization: '空间整理',
  cable: '走线规划',
  layout: '布局规划',
}

export const REMOTE_CAPABILITY_PATHS: Record<RemoteCapability, string> = {
  recognition: '/recognition',
  model: '/models/generate',
  organization: '/organization/plan',
  cable: '/cables/plan',
  layout: '/layout/plan',
}

export type WireJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export interface WireJobEnvelope<TResult = unknown> {
  job_id: string
  kind?: string
  status: WireJobStatus
  /** 0 ~ 1（可选；未提供时界面不显示精确百分比） */
  progress?: number
  stage?: string
  created_at?: string
  updated_at?: string
  /** 算法版本号（识别 / 整理 / 走线等任务在响应中回报） */
  algorithm_version?: string
  /** 任务是否支持取消 */
  cancellable?: boolean
  result?: TResult
  error?: { code?: string; message?: string } | string | null
}

export interface WireJobAccepted {
  job_id: string
  status?: WireJobStatus
  created_at?: string
}

export function wireJobErrorText(err: unknown): string | undefined {
  if (typeof err === 'string' && err) return err
  if (err && typeof err === 'object') {
    const m = (err as Record<string, unknown>).message
    if (typeof m === 'string' && m) return m
  }
  return undefined
}

/** 供「刷新后在后台继续查询状态」使用的结果摘要（不落完整结果，避免存储膨胀） */
export function summarizeWireResult(capability: RemoteCapability, result: unknown): string | undefined {
  const data = (result ?? {}) as Record<string, unknown>
  const count = (v: unknown): number | undefined => (Array.isArray(v) ? v.length : undefined)
  switch (capability) {
    case 'recognition': {
      const n = count(data.items)
      return n !== undefined ? `识别 ${n} 项物品` : undefined
    }
    case 'model': {
      return typeof data.object_id === 'string' ? '模型资产已生成' : undefined
    }
    case 'organization': {
      const n = count(data.items)
      const st = typeof data.status === 'string' ? data.status : ''
      return n !== undefined ? `布局结果 ${n} 项${st ? `（${st}）` : ''}` : undefined
    }
    case 'cable': {
      const n = count(data.cables)
      return n !== undefined ? `${n} 条线缆路径` : undefined
    }
    case 'layout': {
      const n = count(data.assignments)
      return n !== undefined ? `候选方案 ${n} 项落位` : undefined
    }
  }
}

// ───────────────────────────── 基础校验工具 ─────────────────────────────

export interface SceneBounds {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
  minY: number
  maxY: number
}

/** 房间边界（场景坐标：后墙 z = 0，x 以桌面中心为 0，y 向上），用于结果投影的粗边界检查 */
export function roomBounds(room: RoomConfig): SceneBounds {
  const halfLength = room.length / 2
  return {
    minX: -halfLength,
    maxX: halfLength,
    minZ: 0,
    maxZ: room.width,
    minY: 0,
    maxY: room.height,
  }
}

function isFiniteNumber(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => isFiniteNumber(n))
}

function inBounds(p: Vec3, b: SceneBounds, tol = 0.05): boolean {
  return (
    p[0] >= b.minX - tol &&
    p[0] <= b.maxX + tol &&
    p[1] >= b.minY - tol &&
    p[1] <= b.maxY + tol &&
    p[2] >= b.minZ - tol &&
    p[2] <= b.maxZ + tol
  )
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

// ───────────────────────────── 请求映射（内部模型 → wire） ─────────────────────────────

export interface WireDeskPayload {
  width_m: number
  depth_m: number
  top_height_m: number
}

export interface WirePortPayload {
  id: string
  type: PortType
  local_position: Vec3
  local_direction: Vec3
  powered: boolean
  confirmed: boolean
}

export interface WireItemPayload {
  id: string
  name: string
  category: ObjectCategory
  size_m: Vec3
  position: Vec3
  rotation_y_rad: number
  collision: CompoundCollision
  dimensions_source: 'user' | 'estimated' | 'template'
  dimensions_confirmed: boolean
  fixed: boolean
  usage_frequency: 'high' | 'medium' | 'low'
  ports: WirePortPayload[]
  model_url: string | null
}

export interface WireCablePayload {
  id: string
  cable_type: string
  thickness: 'thick' | 'thin'
  from: { object_id: string; port_id?: string }
  to: { object_id: string; port_id?: string }
  mode: 'slot' | 'backboard'
  diameter_m: number
  min_bend_radius_m: number
  /** 现有线材长度未知时为 null；已知时为有限正数。所需线长由规划路径计算。 */
  length_m: number | null
}

export interface WireScenePayload {
  schema_version: '1.0'
  scene_id: string
  desk: WireDeskPayload
  items: WireItemPayload[]
  cables: WireCablePayload[]
  /** 前端字段缺口说明（scene_revision / regions / obstacles / routing_graph 等待后端定稿） */
  client_note: string
}

/**
 * 线径预设：与内部 `CABLE_THICKNESS_META` 保持同源（仅随请求发送，不改内部模型）。
 * @deprecated 新代码请直接使用 `CABLE_THICKNESS_META`（types/project.ts）。
 */
export const CABLE_DIAMETER_PRESETS: Record<'thick' | 'thin', { diameter_m: number; min_bend_radius_m: number }> = {
  thick: {
    diameter_m: CABLE_THICKNESS_META.thick.diameterM,
    min_bend_radius_m: 0,
  },
  thin: {
    diameter_m: CABLE_THICKNESS_META.thin.diameterM,
    min_bend_radius_m: 0,
  },
}

const CABLE_TYPE_WIRE: Record<CableKind, string> = {
  power: 'power',
  charging: 'power',
  video: 'hdmi',
  network: 'network',
  data: 'usb',
}

export function toWireItem(o: SceneObject): WireItemPayload {
  const dimensionSource: WireItemPayload['dimensions_source'] = o.recognition
    ? o.recognition.dimensionSource === 'user'
      ? 'user'
      : 'estimated'
    : o.source === 'demo'
      ? 'template'
      : 'estimated'
  return {
    id: o.id,
    name: o.name,
    category: o.category,
    size_m: [o.dimensions.width, o.dimensions.height, o.dimensions.depth],
    position: [...o.transform.position] as Vec3,
    rotation_y_rad: o.transform.rotationY,
    collision: exportCollision(o),
    dimensions_source: dimensionSource,
    dimensions_confirmed: dimensionSource !== 'estimated',
    fixed: o.fixed || o.locked,
    usage_frequency: o.frequent ? 'high' : 'medium',
    ports: o.ports.map((p) => ({
      id: p.id,
      type: p.type,
      local_position: resolvePortOffset(o, p),
      local_direction: localDirVec(p.direction ?? 'back'),
      powered: p.powered,
      confirmed: true,
    })),
    model_url: o.model.assetUrl ? assertAssetUrl(o.model.assetUrl) : null,
  }
}

export function toWireCable(c: CableConnection, objects: SceneObject[]): WireCablePayload {
  const thickness = resolveCableThickness(c)
  const visibility = resolveCableVisibility(c, objects).visibility
  const meta = CABLE_THICKNESS_META[thickness]
  return {
    id: c.id,
    cable_type: CABLE_TYPE_WIRE[c.kind],
    thickness,
    from: { object_id: c.from.objectId, port_id: c.from.portId },
    to: { object_id: c.to.objectId, port_id: c.to.portId },
    mode: visibility === 'hidden' ? 'backboard' : 'slot',
    diameter_m: meta.diameterM,
    min_bend_radius_m: 0,
    length_m: c.actualLengthM ?? null,
  }
}

const SCENE_CLIENT_NOTE =
  '前端当前字段子集：scene_revision / regions / obstacles / reserved_zones / routing_graph / allowed_region_ids ' +
  '等待后端定稿后补齐（见 frontend/docs/api-integration.md）。'

export function toWireScenePayload(input: {
  projectId: string
  objects: SceneObject[]
  room: RoomConfig
  cables: CableConnection[]
}): WireScenePayload {
  return {
    schema_version: '1.0',
    scene_id: input.projectId,
    desk: {
      width_m: input.room.desk.width,
      depth_m: input.room.desk.depth,
      top_height_m: input.room.desk.height,
    },
    items: input.objects.map(toWireItem),
    cables: input.cables.map((c) => toWireCable(c, input.objects)),
    client_note: SCENE_CLIENT_NOTE,
  }
}

export function toWirePreferences(prefs: OrganizationPreferences): Record<string, unknown> {
  return {
    typing_offset_x: prefs.typingOffsetX,
    typing_width: prefs.typingWidth,
    cup_corner: prefs.cupCorner,
    preferred_storage_zone: prefs.preferredStorageZone,
  }
}

// ───────────────────────────── 结果映射（wire → 内部模型，含本地校验） ─────────────────────────────

const WIRE_PORT_TYPE: Record<string, PortType> = {
  power_source: 'power-ac',
  power_sink: 'power-ac',
  'power-ac': 'power-ac',
  power: 'power-ac',
  usb: 'usb-a',
  'usb-a': 'usb-a',
  'usb-c': 'usb-c',
  dc: 'dc',
  network: 'rj45',
  rj45: 'rj45',
  hdmi: 'hdmi',
  audio: 'audio',
  wireless: 'wireless',
}

function mapPortDirection(v: unknown): PortDirection {
  if (!isVec3(v)) return 'back'
  const axes: Array<[PortDirection, Vec3]> = [
    ['back', [0, 0, -1]],
    ['front', [0, 0, 1]],
    ['left', [-1, 0, 0]],
    ['right', [1, 0, 0]],
    ['up', [0, 1, 0]],
    ['down', [0, -1, 0]],
  ]
  let best: PortDirection = 'back'
  let bestDot = -Infinity
  for (const [dir, axis] of axes) {
    const dot = v[0] * axis[0] + v[1] * axis[1] + v[2] * axis[2]
    if (dot > bestDot) {
      bestDot = dot
      best = dir
    }
  }
  return best
}

function mapObjectCategory(raw: unknown, warn: (msg: string) => void): ObjectCategory {
  switch (raw) {
    case 'electrical':
    case 'power_strip':
    case 'wall_socket':
    case 'wall_network':
    case 'charger':
      return 'electrical'
    case 'nonElectrical':
    case 'non_electrical':
      return 'nonElectrical'
    case 'storage':
    case 'storage_box':
    case 'container':
      return 'storage'
    default:
      warn(`识别项分类「${String(raw)}」无法映射，按非电气物品处理`)
      return 'nonElectrical'
  }
}

// ── 识别 ──

export interface WireRecognitionItemPayload {
  temp_id?: unknown
  name?: unknown
  category?: unknown
  size_m?: unknown
  quantity?: unknown
  needs_power?: unknown
  fixed?: unknown
  dimensions_source?: unknown
  confidence?: unknown
  ports?: unknown
}

export interface WireRecognitionPayload {
  items?: unknown
  low_confidence?: unknown
  note?: unknown
}

function mapRecognizedPorts(raw: unknown, itemName: string, warn: (msg: string) => void): Port[] {
  if (!Array.isArray(raw)) return []
  const ports: Port[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const data = p as Record<string, unknown>
    const type = WIRE_PORT_TYPE[String(data.type)]
    if (!type) {
      warn(`${itemName}：接口类型「${String(data.type)}」无法映射，已忽略该接口`)
      continue
    }
    const offset = isVec3(data.local_position) ? data.local_position : undefined
    ports.push({
      id: typeof data.id === 'string' && data.id ? data.id : uid('port'),
      type,
      powered: type === 'power-ac',
      offset,
      direction: mapPortDirection(data.local_direction),
    })
  }
  return ports
}

export function mapRecognitionResult(wire: unknown): RecognitionResult {
  const warnings: string[] = []
  const warn = (msg: string) => warnings.push(msg)
  const data = (wire ?? {}) as Record<string, unknown>
  if (!Array.isArray(data.items)) {
    warn('响应缺少 items 数组，识别结果为空')
  }
  const rawItems = Array.isArray(data.items) ? data.items : []
  const items: RecognizedItem[] = []
  rawItems.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      warn(`第 ${index + 1} 项识别结果格式错误，已忽略`)
      return
    }
    const it = raw as WireRecognitionItemPayload
    const name = typeof it.name === 'string' && it.name ? it.name : `识别项 ${index + 1}`
    if (typeof it.name !== 'string' || !it.name) warn(`第 ${index + 1} 项缺少名称，已使用占位名`)
    if (!isVec3(it.size_m) || it.size_m.some((n) => n <= 0)) {
      warn(`${name}：尺寸缺失或非正数，已忽略该识别项`)
      return
    }
    const confidence = isFiniteNumber(it.confidence) ? clamp01(it.confidence) : 0.5
    if (!isFiniteNumber(it.confidence)) warn(`${name}：缺少置信度，按 0.5 处理（待人工确认）`)
    const quantity =
      isFiniteNumber(it.quantity) && it.quantity >= 1 ? Math.round(it.quantity) : 1
    items.push({
      tempId: typeof it.temp_id === 'string' && it.temp_id ? it.temp_id : uid('r'),
      name,
      category: mapObjectCategory(it.category, warn),
      dimensions: { width: it.size_m[0], height: it.size_m[1], depth: it.size_m[2] },
      quantity,
      needsPower: it.needs_power === true,
      fixed: it.fixed === true,
      // 原则：AI / 后端估计值不得标记为「用户确认值」
      dimensionSource: it.dimensions_source === 'user' ? 'user' : 'estimated',
      ports: mapRecognizedPorts(it.ports, name, warn),
      confidence,
    })
  })
  const lowConfidence = isFiniteNumber(data.low_confidence)
    ? data.low_confidence
    : items.filter((i) => i.confidence < 0.75).length
  return {
    items,
    lowConfidence,
    note: typeof data.note === 'string' && data.note ? data.note : undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

export { mapPackingOrganizationResult as mapOrganizationResult } from './packingWire'

// ── 走线 ──

export interface WireRoutingCablePayload {
  cable_id?: unknown
  path_points?: unknown
  channel?: unknown
  channels?: unknown
  mode?: unknown
  strategy?: unknown
  length_m?: unknown
}

export interface WireRoutingPayload {
  status?: unknown
  cables?: unknown
  issues?: unknown
  verified?: unknown
  algorithm_version?: unknown
}

const WIRE_CHANNEL_MAP: Record<string, CableChannel> = {
  deskEdge: 'deskEdge',
  desk_edge: 'deskEdge',
  deskUnderside: 'deskUnderside',
  desk_underside: 'deskUnderside',
  post: 'post',
  floor: 'floor',
  free: 'free',
}

function mapWireChannels(raw: unknown, fallback: unknown): CableChannel[] {
  const list: CableChannel[] = []
  const push = (v: unknown) => {
    const mapped = typeof v === 'string' ? WIRE_CHANNEL_MAP[v] : undefined
    if (mapped && !list.includes(mapped)) list.push(mapped)
  }
  if (Array.isArray(raw)) raw.forEach(push)
  push(fallback)
  return list.length > 0 ? list : ['free']
}

/** 后端走线方式（mode / strategy）→ 前端线材策略；未提供时返回 undefined（视为未记录） */
function mapWireStrategy(mode: unknown, strategy: unknown): CableRouteStrategy | undefined {
  const raw = typeof strategy === 'string' ? strategy : typeof mode === 'string' ? mode : undefined
  if (raw === 'backboard' || raw === 'behind_backboard') return 'backboard'
  if (raw === 'slot' || raw === 'cable_hole' || raw === 'cableHole' || raw === 'floor') {
    return raw === 'floor' ? undefined : 'cableHole'
  }
  return undefined
}

export function mapCablePlanResult(
  wire: unknown,
  ctx: { cables: CableConnection[]; room: RoomConfig },
): CablePlanningResult {
  const warnings: string[] = []
  const warn = (msg: string) => warnings.push(msg)
  const data = (wire ?? {}) as WireRoutingPayload
  const byId = new Map(ctx.cables.map((c) => [c.id, c]))
  const bounds = roomBounds(ctx.room)
  const rawCables = Array.isArray(data.cables) ? data.cables : []
  if (!Array.isArray(data.cables)) warn('响应缺少 cables 数组，未采用任何路径')

  const issueById = new Map<string, string[]>()
  if (Array.isArray(data.issues)) {
    for (const raw of data.issues) {
      if (!raw || typeof raw !== 'object') continue
      const issue = raw as Record<string, unknown>
      const cableId = typeof issue.cable_id === 'string' ? issue.cable_id : undefined
      const text =
        typeof issue.message === 'string' && issue.message
          ? issue.message
          : typeof issue.code === 'string' && issue.code
            ? `后端原因代码：${issue.code}`
            : '后端未提供问题说明'
      if (cableId) {
        issueById.set(cableId, [...(issueById.get(cableId) ?? []), text])
      } else {
        warn(`服务级问题：${text}`)
      }
    }
  }

  const updated: CableConnection[] = []
  let plannedCount = 0
  let conflictCount = 0

  rawCables.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      warn(`第 ${index + 1} 条路径格式错误，已忽略`)
      return
    }
    const it = raw as WireRoutingCablePayload
    const cableId = typeof it.cable_id === 'string' ? it.cable_id : undefined
    const cable = cableId ? byId.get(cableId) : undefined
    if (!cable) {
      warn(`第 ${index + 1} 条路径引用未知线缆「${String(it.cable_id)}」，已忽略`)
      return
    }
    const rawPoints = Array.isArray(it.path_points) ? it.path_points : []
    const points: Vec3[] = []
    let invalidPoint = false
    for (const p of rawPoints) {
      if (!isVec3(p) || !inBounds(p, bounds, 0.2)) {
        invalidPoint = true
        break
      }
      points.push([p[0], p[1], p[2]])
    }
    if (points.length < 2 || invalidPoint) {
      warn(`${cable.kind} 线缆路径无效（点数 ${points.length}${invalidPoint ? '，含越界 / 非法点' : ''}），未采用`)
      return
    }

    const originalRoute = cable.originalRoute
      ? cable.originalRoute
      : {
          channels: [...cable.route.channels],
          points: cable.route.points.map((p) => [p[0], p[1], p[2]] as Vec3),
        }

    const issues = issueById.get(cable.id) ?? []
    const channels = mapWireChannels(it.channels, it.channel)

    if (issues.length > 0) {
      conflictCount += 1
      updated.push({
        ...cable,
        route: { channels, points, smooth: true, strategy: mapWireStrategy(it.mode, it.strategy) },
        originalRoute,
        status: 'conflict',
        planSource: 'algorithm',
        note: `真实后端算法报告问题：${issues[0]}（共 ${issues.length} 处，可调整后重新规划）`,
        updatedAt: Date.now(),
      })
      return
    }

    plannedCount += 1
    updated.push({
      ...cable,
      route: { channels, points, smooth: true, strategy: mapWireStrategy(it.mode, it.strategy) },
      originalRoute,
      status: 'planned',
      planSource: 'algorithm',
      note:
        typeof it.length_m === 'number' && Number.isFinite(it.length_m)
          ? `真实后端算法路径（后端报告长度 ${it.length_m.toFixed(2)} m）`
          : '真实后端算法路径',
      updatedAt: Date.now(),
    })
  })

  const verified = data.verified === true
  const notes: string[] = [
    `真实后端算法结果（status=${String(data.status ?? 'unknown')}）${
      typeof data.algorithm_version === 'string' && data.algorithm_version
        ? `，算法版本 ${data.algorithm_version}`
        : ''
    }。`,
  ]
  if (!verified) {
    notes.push('后端未提供验证标记（verified），前端不将该结果标记为「已避障验证」。')
  }
  for (const [cableId, list] of issueById) {
    const cable = byId.get(cableId)
    if (cable) notes.push(`${cable.kind} 线缆：${list[0]}`)
  }
  if (warnings.length > 0) notes.push(`本地校验未采用 ${warnings.length} 条路径：${warnings[0]}`)

  return {
    cables: updated,
    plannedCount,
    conflictCount,
    algorithmVerified: verified,
    notes,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ── 模型生成 ──

export interface WireModelPayload {
  object_id?: unknown
  status?: unknown
  asset_url?: unknown
  format?: unknown
  note?: unknown
}

export function mapModelGenerationResult(wire: unknown, fallbackObjectId: string): ModelGenerationResult {
  const warnings: string[] = []
  const data = (wire ?? {}) as WireModelPayload
  const objectId = typeof data.object_id === 'string' && data.object_id ? data.object_id : fallbackObjectId
  if (typeof data.object_id !== 'string') warnings.push('响应缺少 object_id，按请求对象处理')
  const assetUrl = typeof data.asset_url === 'string' && data.asset_url ? data.asset_url : undefined
  if (!assetUrl) warnings.push('响应未提供 asset_url（未生成真实资产文件）')
  const format = data.format === 'glb' || data.format === 'gltf' ? data.format : assetUrl ? 'glb' : undefined
  const failed = data.status === 'failed'
  const noteParts = [
    typeof data.note === 'string' && data.note ? data.note : undefined,
    assetUrl ? '3D 模型资产已就绪并接入场景渲染' : undefined,
    warnings.length > 0 ? `本地校验：${warnings.join('；')}` : undefined,
  ]
  return {
    objectId,
    status: failed ? 'failed' : 'ready',
    assetUrl,
    format,
    error: failed ? '后端任务报告生成失败' : undefined,
    note: noteParts.filter(Boolean).join('；') || undefined,
    warnings: warnings.length > 0 ? warnings : undefined,
  }
}

// ── 布局（遗留 layoutPlanning） ──

export interface WireLayoutPayload {
  assignments?: unknown
  score?: unknown
  summary?: unknown
}

const LAYOUT_ZONES: LayoutAssignment['zone'][] = ['deskBack', 'deskFront', 'deskSide', 'floor', 'free']

export function mapLayoutPlanResult(
  wire: unknown,
  ctx: { projectId: string; objects: SceneObject[]; room: RoomConfig },
): LayoutPlanningResult {
  const warnings: string[] = []
  const warn = (msg: string) => warnings.push(msg)
  const data = (wire ?? {}) as WireLayoutPayload
  const byId = new Map(ctx.objects.map((o) => [o.id, o]))
  const bounds = roomBounds(ctx.room)
  const rawAssignments = Array.isArray(data.assignments) ? data.assignments : []
  if (!Array.isArray(data.assignments)) warn('响应缺少 assignments 数组，布局结果为空')

  const assignments: LayoutAssignment[] = []
  for (const raw of rawAssignments) {
    if (!raw || typeof raw !== 'object') {
      warn('存在格式错误的落位项，已忽略')
      continue
    }
    const it = raw as Record<string, unknown>
    const objectId = typeof it.object_id === 'string' ? it.object_id : undefined
    const object = objectId ? byId.get(objectId) : undefined
    if (!object) {
      warn(`落位项引用未知物品「${String(it.object_id)}」，已忽略`)
      continue
    }
    if (!isVec3(it.position) || !inBounds(it.position, bounds)) {
      warn(`${object.name}：目标位置缺失 / 越界，已忽略`)
      continue
    }
    const rotY = isFiniteNumber(it.rotation_y_rad) ? it.rotation_y_rad : object.transform.rotationY
    const zoneRaw = it.zone as LayoutAssignment['zone']
    const zone = LAYOUT_ZONES.includes(zoneRaw)
      ? zoneRaw
      : it.position[1] < 0.1
        ? 'floor'
        : 'free'
    if (!LAYOUT_ZONES.includes(zoneRaw)) warn(`${object.name}：zone 缺失 / 未知，按「${zone}」标注`)
    assignments.push({ objectId: object.id, position: it.position, rotationY: rotY, zone })
  }

  const score =
    isFiniteNumber(data.score) ? Math.max(0, Math.min(100, Math.round(data.score))) : undefined
  const summary =
    typeof data.summary === 'string' && data.summary
      ? data.summary
      : `真实后端布局规划：${assignments.length} 项落位（经本地边界校验）`
  if (warnings.length > 0) warn(`本地校验提示 ${warnings.length} 条`)

  return {
    plan: {
      id: uid('plan'),
      projectId: ctx.projectId,
      name: '后端布局方案（真实服务）',
      kind: 'candidate',
      createdAt: Date.now(),
      assignments,
      score,
      summary,
    },
    score: score ?? 0,
    summary,
  }
}
