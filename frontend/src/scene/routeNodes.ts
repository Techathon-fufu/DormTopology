import type { RoomConfig, Vec3 } from '@/types/project'
import { DESK_GAP } from '@/scene/sceneValidation'
import { computeOrganizationZones } from '@/scene/organizationZones'
import type { OrganizationPreferences } from '@/types/organization'
import type { CableAvoidZone, RouteNode } from '@/types/cable'

/**
 * 场景路由节点与走线避让区（演示用「规则式」参考）。
 *
 * 路由节点由房间配置推导：桌边 / 桌底 / 桌腿与床架立柱 / 出线孔 / 插座 / 地面。
 * 演示路径规划优先经过这些节点（见 @/scene/cableRoute.ts）。
 */

/** 桌底走线面的高度（桌面下沿再留 20mm 走线间隙，米） */
export function deskUnderY(room: RoomConfig): number {
  return room.desk.height - room.desk.thickness - 0.02
}

export function computeRouteNodes(room: RoomConfig): RouteNode[] {
  const nodes: RouteNode[] = []
  const d = room.desk
  const y = d.height
  const yTop = y + 0.004
  const yUnder = deskUnderY(room)
  const g = DESK_GAP
  const w2 = d.width / 2
  const zMid = g + d.depth / 2
  const zFront = g + d.depth - 0.03
  const zBack = g + 0.03
  const legZBack = g + 0.05
  const legZFront = g + d.depth - 0.05
  const legX = w2 - 0.022 // 桌腿外侧绑线位

  const push = (id: string, kind: RouteNode['kind'], label: string, position: Vec3) =>
    nodes.push({ id, kind, label, position })

  // 桌边（桌面四边，含左右侧沿）
  push('edge-back-l', 'deskEdge', '桌边·后左', [-w2 + 0.03, yTop, zBack])
  push('edge-back-r', 'deskEdge', '桌边·后右', [w2 - 0.03, yTop, zBack])
  push('edge-side-l', 'deskEdge', '桌边·左侧', [-w2 - 0.012, yTop, zMid])
  push('edge-side-r', 'deskEdge', '桌边·右侧', [w2 + 0.012, yTop, zMid])
  push('edge-front-l', 'deskEdge', '桌边·前左', [-w2 + 0.03, yTop, zFront])
  push('edge-front-r', 'deskEdge', '桌边·前右', [w2 - 0.03, yTop, zFront])

  // 背板走线位（桌后沿与后墙之间的走线面，隐藏线优先经过；上 / 中及后中三点）
  const bbZ = g * 0.5
  const bbY = y + 0.012
  push('back-l-top', 'backboard', '背板·后左上', [-w2 + 0.06, bbY, bbZ])
  push('back-r-top', 'backboard', '背板·后右上', [w2 - 0.06, bbY, bbZ])
  push('back-l-mid', 'backboard', '背板·后左中', [-w2 + 0.06, yUnder, bbZ])
  push('back-r-mid', 'backboard', '背板·后右中', [w2 - 0.06, yUnder, bbZ])
  push('back-mid', 'backboard', '背板·后中', [0, yUnder, bbZ])

  // 桌底（桌面下沿，内收避开桌腿）
  push('under-l-front', 'deskUnder', '桌底·左前', [-w2 + 0.06, yUnder, zFront - 0.03])
  push('under-l-back', 'deskUnder', '桌底·左后', [-w2 + 0.06, yUnder, zBack + 0.03])
  push('under-r-front', 'deskUnder', '桌底·右前', [w2 - 0.06, yUnder, zFront - 0.03])
  push('under-r-back', 'deskUnder', '桌底·右后', [w2 - 0.06, yUnder, zBack + 0.03])
  push('under-mid-back', 'deskUnder', '桌底·后中', [0, yUnder, g + 0.04])

  // 桌腿立柱（外侧绑线位，上 / 下两处）
  for (const [sx, side] of [
    [-1, 'l'],
    [1, 'r'],
  ] as const) {
    push(`leg-${side}-back-top`, 'leg', `桌腿·${side === 'l' ? '左' : '右'}后上`, [sx * legX, yUnder, legZBack])
    push(`leg-${side}-back-bottom`, 'leg', `桌腿·${side === 'l' ? '左' : '右'}后下`, [sx * legX, 0.05, legZBack])
    push(`leg-${side}-front-top`, 'leg', `桌腿·${side === 'l' ? '左' : '右'}前上`, [sx * legX, yUnder, legZFront])
    push(`leg-${side}-front-bottom`, 'leg', `桌腿·${side === 'l' ? '左' : '右'}前下`, [sx * legX, 0.05, legZFront])
  }

  // 床架立柱（外侧绑线位）
  for (const post of room.posts) {
    const [px, , pz] = post.position
    const outX = px + Math.sign(px || 1) * (post.section / 2 + 0.02)
    const sideLabel = px < 0 ? '左' : '右'
    const posLabel = pz < room.width / 2 ? '后' : '前'
    push(`post-${post.id}-mid`, 'post', `立柱·${sideLabel}${posLabel}中`, [outX, 0.45, pz])
    push(`post-${post.id}-low`, 'post', `立柱·${sideLabel}${posLabel}下`, [outX, 0.05, pz])
  }

  // 出线孔（桌面上「入口」/ 桌底下「出口」两个走线点）
  for (const hole of room.cableHoles) {
    const [hx, , hz] = hole.position
    push(
      `hole-${hole.id}-top`,
      'hole',
      `出线孔·入口（桌面进入 ⌀${Math.round(hole.diameter * 1000)}mm）`,
      [hx, yTop, hz],
    )
    push(
      `hole-${hole.id}-under`,
      'hole',
      `出线孔·出口（桌下穿出 ⌀${Math.round(hole.diameter * 1000)}mm）`,
      [hx, yUnder, hz],
    )
  }

  // 插座
  for (const outlet of room.outlets) {
    push(`outlet-${outlet.id}`, 'outlet', outlet.label, [...outlet.position] as Vec3)
  }

  // 地面走廊（桌下）
  push('floor-mid', 'floor', '地面·桌下中', [0, 0.02, g + 0.23])
  push('floor-back-l', 'floor', '地面·左后', [-w2 + 0.08, 0.02, g + 0.11])
  push('floor-back-r', 'floor', '地面·右后', [w2 - 0.08, 0.02, g + 0.11])
  push('floor-front-l', 'floor', '地面·左前', [-w2 + 0.08, 0.02, g + d.depth - 0.08])
  push('floor-front-r', 'floor', '地面·右前', [w2 - 0.08, 0.02, g + d.depth - 0.08])

  return nodes
}

/**
 * 走线避让区：打字活动区 / 水杯活动区（与空间整理共用同一几何），
 * 以及桌下腿部活动区（桌下前部中段，线缆应贴后 / 贴腿走）。
 */
export function computeCableAvoidZones(
  room: RoomConfig,
  prefs: OrganizationPreferences,
): CableAvoidZone[] {
  const zones = computeOrganizationZones(room, prefs)
  const deskY = room.desk.height
  const d = room.desk
  const g = DESK_GAP
  const legRoomX = Math.max(0.2, d.width / 2 - 0.18)

  return [
    {
      id: 'zone-typing',
      kind: 'typing',
      label: '打字活动区（避让）',
      rect: zones.typing.rect,
      y0: deskY - 0.02,
      y1: deskY + 0.35,
    },
    {
      id: 'zone-cup',
      kind: 'cup',
      label: '水杯活动区（避让）',
      rect: zones.cup.rect,
      y0: deskY - 0.02,
      y1: deskY + 0.35,
    },
    {
      id: 'zone-legroom',
      kind: 'legroom',
      label: '桌下腿部活动区（避让）',
      rect: {
        x0: -legRoomX,
        x1: legRoomX,
        z0: g + d.depth * 0.55,
        z1: g + d.depth + 0.02,
      },
      y0: 0,
      y1: room.desk.height - room.desk.thickness - 0.02,
    },
  ]
}

/** 按 id 取路由节点 */
export function routeNodeMap(nodes: RouteNode[]): Map<string, RouteNode> {
  return new Map(nodes.map((n) => [n.id, n]))
}

/** 距离目标点最近的指定类型路由节点 */
export function nearestRouteNode(
  nodes: RouteNode[],
  kinds: RouteNode['kind'][],
  target: Vec3,
): RouteNode | null {
  let best: RouteNode | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const n of nodes) {
    if (!kinds.includes(n.kind)) continue
    const dist = Math.hypot(n.position[0] - target[0], n.position[2] - target[2])
    if (dist < bestDist) {
      bestDist = dist
      best = n
    }
  }
  return best
}
