import { segmentHitsObject } from './collisionGeometry'
import * as THREE from 'three'
import type {
  CableChannel,
  CableConnection,
  CableEndpoint,
  CableRouteStrategy,
  CableThickness,
  CableVisibility,
  RoomConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import { CABLE_CLEARANCE_M, CABLE_THICKNESS_META, CABLE_VISIBILITY_META } from '@/types/project'
import type { CableAvoidZone, CableCheckIssue, CableCheckResult, RouteNode } from '@/types/cable'
import { computeRouteNodes, deskUnderY, nearestRouteNode, routeNodeMap } from '@/scene/routeNodes'
import {
  cableDisplayPoints,
  resolveCableThickness,
  resolveCableVisibility,
  resolveEndpointDirection,
  resolveEndpointPosition,
  validateCableConnection,
} from '@/scene/cables'
import { DESK_GAP } from '@/scene/sceneValidation'
import { polylineLength } from '@/scene/geometry'

/**
 * 走线路径：平滑采样 + 障碍检查 + 规则式演示规划。
 *
 * 诚实标注：
 * - 演示路径以同一条 Catmull-Rom 曲线采样，做长度、局部弯曲和线径扫掠检查；
 * - 该检查是本地几何规则，仍有端点引出和采样近似，不替代后端连续曲线与支撑验证；
 * - 规划器在少量候选节点链中挑选第一条无碰撞链（演示路径优先经过桌边 / 桌底 / 立柱 / 出线孔），
 *   全部候选失败时返回问题清单，由用户调整路径节点。
 */

const SAMPLE_DIVISIONS = 128

/**
 * 地面穿透保护：Catmull-Rom 在「竖直下落 → 地面长走线」转角处会轻微回弹到 y<0，
 * 线缆不应穿过地面，因此对采样点做下限钳制（渲染与障碍检查共用同一采样，保持一致）。
 */
function guardFloor(p: Vec3): Vec3 {
  return p[1] < 0.002 ? ([p[0], 0.002, p[2]] as Vec3) : p
}

/** Catmull-Rom（centripetal）平滑采样；两点时退化为直线 */
export function sampleCurve(points: Vec3[], divisions = SAMPLE_DIVISIONS): Vec3[] {
  if (points.length === 0) return []
  if (points.length === 1) return [guardFloor([...points[0]] as Vec3)]
  if (points.length === 2) {
    const out: Vec3[] = []
    for (let i = 0; i <= divisions; i += 1) {
      const t = i / divisions
      out.push(
        guardFloor([
          points[0][0] + (points[1][0] - points[0][0]) * t,
          points[0][1] + (points[1][1] - points[0][1]) * t,
          points[0][2] + (points[1][2] - points[0][2]) * t,
        ]),
      )
    }
    return out
  }
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    false,
    'centripetal',
    0.5,
  )
  return curve.getPoints(divisions).map((v) => guardFloor([v.x, v.y, v.z] as Vec3))
}

/** 平滑路径长度估算（米） */
export function estimateCableLength(points: Vec3[], smooth = true): number {
  return polylineLength(smooth ? sampleCurve(points) : points)
}

// ───────────────────────────── 障碍检查 ─────────────────────────────

export interface CableCheckInput {
  points: Vec3[]
  /** Backend-verified paths are already sampled and must not be fitted again. */
  smooth?: boolean
  from: CableEndpoint
  to: CableEndpoint
  objects: SceneObject[]
  room: RoomConfig
  avoidZones: CableAvoidZone[]
  /**
   * 参与「线缆间距」咨询级检查的其它线缆（同一项目）。缺省 = 不检查。
   * 间距检查不参与 passed / 失败的硬性判定（规划器只看 issues）。
   */
  cables?: CableConnection[]
  /** 当前线缆 id（用于从 cables 中排除自身） */
  selfCableId?: string
  /** 当前线缆线径（未提供 selfCableId 时使用；缺省按粗线） */
  thickness?: CableThickness
  cable?: CableConnection
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * 对展示路径做本地连接、长度及几何检查（物品 / 桌板 / 房间边界），
 * 返回采样点、长度与问题清单（去重：同类问题仅保留第一条位置）。
 */
export function checkCableRoute(input: CableCheckInput): CableCheckResult {
  const { points, from, to, objects, room } = input
  const samples = input.smooth === false ? points : sampleCurve(points)
  const lengthM = polylineLength(samples)
  const issues: CableCheckIssue[] = []
  const seen = new Set<string>()
  const addIssue = (kind: CableCheckIssue['kind'], position: Vec3, message: string) => {
    if (seen.has(message)) return
    seen.add(message)
    issues.push({ kind, position, message })
  }

  const desk = room.desk
  const g = DESK_GAP
  const y = desk.height
  const fromPos = resolveEndpointPosition(objects, from)
  const toPos = resolveEndpointPosition(objects, to)
  const fromObject = objects.find((o) => o.id === from.objectId)
  const toObject = objects.find((o) => o.id === to.objectId)
  const cable = input.cable ?? input.cables?.find((c) => c.id === input.selfCableId)
  const thickness = cable ? resolveCableThickness(cable) : input.thickness ?? 'thick'
  const physical = CABLE_THICKNESS_META[thickness]
  const radius = physical.diameterM / 2
  const connection = validateCableConnection({ objects, cables: input.cables ?? [] }, from, to, {
    excludeCableId: cable?.id ?? input.selfCableId,
    kind: cable?.kind,
  })
  if (!connection.ok) addIssue('endpoint', fromPos, connection.reason)
  if (samples.length < 2 || !Number.isFinite(lengthM) || lengthM <= 0.000001) {
    addIssue('cable', fromPos, '路径必须包含至少两个不同的有效端点')
  }
  if (cable) {
    const reserve = cable.reserveLengthM ?? 0
    if (!Number.isFinite(reserve) || reserve < 0) addIssue('cable', fromPos, '预留长度必须是非负的有限数值')
    if (cable.actualLengthM !== undefined) {
      if (!Number.isFinite(cable.actualLengthM) || cable.actualLengthM <= 0) {
        addIssue('cable', fromPos, '实际线长必须是大于零的有限数值')
      } else if (cable.actualLengthM + 0.0005 < lengthM + reserve) {
        addIssue('cable', fromPos, `线长不足：路径及预留需要 ${Math.ceil((lengthM + reserve) * 1000)} mm，实际只有 ${Math.round(cable.actualLengthM * 1000)} mm`)
      }
    }
  }

  const testObjects = objects.filter((o) => o.visible)

  for (let index = 0; index < samples.length; index += 1) {
    const p = samples[index]
    const previous = samples[Math.max(0, index - 1)]
    // 1) 房间边界
    if (p[1] < -0.002) addIssue('bounds', p, '路径低于地面（越界）')
    if (p[1] > room.height - 0.005) addIssue('bounds', p, '路径超过层高（越界）')
    if (Math.abs(p[0]) > room.length / 2 - 0.004) addIssue('bounds', p, '路径超出房间左右边界')
    if (p[2] < -0.004 || p[2] > room.width - 0.004) addIssue('bounds', p, '路径超出房间前后边界')

    // 3) 桌板（允许从出线孔穿过）
    if (
      p[0] > -desk.width / 2 - 0.002 &&
      p[0] < desk.width / 2 + 0.002 &&
      p[2] > g + 0.002 &&
      p[2] < g + desk.depth - 0.002 &&
      p[1] > y - desk.thickness - 0.003 &&
      p[1] < y + 0.002
    ) {
      const nearHole = room.cableHoles.some(
        (h) => Math.hypot(p[0] - h.position[0], p[2] - h.position[2]) + radius + 0.001 < h.diameter / 2,
      )
      if (!nearHole) addIssue('slab', p, '路径穿过桌板（可从出线孔走线）')
    }

    // Local demo egress exemption applies only to the owning endpoint object.
    for (const o of testObjects) {
      if (o.id === from.objectId && dist3(p, fromPos) < 0.055 && dist3(previous, fromPos) < 0.055) continue
      if (o.id === to.objectId && dist3(p, toPos) < 0.055 && dist3(previous, toPos) < 0.055) continue
      if (segmentHitsObject(previous, p, o, radius + 0.001)) {
        addIssue('object', p, `与「${o.name}」相交（含线径净空）`)
        break
      }
    }
  }

  // 5) 端点有效性
  if (!fromObject) addIssue('endpoint', fromPos, '起点设备已删除，走线无法附着')
  else if (!fromObject.ports.some((p) => p.id === from.portId)) {
    addIssue('endpoint', fromPos, `起点接口缺失（${fromObject.name}）`)
  }
  if (!toObject) addIssue('endpoint', toPos, '终点设备已删除，走线无法附着')
  else if (!toObject.ports.some((p) => p.id === to.portId)) {
    addIssue('endpoint', toPos, `终点接口缺失（${toObject.name}）`)
  }

  // 6) 线缆间距（咨询级）：不参与硬性通过判定，仅提示
  const advisories = checkCableSpacing(input, samples, fromPos, toPos)

  return { samples, lengthM, issues, advisories, ok: issues.length === 0 }
}

/**
 * 线缆间最小净间隙检查（咨询级）：
 * - 要求两线表面间距 ≥ CABLE_CLEARANCE_M（按各自线径折算中心距）；
 * - 豁免：共用路由节点（视为有意并排 / 共用走线槽）与端点 80mm 范围内的出线空间；
 * - 不参与「无碰撞路径」判定（规划器只看硬性问题）。
 */
function checkCableSpacing(
  input: CableCheckInput,
  samples: Vec3[],
  fromPos: Vec3,
  toPos: Vec3,
): CableCheckIssue[] {
  const { cables, objects, selfCableId } = input
  if (!cables || cables.length === 0 || samples.length === 0) return []
  const self = selfCableId ? cables.find((c) => c.id === selfCableId) : undefined
  const selfThickness = self ? resolveCableThickness(self) : input.thickness ?? 'thick'
  const selfDiameter = CABLE_THICKNESS_META[selfThickness].diameterM
  const selfNodes = new Set((self?.route.nodeIds ?? []).filter((id): id is string => Boolean(id)))

  const advisories: CableCheckIssue[] = []
  const seen = new Set<string>()
  for (const other of cables) {
    if (other.id === selfCableId) continue
    // 共用路由节点：按并排 / 共用走线槽处理，豁免
    if ((other.route.nodeIds ?? []).some((id) => id && selfNodes.has(id))) continue

    const otherPts = cableDisplayPoints(other, objects, 'suggested')
    if (otherPts.length < 2) continue
    const otherSamples = sampleCurve(otherPts, 48)
    const otherDiameter = CABLE_THICKNESS_META[resolveCableThickness(other)].diameterM
    const required = (selfDiameter + otherDiameter) / 2 + CABLE_CLEARANCE_M

    const oFrom = resolveEndpointPosition(objects, other.from)
    const oTo = resolveEndpointPosition(objects, other.to)
    const nearEndpoint = (p: Vec3) =>
      dist3(p, fromPos) < 0.08 ||
      dist3(p, toPos) < 0.08 ||
      dist3(p, oFrom) < 0.08 ||
      dist3(p, oTo) < 0.08

    let bestD = Number.POSITIVE_INFINITY
    let bestP: Vec3 | null = null
    for (const p of samples) {
      for (const q of otherSamples) {
        const d = dist3(p, q)
        // 仅在「已经过近」时才做端点豁免判断（性能）
        if (d < required && (nearEndpoint(p) || nearEndpoint(q))) continue
        if (d < bestD) {
          bestD = d
          bestP = p
        }
      }
    }
    if (bestP && bestD < required) {
      const aName = objects.find((o) => o.id === other.from.objectId)?.name ?? '（已删除）'
      const bName = objects.find((o) => o.id === other.to.objectId)?.name ?? '（已删除）'
      const message = `与「${aName} → ${bName}」的走线最近约 ${Math.round(bestD * 1000)}mm，小于按线径要求的 ${Math.round(required * 1000)}mm（可并排共槽 / 加理线扣，或分开走线）`
      if (!seen.has(message)) {
        seen.add(message)
        advisories.push({ kind: 'cable', position: bestP, message })
      }
    }
  }
  return advisories
}

// ───────────────────────────── 规则式演示规划 ─────────────────────────────

export interface PlannedCableRoute {
  points: Vec3[]
  nodeIds: (string | null)[]
  channels: CableChannel[]
  /** 本次采用的走线策略（由线材类型推导） */
  strategy: CableRouteStrategy
}

export interface PlanCableResult {
  ok: boolean
  route: PlannedCableRoute
  issues: CableCheckIssue[]
  /** 已尝试的候选路径名称（展示用） */
  triedChains: string[]
  /** 线材类型（可见线 / 隐藏线）与其对应策略（展示用） */
  visibility: CableVisibility
  strategy: CableRouteStrategy
}

const CHANNEL_BY_NODE_KIND: Record<RouteNode['kind'], CableChannel> = {
  deskEdge: 'deskEdge',
  deskUnder: 'deskUnderside',
  backboard: 'backboard',
  leg: 'post',
  post: 'post',
  hole: 'free',
  outlet: 'free',
  floor: 'floor',
}

type Chain = { name: string; pts: Vec3[]; ids: (string | null)[] }

function classifyLocation(object: SceneObject | undefined, room: RoomConfig): 'desk' | 'floor' | 'other' {
  if (!object) return 'other'
  const yPos = object.transform.position[1]
  if (Math.abs(yPos - room.desk.height) < 0.08) return 'desk'
  if (yPos < 0.06) return 'floor'
  return 'other'
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}

function scaleVec(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s]
}

function dist2d(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2])
}

/** 去除过近的中间控制点（保持 nodeIds 对齐与首末点） */
function dedupeChain(chain: Chain): Chain {
  if (chain.pts.length <= 2) return chain
  const pts: Vec3[] = [chain.pts[0]]
  const ids: (string | null)[] = [chain.ids[0] ?? null]
  for (let i = 1; i < chain.pts.length; i += 1) {
    const isLast = i === chain.pts.length - 1
    const prev = pts[pts.length - 1]
    if (!isLast && Math.hypot(
      chain.pts[i][0] - prev[0],
      chain.pts[i][1] - prev[1],
      chain.pts[i][2] - prev[2],
    ) < 0.02) {
      continue
    }
    pts.push(chain.pts[i])
    ids.push(chain.ids[i] ?? null)
  }
  return { name: chain.name, pts, ids }
}

function channelsOf(ids: (string | null)[], nodes: Map<string, RouteNode>): CableChannel[] {
  const out: CableChannel[] = []
  for (const id of ids) {
    if (!id) continue
    const node = nodes.get(id)
    if (!node) continue
    const ch = CHANNEL_BY_NODE_KIND[node.kind]
    if (!out.includes(ch)) out.push(ch)
  }
  return out.length > 0 ? out : ['free']
}

/**
 * 生成候选路径链（按优先级排序）：
 * - 可见线（cableHole 策略）：优先经桌面出线槽（穿线孔）走线，其次桌沿 → 桌底 → 桌腿 / 地面；
 * - 隐藏线（backboard 策略）：优先沿桌面背板后走线（桌后沿 → 背板走线位 → 下行），尽量不穿桌面；
 * - 目标为「高位」（桌下横梁上的排插等）时，末尾改为桌底横向走线，不先落地再爬升。
 */
function buildChains(
  cable: CableConnection,
  objects: SceneObject[],
  room: RoomConfig,
  nodes: RouteNode[],
  strategy: CableRouteStrategy,
): Chain[] {
  const map = routeNodeMap(nodes)
  const node = (id: string): RouteNode | null => map.get(id) ?? null
  const fromPos = resolveEndpointPosition(objects, cable.from)
  const toPos = resolveEndpointPosition(objects, cable.to)
  const fromDir = resolveEndpointDirection(objects, cable.from)
  const toDir = resolveEndpointDirection(objects, cable.to)
  /** 引出点（沿接口朝向 50mm）：裁剪到房间内，避免贴墙接口把引导点推到墙外 */
  const clampToRoom = (p: Vec3): Vec3 => [
    Math.min(room.length / 2 - 0.02, Math.max(-room.length / 2 + 0.02, p[0])),
    Math.min(room.height - 0.02, Math.max(0.02, p[1])),
    Math.min(room.width - 0.02, Math.max(0.02, p[2])),
  ]
  /** 桌面下方设备的引出点不得抬进桌板：压到桌板下沿以下（避免「出线即穿桌板」） */
  const clampLeadUnderDesk = (base: Vec3, lead: Vec3): Vec3 => {
    const underCeil = room.desk.height - room.desk.thickness - 0.006
    const inFootprint =
      Math.abs(base[0]) <= room.desk.width / 2 &&
      base[2] >= DESK_GAP &&
      base[2] <= DESK_GAP + room.desk.depth
    if (inFootprint && base[1] < underCeil && lead[1] > underCeil) {
      return [lead[0], underCeil, lead[2]]
    }
    return lead
  }
  const fromLead = clampLeadUnderDesk(fromPos, clampToRoom(addVec(fromPos, scaleVec(fromDir, 0.05))))
  const toLead = clampLeadUnderDesk(toPos, clampToRoom(addVec(toPos, scaleVec(toDir, 0.05))))
  const fromObject = objects.find((o) => o.id === cable.from.objectId)
  const toObject = objects.find((o) => o.id === cable.to.objectId)
  const locA = classifyLocation(fromObject, room)
  const locB = classifyLocation(toObject, room)

  const desk = room.desk
  const yTop = desk.height + 0.006
  const yUnder = deskUnderY(room)
  const edgeXL = -(desk.width / 2 + 0.012)
  const edgeXR = desk.width / 2 + 0.012
  const chains: Chain[] = []
  const hidden = strategy === 'backboard'
  /** 目标为「高位」（桌下横梁上的排插 / 搁板设备等）：末尾改为桌底横向走线，不先落地再爬升 */
  const toHigh = toPos[1] > 0.25

  const floorNearB = nearestRouteNode(nodes, ['floor'], toPos)
  /** 桌底横向走线到目标正下方（供高位目标收尾） */
  const underRunToTarget: Vec3 = [toPos[0], yUnder, toPos[2]]

  /** 最近的出线孔入口节点（可见线优先经穿线槽，不限制起点距离） */
  const nearestHoleTop = (): RouteNode | null => {
    let best: RouteNode | null = null
    let bestD = Number.POSITIVE_INFINITY
    for (const n of nodes) {
      if (n.kind !== 'hole' || !n.id.endsWith('-top')) continue
      const d = dist2d(fromPos, n.position)
      if (d < bestD) {
        bestD = d
        best = n
      }
    }
    return best
  }

  /**
   * 侧边走线：从桌面沿 x 平移到桌沿外侧（保持高位，不切桌板），
   * 再在桌沿外竖直下落到桌底走线面，随后经桌底 → 桌腿 → 地面到终点；
   * 目标为高位时改为桌底横向走线到目标下方再上接。
   */
  const pushSideChain = (side: 'l' | 'r', tag: string) => {
    const legZ = Math.abs(toPos[2] - (DESK_GAP + desk.depth - 0.05)) <=
      Math.abs(toPos[2] - (DESK_GAP + 0.05)) ? 'front' : 'back'
    const edge = node(`edge-side-${side}`)
    const under = node(`under-${side}-${legZ}`)
    const legTop = node(`leg-${side}-${legZ}-top`)
    const legBottom = node(`leg-${side}-${legZ}-bottom`)
    if (!edge || !under || !legTop || !legBottom) return
    const edgeX = side === 'l' ? edgeXL : edgeXR
    const approachY = Math.max(fromPos[1], yTop)
    const tailPts: Vec3[] = toHigh
      ? [underRunToTarget]
      : [legTop.position, legBottom.position, ...(floorNearB ? [floorNearB.position] : [])]
    const tailIds: (string | null)[] = toHigh
      ? [null]
      : [legTop.id, legBottom.id, ...(floorNearB ? [floorNearB.id] : [])]
    chains.push({
      name: toHigh
        ? `侧边走线（${tag}：桌沿 → 桌底 → 目标下方）`
        : `侧边走线（${tag}：桌沿 → 桌底 → 桌腿 → 地面）`,
      pts: [
        fromPos,
        fromLead,
        [edgeX, approachY, fromPos[2]],
        [edgeX, yUnder, fromPos[2]],
        under.position,
        ...tailPts,
        toLead,
        toPos,
      ],
      ids: [null, null, edge.id, null, under.id, ...tailIds, null, null],
    })
  }

  /**
   * 背板后走线（隐藏线优先）：桌面设备 → 先沿 x 直退到后墙侧走线位（bbZ，桌体轮廓之外，
   * 避免斜穿桌面物件）→ 沿背板横向 / 下行 → 目标（高位目标在桌底高度横向接入；落地目标贴后墙下行）。
   */
  const pushBackboardChain = (tag: string): boolean => {
    const side = fromPos[0] <= 0 ? 'l' : 'r'
    const edge = node(`edge-back-${side}`)
    const bt = node(`back-${side}-top`)
    const bm = node(`back-${side}-mid`)
    const mid = node('back-mid')
    if (!edge || !bt || !bm || !mid) return false
    const bbZ = bt.position[2]
    const sourceLeadY = Math.max(fromPos[1], yTop)
    const targetSide = toPos[0] <= 0 ? 'l' : 'r'
    const waypointY = !toHigh ? 0.02 : toPos[1] < yUnder ? yUnder : yTop + 0.012
    const pts: Vec3[] = [
      fromPos,
      fromLead,
      [fromPos[0], sourceLeadY, bbZ],
      edge.position,
      bt.position,
      bm.position,
    ]
    const ids: (string | null)[] = [null, null, null, edge.id, bt.id, bm.id]
    if (targetSide !== side) {
      pts.push(mid.position)
      ids.push(mid.id)
    }
    pts.push([toPos[0], waypointY, bbZ], toLead, toPos)
    ids.push(null, null, null)
    chains.push({ name: `背板后走线（${tag}：桌后沿 → 背板 → 目标）`, pts, ids })
    return true
  }

  /**
   * 桌下接入（目标位于桌面下方，如桌下横梁排插）：
   * 先在桌体俯视轮廓之外把线引导到桌底走线面（回落点位于桌沿外侧 / 背板后，避免穿越桌板），
   * 再沿桌底横向接近目标正下方并上接；viaBack=true 沿背板（隐藏线），否则走指定一侧桌沿。
   */
  const pushUnderDeskAccess = (viaBack: boolean, side: 'l' | 'r') => {
    const sourceLeadY = Math.max(fromPos[1], yTop)
    if (viaBack) {
      const bt = node(`back-${side}-top`)
      const bm = node(`back-${side}-mid`)
      const mid = node('back-mid')
      if (!bt || !bm || !mid) return
      const bbZ = bt.position[2]
      const targetSide = toPos[0] <= 0 ? 'l' : 'r'
      // 先沿 x 直退到后墙侧走线位（bbZ，桌体轮廓之外），再横移 / 下落，避免斜穿桌面物件
      const pts: Vec3[] = [fromPos, fromLead, [fromPos[0], sourceLeadY, bbZ], bt.position, bm.position]
      const ids: (string | null)[] = [null, null, null, bt.id, bm.id]
      if (targetSide !== side) {
        pts.push(mid.position)
        ids.push(mid.id)
      }
      pts.push([toPos[0], yUnder, bbZ], underRunToTarget, toLead, toPos)
      ids.push(null, null, null, null)
      chains.push({ name: `桌下接入（背板后-${side === 'l' ? '左' : '右'}：贴后墙 → 下落 → 桌底接近）`, pts, ids })
      return
    }
    const edge = node(`edge-side-${side}`)
    if (!edge) return
    const edgeX = side === 'l' ? edgeXL : edgeXR
    chains.push({
      name: `桌下接入（${side === 'l' ? '左' : '右'}侧沿 → 下落 → 桌底接近）`,
      pts: [
        fromPos,
        fromLead,
        [edgeX, sourceLeadY, fromPos[2]],
        [edgeX, yUnder, fromPos[2]],
        [edgeX, yUnder, toPos[2]],
        underRunToTarget,
        toLead,
        toPos,
      ],
      ids: [null, null, edge.id, null, null, null, null, null],
    })
  }

  if (locA === 'desk' && (locB === 'floor' || locB === 'other')) {
    // 1) 隐藏线优先：沿桌面背板后走线（桌后沿 → 背板走线位 → 下行）
    if (hidden) pushBackboardChain('隐藏线')
    // 2) 出线槽 / 出线孔链：可见线优先经穿线孔（任意距离取最近孔）；隐藏线仅起点靠近孔时兜底
    const nearHoleTop = nodes.find(
      (n) => n.kind === 'hole' && n.id.endsWith('-top') && dist2d(fromPos, n.position) < 0.4,
    )
    const holeTop = strategy === 'cableHole' ? nearestHoleTop() : nearHoleTop
    if (holeTop) {
      const underId = holeTop.id.replace(/-top$/, '-under')
      const holeUnder = node(underId)
      if (holeUnder) {
        const tailPts: Vec3[] = toHigh
          ? [underRunToTarget]
          : floorNearB
            ? [floorNearB.position]
            : []
        const tailIds: (string | null)[] = toHigh
          ? [null]
          : floorNearB
            ? [floorNearB.id]
            : []
        chains.push({
          name:
            strategy === 'cableHole'
              ? '经出线槽（桌面 → 穿线孔 → 桌下）'
              : '经出线孔（桌面 → 孔下 → 桌下）',
          pts: [fromPos, fromLead, holeTop.position, holeUnder.position, ...tailPts, toLead, toPos],
          ids: [null, null, holeTop.id, underId, ...tailIds, null, null],
        })
      }
    }
    // 3) 侧边走线（优先近终点侧）
    const nearSide = toPos[0] <= 0 ? 'l' : 'r'
    pushSideChain(nearSide, nearSide === 'l' ? '左' : '右')
    pushSideChain(nearSide === 'l' ? 'r' : 'l', nearSide === 'l' ? '右' : '左')
    // 4) 兜底：就近从桌沿垂落
    const dropX = fromPos[0] <= 0 ? edgeXL : edgeXR
    chains.push({
      name: '就近垂落（桌沿 → 目标）',
      pts: [
        fromPos,
        fromLead,
        [dropX, Math.max(fromPos[1], yTop), fromPos[2]],
        [dropX, yUnder, fromPos[2]],
        ...(toHigh
          ? [underRunToTarget]
          : floorNearB
            ? [floorNearB.position]
            : []),
        toLead,
        toPos,
      ],
      ids: [
        null,
        null,
        null,
        null,
        ...(toHigh ? [null] : floorNearB ? [floorNearB.id] : []),
        null,
        null,
      ],
    })
  } else if (locA === 'desk' && locB === 'desk') {
    // 沿后桌边走廊（隐藏线优先：贴后桌边 / 背板方向；可见线作为靠后兜底）
    const sideA = fromPos[0] <= 0 ? 'l' : 'r'
    const sideB = toPos[0] <= 0 ? 'l' : 'r'
    const edgeA = node(`edge-back-${sideA}`)
    const edgeB = node(`edge-back-${sideB}`)
    const pushRearCorridor = () => {
      if (!edgeA || !edgeB) return
      chains.push({
        name: '桌边走廊（沿后桌边）',
        pts: [fromPos, fromLead, edgeA.position, edgeB.position, toLead, toPos],
        ids: [null, null, edgeA.id, edgeB.id, null, null],
      })
    }
    /** 目标在桌面下方（如桌下横梁排插）：末端需从桌体轮廓外下落再沿桌底接近，任何「自上而下」的链都会穿桌板 */
    const toUnderDesk =
      toPos[1] < yTop - 0.01 &&
      toPos[2] > DESK_GAP - 0.02 &&
      toPos[2] < DESK_GAP + desk.depth + 0.02
    if (hidden) pushRearCorridor()
    if (toUnderDesk) {
      // 可见线优先：经桌面出线槽（穿线孔）到桌下，再沿桌底接近目标
      if (strategy === 'cableHole') {
        const holeTop = nearestHoleTop()
        const holeUnder = holeTop ? node(holeTop.id.replace(/-top$/, '-under')) : null
        if (holeTop && holeUnder) {
          chains.push({
            name: '桌下接入（经出线槽：桌面 → 穿线孔 → 桌底接近）',
            pts: [fromPos, fromLead, holeTop.position, holeUnder.position, underRunToTarget, toLead, toPos],
            ids: [null, null, holeTop.id, holeUnder.id, null, null, null],
          })
        }
      }
      // 隐藏线：背板下落接桌底；可见线兜底：桌侧沿下落接桌底（两侧各试一次，命中近源侧优先）
      const firstSide = fromPos[0] <= 0 ? 'l' : 'r'
      pushUnderDeskAccess(hidden, firstSide)
      pushUnderDeskAccess(hidden, firstSide === 'l' ? 'r' : 'l')
    }
    // 1) 直连（近距设备间）
    chains.push({ name: '直连（桌面内）', pts: [fromPos, toPos], ids: [null, null] })
    // 2) L 形绕行（沿 x / 沿 z）
    chains.push({
      name: 'L 形绕行（先横向）',
      pts: [fromPos, [toPos[0], yTop, fromPos[2]], toPos],
      ids: [null, null, null],
    })
    chains.push({
      name: 'L 形绕行（先纵向）',
      pts: [fromPos, [fromPos[0], yTop, toPos[2]], toPos],
      ids: [null, null, null],
    })
    // 3) 侧向绕行（穿过桌面前排障碍物的绕行通道）
    const xLaneL = Math.min(fromPos[0], toPos[0]) - 0.1
    const xLaneR = Math.max(fromPos[0], toPos[0]) + 0.1
    chains.push({
      name: '侧向绕行（左）',
      pts: [fromPos, [xLaneL, yTop, fromPos[2]], [xLaneL, yTop, toPos[2]], toPos],
      ids: [null, null, null, null],
    })
    chains.push({
      name: '侧向绕行（右）',
      pts: [fromPos, [xLaneR, yTop, fromPos[2]], [xLaneR, yTop, toPos[2]], toPos],
      ids: [null, null, null, null],
    })
    // 4) 前缘绕行（沿桌面前缘通道）
    const zLaneF = DESK_GAP + desk.depth - 0.025
    chains.push({
      name: '前缘绕行',
      pts: [fromPos, [fromPos[0], yTop, zLaneF], [toPos[0], yTop, zLaneF], toPos],
      ids: [null, null, null, null],
    })
    // 5) 沿后桌边走廊（可见线兜底）
    if (!hidden) pushRearCorridor()
  } else if (locA === 'floor' && locB === 'floor') {
    const mid = node('floor-mid')
    if (mid) {
      chains.push({
        name: '地面走廊（经桌下中部）',
        pts: [fromPos, fromLead, mid.position, toLead, toPos],
        ids: [null, null, mid.id, null, null],
      })
    }
    chains.push({ name: '直连（地面）', pts: [fromPos, toPos], ids: [null, null] })
  } else {
    // 其他组合（含非桌面高度设备）：隐藏线优先贴桌沿 / 立柱侧边走线，否则直连 / L 形
    if (hidden) pushSideChain(toPos[0] <= 0 ? 'l' : 'r', '就近')
    chains.push({ name: '直连', pts: [fromPos, toPos], ids: [null, null] })
    chains.push({
      name: 'L 形绕行',
      pts: [fromPos, [toPos[0], Math.max(fromPos[1], toPos[1]) + 0.01, fromPos[2]], toPos],
      ids: [null, null, null],
    })
    if (!hidden) pushSideChain(toPos[0] <= 0 ? 'l' : 'r', '就近')
  }

  return chains.map(dedupeChain)
}

/**
 * 规则式演示规划：按线材类型（可见线 / 隐藏线）选择策略，在候选节点链中挑选
 * 第一条通过障碍检查的路径；全部失败时返回问题最少的一条（并附问题清单），由用户调整节点。
 */
export function planCableRoute(
  cable: CableConnection,
  objects: SceneObject[],
  room: RoomConfig,
  avoidZones: CableAvoidZone[],
  cables: CableConnection[] = [],
): PlanCableResult {
  const nodes = computeRouteNodes(room)
  const map = routeNodeMap(nodes)
  const visibility = resolveCableVisibility(cable, objects).visibility
  const strategy = CABLE_VISIBILITY_META[visibility].strategy
  const chains = buildChains(cable, objects, room, nodes, strategy)
  const triedChains = chains.map((c) => c.name)

  let best: { chain: Chain; result: CableCheckResult } | null = null
  for (const chain of chains) {
    const result = checkCableRoute({
      points: chain.pts,
      from: cable.from,
      to: cable.to,
      objects,
      room,
      avoidZones,
      cable,
      cables,
      selfCableId: cable.id,
    })
    if (result.ok) {
      return {
        ok: true,
        route: {
          points: chain.pts,
          nodeIds: chain.ids,
          channels: channelsOf(chain.ids, map),
          strategy,
        },
        issues: [],
        triedChains,
        visibility,
        strategy,
      }
    }
    if (!best || result.issues.length < best.result.issues.length) {
      best = { chain, result }
    }
  }

  const fallback: Chain = best?.chain ?? { name: '直连', pts: [resolveEndpointPosition(objects, cable.from), resolveEndpointPosition(objects, cable.to)], ids: [null, null] }
  return {
    ok: false,
    route: {
      points: fallback.pts,
      nodeIds: fallback.ids,
      channels: channelsOf(fallback.ids, map),
      strategy,
    },
    issues: best?.result.issues ?? [],
    triedChains,
    visibility,
    strategy,
  }
}
