import * as THREE from 'three'
import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import type { DeskSurfaceMetrics } from '@/scene/deskModel'
import { bottomContacts, containedInCavity, objectRoomHits, objectsCollide, worldCollision } from './collisionGeometry'
import { cachedRoomSolids } from './roomCollision'

/**
 * 场景摆放校验与支撑面计算（本地真实计算，非模拟）。
 *
 * - 支撑面：桌面 / 书架搁板 / 地面（用于拖拽吸附与「吸附到支撑面」）；
 *   高度优先采用桌体 GLB 实测锚点（DeskSurfaceMetrics），未加载模型 / 无锚点时回退 RoomConfig
 * - 校验：越界（房间外 / 地面下 / 超层高）、明显相交（物品间）、悬空（无支撑）
 * - 相交检测使用共享模型部件的三维凸体 SAT；碰撞与可见实体使用相同几何
 */

export type SupportKind = 'desk' | 'shelf' | 'beam' | 'floor' | 'none'

export interface SupportInfo {
  kind: SupportKind
  /** 支撑面上表面高度（米） */
  y: number
  label: string
}

/** 书架搁板厚度（与 RoomShell 渲染一致） */
export const SHELF_THICKNESS = 0.018
/** 桌面后沿与后墙留缝（与 RoomShell 一致） */
export const DESK_GAP = 0.05

/** 桌下横梁（排插推荐放置位）截面高度（米，与 ParametricDesk 渲染一致） */
export const DESK_BEAM_SECTION = 0.03
/** 桌下横梁截面深度（米） */
export const DESK_BEAM_DEPTH = 0.06
/** 桌下横梁中心距后墙距离（米）：位于桌面下方后侧 */
export const DESK_BEAM_Z = DESK_GAP + 0.05
/** 桌下横梁两端距桌边内收（米） */
export const DESK_BEAM_INSET = 0.05

/** 桌下横梁上表面高度（米）：排插放在横梁上的放置面 */
export function deskBeamTopY(room: RoomConfig): number {
  return room.desk.height - room.desk.thickness - 0.05
}
/** 判定为「贴合支撑面」的高度容差（米） */
const FLOATING_TOLERANCE = 0.001
/** 越界判定容差（米） */
const BOUNDS_EPSILON = 0.001
/**
 * 场地穿模判定容差（米）：贴面摆放与拖拽 / 旋转的浮点噪声不算穿模，
 * 超过该深度才报告与桌体实体相交。
 */
const ROOM_CLEARANCE = 0.001

/** 桌面高度：优先采用桌体 GLB 实测锚点（deskModelStore.metrics），否则回退 RoomConfig */
export function deskTopY(room: RoomConfig, metrics?: DeskSurfaceMetrics | null): number {
  return metrics?.deskTopY ?? room.desk.height
}

export function shelfTopY(room: RoomConfig, metrics?: DeskSurfaceMetrics | null): number {
  return metrics?.shelfTopY ?? room.desk.height + room.shelf.heightAboveDesk + SHELF_THICKNESS / 2
}

/** 指定 x-z 位置之上的所有房间支撑面（含被上方遮挡的） */
export function supportsContaining(
  room: RoomConfig,
  x: number,
  z: number,
  metrics?: DeskSurfaceMetrics | null,
): SupportInfo[] {
  const list: SupportInfo[] = []
  const desk = room.desk
  if (
    room.shelf.enabled &&
    Math.abs(x) <= (desk.width - 0.2) / 2 &&
    z >= DESK_GAP &&
    z <= DESK_GAP + room.shelf.depth
  ) {
    list.push({ kind: 'shelf', y: shelfTopY(room, metrics), label: '书架搁板' })
  }
  if (Math.abs(x) <= desk.width / 2 && z >= DESK_GAP && z <= DESK_GAP + desk.depth) {
    list.push({ kind: 'desk', y: deskTopY(room, metrics), label: '桌面' })
  }
  // 桌下横梁：排插推荐放置位（展开为支撑面，便于「放到桌下横梁」与悬空校验）
  if (
    Math.abs(x) <= (desk.width - DESK_BEAM_INSET * 2) / 2 &&
    Math.abs(z - DESK_BEAM_Z) <= DESK_BEAM_DEPTH / 2
  ) {
    list.push({ kind: 'beam', y: deskBeamTopY(room), label: '桌下横梁' })
  }
  if (Math.abs(x) <= room.length / 2 && z >= 0 && z <= room.width) {
    list.push({ kind: 'floor', y: 0, label: '地面' })
  }
  return list
}

/** 与当前高度最接近的支撑面（用于「吸附到支撑面」按钮：不强行把桌面物品吸上搁板） */
export function nearestSupport(
  room: RoomConfig,
  x: number,
  z: number,
  baseY: number,
  metrics?: DeskSurfaceMetrics | null,
): SupportInfo | null {
  const list = supportsContaining(room, x, z, metrics)
  if (list.length === 0) return null
  return [...list].sort((a, b) => Math.abs(a.y - baseY) - Math.abs(b.y - baseY))[0]
}

export interface SupportHit extends SupportInfo {
  x: number
  z: number
}

const _plane = new THREE.Plane()
const _normal = new THREE.Vector3(0, 1, 0)
const _hit = new THREE.Vector3()

/**
 * 拖拽用：把指针射线投射到支撑面上，取距离相机最近的一张面。
 * 指针悬在桌面上方 → 吸附桌面；悬在书架上方 → 吸附搁板；悬在地面 → 落地。
 */
export function raycastSupports(
  ray: THREE.Ray,
  room: RoomConfig,
  metrics?: DeskSurfaceMetrics | null,
): SupportHit | null {
  const hits: SupportHit[] = []

  const tryPlane = (y: number, kind: SupportKind, label: string, contains: (x: number, z: number) => boolean) => {
    _plane.set(_normal, -y)
    if (!ray.intersectPlane(_plane, _hit)) return
    if (!contains(_hit.x, _hit.z)) return
    hits.push({ kind, y, label, x: _hit.x, z: _hit.z })
  }

  tryPlane(0, 'floor', '地面', (x, z) => Math.abs(x) <= room.length / 2 && z >= 0 && z <= room.width)
  tryPlane(
    deskTopY(room, metrics),
    'desk',
    '桌面',
    (x, z) => Math.abs(x) <= room.desk.width / 2 && z >= DESK_GAP && z <= DESK_GAP + room.desk.depth,
  )
  if (room.shelf.enabled) {
    tryPlane(
      shelfTopY(room, metrics),
      'shelf',
      '书架搁板',
      (x, z) =>
        Math.abs(x) <= (room.desk.width - 0.2) / 2 && z >= DESK_GAP && z <= DESK_GAP + room.shelf.depth,
    )
  }
  tryPlane(
    deskBeamTopY(room),
    'beam',
    '桌下横梁',
    (x, z) =>
      Math.abs(x) <= (room.desk.width - DESK_BEAM_INSET * 2) / 2 &&
      Math.abs(z - DESK_BEAM_Z) <= DESK_BEAM_DEPTH / 2,
  )

  if (hits.length === 0) return null
  let best = hits[0]
  let bestDist = ray.origin.distanceToSquared(new THREE.Vector3(best.x, best.y, best.z))
  for (const hit of hits.slice(1)) {
    const d = ray.origin.distanceToSquared(new THREE.Vector3(hit.x, hit.y, hit.z))
    if (d < bestDist) {
      best = hit
      bestDist = d
    }
  }
  return best
}

// ── 校验 ────────────────────────────────────────────────────────────────

export interface SceneIssue {
  type: 'outOfBounds' | 'overlap' | 'roomCollision' | 'floating'
  message: string
  relatedId?: string
}

/** Storage semantics describe a real cavity; no blanket collision exemptions. */
export function isContainerLike(o: SceneObject): boolean {
  return o.model.shape === 'storageBox'
}
export function isContainedWithin(inner: SceneObject, innerPos: Vec3, outer: SceneObject, outerPos: Vec3): boolean {
  return containedInCavity(inner, innerPos, outer, outerPos)
}
export function objectsOverlapAt(a: SceneObject, aPos: Vec3, b: SceneObject, bPos: Vec3): boolean {
  return objectsCollide(a, aPos, b, bPos)
}

/**
 * 指定位置下某物品的摆放问题（拖动预览与正式校验共用）。
 * position 为物品底面中心点（米）。
 */
export function placementIssues(
  object: SceneObject,
  position: Vec3,
  others: SceneObject[],
  room: RoomConfig,
  metrics?: DeskSurfaceMetrics | null,
): SceneIssue[] {
  const issues: SceneIssue[] = []
  const bounds = worldCollision(object, position).bounds

  // 1) 越界
  const outParts: string[] = []
  if (bounds.min[0] < -room.length / 2 - BOUNDS_EPSILON || bounds.max[0] > room.length / 2 + BOUNDS_EPSILON) {
    outParts.push('左右超出房间')
  }
  if (bounds.min[2] < -BOUNDS_EPSILON || bounds.max[2] > room.width + BOUNDS_EPSILON) {
    outParts.push('前后超出房间')
  }
  if (bounds.min[1] < -BOUNDS_EPSILON) outParts.push('低于地面')
  if (bounds.max[1] > room.height + BOUNDS_EPSILON) outParts.push('超过层高')
  if (outParts.length > 0) {
    issues.push({ type: 'outOfBounds', message: `越界：${outParts.join('、')}` })
  }

  // 2) 与其它物品明显相交（SAT + 高度重叠；收纳进容器内部不算相交）
  let overlapCount = 0
  for (const other of others) {
    if (other.id === object.id || !other.visible) continue
    if (objectsOverlapAt(object, position, other, other.transform.position)) {
      overlapCount += 1
      if (overlapCount <= 2) {
        issues.push({
          type: 'overlap',
          message: `与「${other.name}」明显相交`,
          relatedId: other.id,
        })
      }
    }
  }
  if (overlapCount > 2) {
    issues.push({ type: 'overlap', message: `另有 ${overlapCount - 2} 件物品相交` })
  }

  // 3) 与场地固定实体（桌面 / 桌腿 / 横梁 / 书架搁板与侧板 / 立柱）穿模
  const roomHits = objectRoomHits(object, position, cachedRoomSolids(room), ROOM_CLEARANCE)
  if (roomHits.length > 0) {
    const labels = [...new Set(roomHits.map((hit) => hit.label))]
    issues.push({
      type: 'roomCollision',
      message: `穿模：与${labels.join('、')}相交，超出声明的允许间隙`,
      relatedId: roomHits[0].id,
    })
  }

  // Every bottom contact must rest on a declared room plane or a real horizontal solid face.
  const contacts = bottomContacts(object, position)
  const supported = contacts.every(contact => {
    if (supportsContaining(room, contact[0], contact[2], metrics).some(s => Math.abs(s.y-contact[1]) <= FLOATING_TOLERANCE)) return true
    for (const other of others) {
      if (other.id === object.id || !other.visible) continue
      for (const part of worldCollision(other).parts) {
        for (const [ia,ib,ic] of part.faces) {
          const a = new THREE.Vector3(...part.vertices_m[ia]), b = new THREE.Vector3(...part.vertices_m[ib]), c = new THREE.Vector3(...part.vertices_m[ic])
          const normal = b.clone().sub(a).cross(c.clone().sub(a)).normalize()
          if (normal.y < .999999 || Math.abs(contact[1]-a.y)>FLOATING_TOLERANCE) continue
          const point = new THREE.Vector3(contact[0], a.y, contact[2])
          // Triangle barycentric containment includes touching edges.
          const bary = new THREE.Triangle(a,b,c).getBarycoord(point,new THREE.Vector3())
          if (bary && Math.min(bary.x,bary.y,bary.z)>=-1e-6) return true
        }
      }
    }
    return false
  })
  if (!supported) issues.push({type:'floating', message:'支撑不足：底部接触区域未完整落在支撑面上（容差 1mm）'})

  return issues
}

/** 校验整个场景，返回 物品 id → 问题列表 */
export function validateScene(
  objects: SceneObject[],
  room: RoomConfig,
  metrics?: DeskSurfaceMetrics | null,
): Map<string, SceneIssue[]> {
  const map = new Map<string, SceneIssue[]>()
  const visible = objects.filter((o) => o.visible)
  for (const object of visible) {
    const issues = placementIssues(object, object.transform.position, visible, room, metrics)
    if (issues.length > 0) map.set(object.id, issues)
  }
  return map
}
