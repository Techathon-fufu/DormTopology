import type { ObjectDimensions, RoomConfig, SceneObject, Vec3 } from '@/types/project'
import { worldCollision } from './collisionGeometry'
import { furnitureSurfaces, hasFixedFurniture } from './fixedFurniture'
import { placementIssues, type SupportHit } from './sceneValidation'

export const ROTATION_STEP = Math.PI / 18
const SNAP_DISTANCE = .025

/** Prefab screens face local +Z; turn the initial pose toward the seated user. */
export function laptopViewingAngle(position: Vec3, room: RoomConfig): number {
  const chairX = hasFixedFurniture(room) ? .145 : 0
  const chairZ = hasFixedFurniture(room) ? .96 : room.desk.depth + .35
  return Math.max(-Math.PI / 4, Math.min(Math.PI / 4, Math.atan2(chairX - position[0], Math.max(.15, chairZ - position[2]))))
}

/** Snap a footprint to a support's centre or edges without preventing manual overlap. */
export function snapPlacement(object: SceneObject, hit: SupportHit, room: RoomConfig, others: SceneObject[]): Vec3 {
  const bounds = worldCollision({ ...object, transform: { ...object.transform, position: [0, 0, 0] } }).bounds
  const anchors = { x: [] as number[], z: [] as number[] }
  if (hasFixedFurniture(room)) for (const surface of furnitureSurfaces(room, false)) {
    const r = surface.rect
    if (Math.abs(surface.y - hit.y) > .001 || hit.x < r.x0 || hit.x > r.x1 || hit.z < r.z0 || hit.z > r.z1) continue
    anchors.x.push((r.x0 + r.x1) / 2, r.x0 - bounds.min[0], r.x1 - bounds.max[0])
    anchors.z.push((r.z0 + r.z1) / 2, r.z0 - bounds.min[2], r.z1 - bounds.max[2])
  }
  for (const other of others) {
    if (other.id === object.id || !other.visible || Math.abs(other.transform.position[1] - hit.y) > .001) continue
    const b = worldCollision(other).bounds
    anchors.x.push(other.transform.position[0], b.min[0] - bounds.max[0] - .02, b.max[0] - bounds.min[0] + .02)
    anchors.z.push(other.transform.position[2], b.min[2] - bounds.max[2] - .02, b.max[2] - bounds.min[2] + .02)
  }
  const snap = (value: number, targets: number[]) => {
    const nearest = targets.sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0]
    return nearest !== undefined && Math.abs(nearest - value) <= SNAP_DISTANCE ? nearest : Math.round(value * 100) / 100
  }
  return [snap(hit.x, anchors.x), hit.y, snap(hit.z, anchors.z)]
}

export function resizeIssue(object: SceneObject, dimensions: ObjectDimensions, room: RoomConfig, objects: SceneObject[]): string | null {
  if (Object.values(dimensions).some((n) => !Number.isFinite(n) || n <= 0 || n > 5)) return '尺寸必须大于 0 且不超过 5 米'
  const candidate = { ...object, dimensions }
  const issues = placementIssues(candidate, candidate.transform.position, objects, room)
  const conflict = issues.find((issue) => ['overlap', 'roomCollision', 'outOfBounds'].includes(issue.type))
  return conflict ? `尺寸未改变：${conflict.message}` : null
}
