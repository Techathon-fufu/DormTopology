import * as THREE from 'three'
import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import type { DeskSurfaceMetrics } from '@/scene/deskModel'

/**
 * 场景摆放校验与支撑面计算（本地真实计算，非模拟）。
 *
 * - 支撑面：桌面 / 书架搁板 / 地面（用于拖拽吸附与「吸附到支撑面」）；
 *   高度优先采用桌体 GLB 实测锚点（DeskSurfaceMetrics），未加载模型 / 无锚点时回退 RoomConfig
 * - 校验：越界（房间外 / 地面下 / 超层高）、明显相交（物品间）、悬空（无支撑）
 * - 相交检测使用旋转矩形 SAT（x-z 平面）+ 高度区间重叠，旋转角不同也能正确判断
 */

export type SupportKind = 'desk' | 'shelf' | 'floor' | 'none'

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
/** 判定为「贴合支撑面」的高度容差（米） */
const FLOATING_TOLERANCE = 0.035
/** 判定为「相交」的最小重叠深度（米） */
const OVERLAP_TOLERANCE = 0.01
/** 越界判定容差（米） */
const BOUNDS_EPSILON = 0.001

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
  type: 'outOfBounds' | 'overlap' | 'floating'
  message: string
  relatedId?: string
}

/** 旋转矩形（x-z）SAT 相交检测；旋转角以 rotationY 弧度给出 */
function obbOverlapXZ(
  ax: number,
  az: number,
  aw: number,
  ad: number,
  aRot: number,
  bx: number,
  bz: number,
  bw: number,
  bd: number,
  bRot: number,
): boolean {
  const axes: Array<[number, number]> = [
    [Math.cos(aRot), -Math.sin(aRot)],
    [Math.sin(aRot), Math.cos(aRot)],
    [Math.cos(bRot), -Math.sin(bRot)],
    [Math.sin(bRot), Math.cos(bRot)],
  ]
  const axesA: Array<[number, number]> = [
    [Math.cos(aRot), -Math.sin(aRot)],
    [Math.sin(aRot), Math.cos(aRot)],
  ]
  const axesB: Array<[number, number]> = [
    [Math.cos(bRot), -Math.sin(bRot)],
    [Math.sin(bRot), Math.cos(bRot)],
  ]
  const dx = bx - ax
  const dz = bz - az
  for (const [ux, uz] of axes) {
    const dist = Math.abs(dx * ux + dz * uz)
    let ra = 0
    for (let i = 0; i < 2; i += 1) {
      ra += (i === 0 ? aw : ad) / 2 * Math.abs(ux * axesA[i][0] + uz * axesA[i][1])
    }
    let rb = 0
    for (let i = 0; i < 2; i += 1) {
      rb += (i === 0 ? bw : bd) / 2 * Math.abs(ux * axesB[i][0] + uz * axesB[i][1])
    }
    if (dist >= ra + rb) return false // 找到分离轴
  }
  return true
}

/** 容器类物品：收纳进其内部的小件不计为「相交」 */
export function isContainerLike(o: SceneObject): boolean {
  return o.category === 'storage' || o.model.shape === 'storageBox'
}

/**
 * inner 是否被「收纳进」outer 内部（如小件物品放入收纳盒）：
 * 仅当 outer 是收纳容器类物品时成立；底面不低过 outer 底面、顶面不超出 outer 顶面（+2cm 容差）、
 * 俯视投影落在 outer 截面内（+2cm 容差）。收纳关系不计为「相交」。
 */
export function isContainedWithin(
  inner: SceneObject,
  innerPos: Vec3,
  outer: SceneObject,
  outerPos: Vec3,
): boolean {
  if (!isContainerLike(outer)) return false
  const tolerance = 0.02
  if (Math.abs(innerPos[0] - outerPos[0]) + inner.dimensions.width / 2 >
    outer.dimensions.width / 2 + tolerance) {
    return false
  }
  if (Math.abs(innerPos[2] - outerPos[2]) + inner.dimensions.depth / 2 >
    outer.dimensions.depth / 2 + tolerance) {
    return false
  }
  if (innerPos[1] < outerPos[1] - 0.001) return false
  if (innerPos[1] + inner.dimensions.height > outerPos[1] + outer.dimensions.height + tolerance) {
    return false
  }
  return true
}

/**
 * 两物品在各自位置是否「明显相交」（SAT + 高度区间重叠）。
 * 一件物品收纳进另一件容器内部（isContainedWithin）不算相交。
 */
export function objectsOverlapAt(
  a: SceneObject,
  aPos: Vec3,
  b: SceneObject,
  bPos: Vec3,
): boolean {
  const yOverlap =
    Math.min(aPos[1] + a.dimensions.height, bPos[1] + b.dimensions.height) -
    Math.max(aPos[1], bPos[1])
  if (yOverlap <= OVERLAP_TOLERANCE) return false
  if (isContainedWithin(a, aPos, b, bPos) || isContainedWithin(b, bPos, a, aPos)) return false
  return obbOverlapXZ(
    aPos[0],
    aPos[2],
    a.dimensions.width,
    a.dimensions.depth,
    a.transform.rotationY,
    bPos[0],
    bPos[2],
    b.dimensions.width,
    b.dimensions.depth,
    b.transform.rotationY,
  )
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
  const [x, y, z] = position
  const { width: w, height: h, depth: d } = object.dimensions

  // 1) 越界
  const outParts: string[] = []
  if (x - w / 2 < -room.length / 2 + BOUNDS_EPSILON || x + w / 2 > room.length / 2 - BOUNDS_EPSILON) {
    outParts.push('左右超出房间')
  }
  if (z - d / 2 < -BOUNDS_EPSILON || z + d / 2 > room.width - BOUNDS_EPSILON) {
    outParts.push('前后超出房间')
  }
  if (y < -BOUNDS_EPSILON) outParts.push('低于地面')
  if (y + h > room.height - BOUNDS_EPSILON) outParts.push('超过层高')
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

  // 3) 悬空（下方无支撑面 / 与支撑面距离过远）
  let supportY: number | null = null
  for (const support of supportsContaining(room, x, z, metrics)) {
    if (support.y <= y + FLOATING_TOLERANCE) {
      supportY = supportY === null ? support.y : Math.max(supportY, support.y)
    }
  }
  for (const other of others) {
    if (other.id === object.id || !other.visible) continue
    const top = other.transform.position[1] + other.dimensions.height
    if (top > y + FLOATING_TOLERANCE) continue
    const overlap = obbOverlapXZ(
      x,
      z,
      w,
      d,
      object.transform.rotationY,
      other.transform.position[0],
      other.transform.position[2],
      other.dimensions.width,
      other.dimensions.depth,
      other.transform.rotationY,
    )
    if (overlap) supportY = supportY === null ? top : Math.max(supportY, top)
  }
  if (supportY === null) {
    if (y > FLOATING_TOLERANCE) issues.push({ type: 'floating', message: '悬空：下方无支撑面' })
  } else if (y - supportY > FLOATING_TOLERANCE) {
    issues.push({
      type: 'floating',
      message: `悬空：距下方支撑面 ${Math.round((y - supportY) * 1000)} mm（可用「吸附到支撑面」）`,
    })
  }

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
