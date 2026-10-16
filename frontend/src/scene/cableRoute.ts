import * as THREE from 'three'
import type {
  CableChannel,
  CableConnection,
  CableEndpoint,
  RoomConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import type { CableAvoidZone, CableCheckIssue, CableCheckResult, RouteNode } from '@/types/cable'
import { computeRouteNodes, deskUnderY, nearestRouteNode, routeNodeMap } from '@/scene/routeNodes'
import { resolveEndpointDirection, resolveEndpointPosition } from '@/scene/cables'
import { rotateLocalVecY } from '@/scene/ports'
import { DESK_GAP } from '@/scene/sceneValidation'
import { polylineLength } from '@/scene/geometry'

/**
 * 走线路径：平滑采样 + 障碍检查 + 规则式演示规划。
 *
 * 诚实标注：
 * - Catmull-Rom 曲线只用于「渲染」与「长度估算」；避让结论来自对平滑采样点的障碍检查；
 * - 该检查是本地几何规则（采样点 vs 避让区 / 物品包围盒 / 桌板），不是真实寻路算法；
 * - 规划器在少量候选节点链中挑选第一条无碰撞链（演示路径优先经过桌边 / 桌底 / 立柱 / 出线孔），
 *   全部候选失败时返回问题清单，由用户调整路径节点。
 */

const SAMPLE_DIVISIONS = 64

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
export function estimateCableLength(points: Vec3[]): number {
  return polylineLength(sampleCurve(points))
}

// ───────────────────────────── 障碍检查 ─────────────────────────────

export interface CableCheckInput {
  points: Vec3[]
  from: CableEndpoint
  to: CableEndpoint
  objects: SceneObject[]
  room: RoomConfig
  avoidZones: CableAvoidZone[]
}

function pointInZoneXZ(p: Vec3, zone: CableAvoidZone, margin: number): boolean {
  return (
    p[0] >= zone.rect.x0 - margin &&
    p[0] <= zone.rect.x1 + margin &&
    p[2] >= zone.rect.z0 - margin &&
    p[2] <= zone.rect.z1 + margin
  )
}

function pointHitsZone(p: Vec3, zone: CableAvoidZone): boolean {
  return pointInZoneXZ(p, zone, 0.012) && p[1] >= zone.y0 - 0.01 && p[1] <= zone.y1
}

function pointHitsObject(p: Vec3, o: SceneObject): boolean {
  const y0 = o.transform.position[1]
  if (p[1] < y0 - 0.005 || p[1] > y0 + o.dimensions.height + 0.012) return false
  const dx = p[0] - o.transform.position[0]
  const dz = p[2] - o.transform.position[2]
  const local = rotateLocalVecY([dx, 0, dz], -o.transform.rotationY)
  return (
    Math.abs(local[0]) <= o.dimensions.width / 2 + 0.012 &&
    Math.abs(local[2]) <= o.dimensions.depth / 2 + 0.012
  )
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

/**
 * 对平滑后的路径做障碍检查（避让区 / 物品 / 桌板 / 房间边界），
 * 返回采样点、长度与问题清单（去重：同类问题仅保留第一条位置）。
 */
export function checkCableRoute(input: CableCheckInput): CableCheckResult {
  const { points, from, to, objects, room, avoidZones } = input
  const samples = sampleCurve(points)
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

  // 端点位于避让区内时豁免该区（如键盘本身就放在打字活动区里）
  const activeZones = avoidZones.filter(
    (z) => !pointInZoneXZ(fromPos, z, 0.06) && !pointInZoneXZ(toPos, z, 0.06),
  )
  const testObjects = objects.filter(
    (o) => o.visible && o.id !== from.objectId && o.id !== to.objectId,
  )
  // 端点 55mm 范围内视为「出线空间」：插头附近线缆贴靠邻近物品属正常，不判定相交
  const nearEndpoint = (p: Vec3) => dist3(p, fromPos) < 0.055 || dist3(p, toPos) < 0.055

  for (const p of samples) {
    // 1) 房间边界
    if (p[1] < -0.002) addIssue('bounds', p, '路径低于地面（越界）')
    if (p[1] > room.height - 0.005) addIssue('bounds', p, '路径超过层高（越界）')
    if (Math.abs(p[0]) > room.length / 2 - 0.004) addIssue('bounds', p, '路径超出房间左右边界')
    if (p[2] < -0.004 || p[2] > room.width - 0.004) addIssue('bounds', p, '路径超出房间前后边界')

    // 2) 避让区（立体区间）
    for (const z of activeZones) {
      if (pointHitsZone(p, z)) {
        addIssue('zone', p, `与「${z.label}」相交（避让区）`)
        break
      }
    }

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
        (h) => Math.hypot(p[0] - h.position[0], p[2] - h.position[2]) < h.diameter / 2 + 0.03,
      )
      if (!nearHole) addIssue('slab', p, '路径穿过桌板（可从出线孔走线）')
    }

    // 4) 物品包围盒（不含线缆两端设备；端点附近为出线空间）
    if (!nearEndpoint(p)) {
      for (const o of testObjects) {
        if (pointHitsObject(p, o)) {
          addIssue('object', p, `与「${o.name}」相交`)
          break
        }
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

  return { samples, lengthM, issues, ok: issues.length === 0 }
}

// ───────────────────────────── 规则式演示规划 ─────────────────────────────

export interface PlannedCableRoute {
  points: Vec3[]
  nodeIds: (string | null)[]
  channels: CableChannel[]
}

export interface PlanCableResult {
  ok: boolean
  route: PlannedCableRoute
  issues: CableCheckIssue[]
  /** 已尝试的候选路径名称（展示用） */
  triedChains: string[]
}

const CHANNEL_BY_NODE_KIND: Record<RouteNode['kind'], CableChannel> = {
  deskEdge: 'deskEdge',
  deskUnder: 'deskUnderside',
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

/** 生成候选路径链（按优先级排序） */
function buildChains(
  cable: CableConnection,
  objects: SceneObject[],
  room: RoomConfig,
  nodes: RouteNode[],
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
  const fromLead = clampToRoom(addVec(fromPos, scaleVec(fromDir, 0.05)))
  const toLead = clampToRoom(addVec(toPos, scaleVec(toDir, 0.05)))
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

  const floorNearB = nearestRouteNode(nodes, ['floor'], toPos)

  /**
   * 侧边走线：从桌面沿 x 平移到桌沿外侧（保持高位，不切桌板），
   * 再在桌沿外竖直下落到桌底走线面，随后经桌底 → 桌腿 → 地面到终点。
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
    chains.push({
      name: `侧边走线（${tag}：桌沿 → 桌底 → 桌腿 → 地面）`,
      pts: [
        fromPos,
        fromLead,
        [edgeX, approachY, fromPos[2]],
        [edgeX, yUnder, fromPos[2]],
        under.position,
        legTop.position,
        legBottom.position,
        ...(floorNearB ? [floorNearB.position] : []),
        toLead,
        toPos,
      ],
      ids: [
        null,
        null,
        edge.id,
        null,
        under.id,
        legTop.id,
        legBottom.id,
        ...(floorNearB ? [floorNearB.id] : []),
        null,
        null,
      ],
    })
  }

  if (locA === 'desk' && (locB === 'floor' || locB === 'other')) {
    // 1) 出线孔链（起点靠近出线孔时优先）
    const holeTop = nodes.find(
      (n) => n.kind === 'hole' && n.id.endsWith('-top') && dist2d(fromPos, n.position) < 0.4,
    )
    if (holeTop) {
      const underId = holeTop.id.replace(/-top$/, '-under')
      const holeUnder = node(underId)
      if (holeUnder) {
        chains.push({
          name: '经出线孔（桌面 → 孔下 → 地面）',
          pts: [
            fromPos,
            fromLead,
            holeTop.position,
            holeUnder.position,
            ...(floorNearB ? [floorNearB.position] : []),
            toLead,
            toPos,
          ],
          ids: [null, null, holeTop.id, underId, ...(floorNearB ? [floorNearB.id] : []), null, null],
        })
      }
    }
    // 2) 侧边走线（优先近终点侧）
    const nearSide = toPos[0] <= 0 ? 'l' : 'r'
    pushSideChain(nearSide, nearSide === 'l' ? '左' : '右')
    pushSideChain(nearSide === 'l' ? 'r' : 'l', nearSide === 'l' ? '右' : '左')
    // 3) 兜底：就近从桌沿垂落
    const dropX = fromPos[0] <= 0 ? edgeXL : edgeXR
    chains.push({
      name: '就近垂落（桌沿 → 地面）',
      pts: [
        fromPos,
        fromLead,
        [dropX, Math.max(fromPos[1], yTop), fromPos[2]],
        [dropX, yUnder, fromPos[2]],
        ...(floorNearB ? [floorNearB.position] : []),
        toLead,
        toPos,
      ],
      ids: [null, null, null, null, ...(floorNearB ? [floorNearB.id] : []), null, null],
    })
  } else if (locA === 'desk' && locB === 'desk') {
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
    // 5) 沿后桌边走廊
    const sideA = fromPos[0] <= 0 ? 'l' : 'r'
    const sideB = toPos[0] <= 0 ? 'l' : 'r'
    const edgeA = node(`edge-back-${sideA}`)
    const edgeB = node(`edge-back-${sideB}`)
    if (edgeA && edgeB) {
      chains.push({
        name: '桌边走廊（沿后桌边）',
        pts: [fromPos, fromLead, edgeA.position, edgeB.position, toLead, toPos],
        ids: [null, null, edgeA.id, edgeB.id, null, null],
      })
    }
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
    // 其他组合（含非桌面高度设备）：直连 / L 形 / 就近侧边走线
    chains.push({ name: '直连', pts: [fromPos, toPos], ids: [null, null] })
    chains.push({
      name: 'L 形绕行',
      pts: [fromPos, [toPos[0], Math.max(fromPos[1], toPos[1]) + 0.01, fromPos[2]], toPos],
      ids: [null, null, null],
    })
    pushSideChain(toPos[0] <= 0 ? 'l' : 'r', '就近')
  }

  return chains.map(dedupeChain)
}

/**
 * 规则式演示规划：在候选节点链中挑选第一条通过障碍检查的路径；
 * 全部失败时返回问题最少的一条（并附问题清单），由用户调整节点。
 */
export function planCableRoute(
  cable: CableConnection,
  objects: SceneObject[],
  room: RoomConfig,
  avoidZones: CableAvoidZone[],
): PlanCableResult {
  const nodes = computeRouteNodes(room)
  const map = routeNodeMap(nodes)
  const chains = buildChains(cable, objects, room, nodes)
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
    })
    if (result.ok) {
      return {
        ok: true,
        route: { points: chain.pts, nodeIds: chain.ids, channels: channelsOf(chain.ids, map) },
        issues: [],
        triedChains,
      }
    }
    if (!best || result.issues.length < best.result.issues.length) {
      best = { chain, result }
    }
  }

  const fallback: Chain = best?.chain ?? { name: '直连', pts: [resolveEndpointPosition(objects, cable.from), resolveEndpointPosition(objects, cable.to)], ids: [null, null] }
  return {
    ok: false,
    route: { points: fallback.pts, nodeIds: fallback.ids, channels: channelsOf(fallback.ids, map) },
    issues: best?.result.issues ?? [],
    triedChains,
  }
}
