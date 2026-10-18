import type { OrganizationIssue } from '@/types/organization'
import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import { objectRoomHits } from './collisionGeometry'
import { hasFixedFurniture, validFurnitureHole } from './fixedFurniture'
import { itemSpacingViolations } from './itemSpacing'
import { DESK_GAP } from './sceneValidation'

export const DEFAULT_MIN_ITEM_GAP_M = .02
export interface OrganizationReservedZone { id: string; label: string; min: Vec3; max: Vec3 }

/** Product coordinates; only physical hole openings, not activity or edge clearances. */
export function organizationReservedZones(room: RoomConfig): OrganizationReservedZone[] {
  return room.cableHoles.map((hole) => {
    const radius = hole.diameter / 2
    const positionValid = Array.isArray(hole.position) && hole.position.length === 3 && hole.position.every(Number.isFinite)
    const valid = positionValid && Number.isFinite(radius) && radius > 0 && Number.isFinite(room.desk.height) && room.desk.height > 0
      && (hasFixedFurniture(room) ? validFurnitureHole(room, hole.position, hole.diameter)
        : Math.abs(hole.position[1] - room.desk.height) <= .001 && hole.position[0] - radius >= -room.desk.width / 2
          && hole.position[0] + radius <= room.desk.width / 2 && hole.position[2] - radius >= DESK_GAP
          && hole.position[2] + radius <= DESK_GAP + room.desk.depth)
    if (!valid) throw new Error('出线孔必须完整位于真实桌面内，位置和正直径须为有限数值')
    const half = radius + .01
    return { id: `packing:hole:${hole.id}`, label: '出线孔上方保留空间',
      min: [hole.position[0] - half, room.desk.height, hole.position[2] - half],
      max: [hole.position[0] + half, room.desk.height + .05, hole.position[2] + half] }
  })
}

export function organizationClearanceIssues(objects: SceneObject[], room: RoomConfig, minimumGap = DEFAULT_MIN_ITEM_GAP_M,
  reservedZones = organizationReservedZones(room)): OrganizationIssue[] {
  const issues: OrganizationIssue[] = []
  for (const object of objects) for (const hit of objectRoomHits(object, object.transform.position, reservedZones)) {
    issues.push({ entity_id: object.id, code: 'reserved_zone', message: `${object.name}占用了${hit.label}（${hit.id}）` })
  }
  for (const { left, right, distance } of itemSpacingViolations(objects, minimumGap)) {
    issues.push({ entity_id: left.id, code: 'item_spacing', message: `${left.name}与${right.name}的水平间距为 ${(distance * 1000).toFixed(1)} mm，小于要求的 ${(minimumGap * 1000).toFixed(1)} mm` })
  }
  return issues
}
