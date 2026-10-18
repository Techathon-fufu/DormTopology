import { desktopPlacementIssue } from './desktopBindings'
import type { OrganizationIssue } from '@/types/organization'
import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import { objectRoomHits } from './collisionGeometry'
import { effectiveCableHoles, hasFixedFurniture, validFurnitureHole } from './fixedFurniture'
import { itemSpacingViolations } from './itemSpacing'
import { DESK_GAP } from './sceneValidation'
import { computeOrganizationZones } from './organizationZones'
import { DEFAULT_ORGANIZATION_PREFERENCES } from '@/types/organization'
import { isDailyMiscellaneous, isStudyItem } from './organizationPolicy'

export const DEFAULT_MIN_ITEM_GAP_M = .02
export interface OrganizationReservedZone { id: string; label: string; min: Vec3; max: Vec3 }

/** Product coordinates: hole lead-outs plus hands and seated operation volumes. */
export function organizationReservedZones(room: RoomConfig): OrganizationReservedZone[] {
  const holes = effectiveCableHoles(room).map((hole) => {
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
      min: [hole.position[0] - half, room.desk.height, hole.position[2] - half] as Vec3,
      max: [hole.position[0] + half, room.desk.height + .05, hole.position[2] + half] as Vec3 }
  })
  const workstation = computeOrganizationZones(room, DEFAULT_ORGANIZATION_PREFERENCES).workstation
  if (!workstation) return holes
  const hands = workstation.operation.rect, seated = workstation.seated.rect
  return [...holes,
    { id: 'packing:operation', label: '手部操作留空区', min: [hands.x0, room.desk.height, hands.z0], max: [hands.x1, room.desk.height + .65, hands.z1] },
    { id: 'packing:seated', label: '座位活动留空区', min: [seated.x0, 0, seated.z0], max: [seated.x1, 1.4, seated.z1] },
  ]
}

export function organizationClearanceIssues(objects: SceneObject[], room: RoomConfig, minimumGap = DEFAULT_MIN_ITEM_GAP_M,
  reservedZones = organizationReservedZones(room)): OrganizationIssue[] {
  const issues: OrganizationIssue[] = []
  for (const object of objects) {
    const message = desktopPlacementIssue(object, room, objects)
    if (message) issues.push({ entity_id: object.id, code: 'target_region', message })
  }
  for (const object of objects) for (const hit of objectRoomHits(object, object.transform.position, reservedZones)) {
    issues.push({ entity_id: object.id, code: 'reserved_zone', message: `${object.name}占用了${hit.label}（${hit.id}）` })
  }
  const workstation = computeOrganizationZones(room, DEFAULT_ORGANIZATION_PREFERENCES).workstation
  if (workstation) {
    const exclusive = [
      { area: workstation.miscellaneous, height: .65, accepts: isDailyMiscellaneous, label: '预制常用杂物区' },
      { area: workstation.study, height: workstation.study.clearance, accepts: isStudyItem, label: '第二格学习用品区' },
    ]
    for (const { area, height, accepts, label } of exclusive) {
      const { x0, x1, z0, z1 } = area.rect
      const zone = { id: label, label, min: [x0, area.y, z0] as Vec3, max: [x1, area.y + height, z1] as Vec3 }
      for (const object of objects) if (!accepts(object) && objectRoomHits(object, object.transform.position, [zone]).length) {
        issues.push({ entity_id: object.id, code: 'target_region', message: `${object.name}不属于${label}，请移出该专用区；固定物品需先解除固定` })
      }
    }
  }
  for (const { left, right, distance } of itemSpacingViolations(objects, minimumGap)) {
    issues.push({ entity_id: left.id, code: 'item_spacing', message: `${left.name}与${right.name}的水平间距为 ${(distance * 1000).toFixed(1)} mm，小于要求的 ${(minimumGap * 1000).toFixed(1)} mm` })
  }
  return issues
}
