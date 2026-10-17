import type { CableConnection, SceneObject, Vec3 } from '@/types/project'
import { cableDisplayPoints } from '@/scene/cables'

/**
 * 墙面插座位置调整的影响分析（本地计算，非模拟）：
 * - 「相关线缆」判定：路径节点引用了该插座（nodeIds 含 `outlet-<id>`），或走线控制点经过
 *   插座原位置附近（默认 150mm 内，含端点实时坐标）；
 * - 保存插座新位置后应把这些线缆标记为 stale（需重新规划），不删除已有路径。
 */

/** 走线经过插座附近的判定半径（米） */
export const OUTLET_IMPACT_RADIUS_M = 0.15

function nearPoint(points: Vec3[], target: Vec3, radius: number): boolean {
  const r2 = radius * radius
  for (const p of points) {
    const dx = p[0] - target[0]
    const dy = p[1] - target[1]
    const dz = p[2] - target[2]
    if (dx * dx + dy * dy + dz * dz <= r2) return true
  }
  return false
}

/** 单个插座移动后的相关线缆 id 列表（previousPosition 为移动前的位置） */
export function cablesAffectedByOutletMove(
  cables: CableConnection[],
  objects: SceneObject[],
  outletId: string,
  previousPosition: Vec3,
): string[] {
  const nodeId = `outlet-${outletId}`
  const ids: string[] = []
  for (const c of cables) {
    const referencesNode = (c.route.nodeIds ?? []).includes(nodeId)
    const passesNear =
      referencesNode ||
      nearPoint(cableDisplayPoints(c, objects, 'suggested'), previousPosition, OUTLET_IMPACT_RADIUS_M)
    if (passesNear) ids.push(c.id)
  }
  return ids
}

/**
 * 按线缆 id 标记「需重新计算」：
 * - status 已是 stale 的不重复标记；conflict 的保持冲突提示（不降级）；
 * - 只在确有变化时返回新数组（避免无意义的存储写入）。
 */
export function markCablesStaleByIds(
  cables: CableConnection[],
  ids: string[],
): CableConnection[] {
  if (ids.length === 0) return cables
  const set = new Set(ids)
  let changed = false
  const next = cables.map((c) => {
    if (!set.has(c.id) || c.status === 'stale' || c.status === 'conflict') return c
    changed = true
    return { ...c, status: 'stale' as const, updatedAt: Date.now() }
  })
  return changed ? next : cables
}
