import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import { furnitureSurfaces, hasFixedFurniture } from './fixedFurniture'
import { drawerIdForSurface, type DrawerOffsets, type DrawerSlotId } from './dormDeskDrawers'

/** Saved positions always refer to the closed furniture. The support determines ownership. */
export function objectDrawerId(object: SceneObject, room: RoomConfig): DrawerSlotId | undefined {
  if (!hasFixedFurniture(room)) return undefined
  const [x, y, z] = object.transform.position
  const surface = furnitureSurfaces(room, false).find((s) => s.kind === 'drawer'
    && Math.abs(y - s.y) <= .001 && x >= s.rect.x0 - .001 && x <= s.rect.x1 + .001
    && z >= s.rect.z0 - .001 && z <= s.rect.z1 + .001)
  return surface ? drawerIdForSurface(surface.id) : undefined
}

export function drawerDisplayPosition(object: SceneObject, room: RoomConfig, offsets: DrawerOffsets): Vec3 {
  const id = objectDrawerId(object, room), dx = id ? offsets[id] ?? 0 : 0
  const [x, y, z] = object.transform.position
  return [x + dx, y, z]
}

export function drawerDisplayObjects(objects: SceneObject[], room: RoomConfig, offsets: DrawerOffsets): SceneObject[] {
  return objects.map((object) => ({ ...object, transform: { ...object.transform,
    position: drawerDisplayPosition(object, room, offsets) } }))
}

/** Stored objects use their cavity coordinates instead of a desktop binding. */
export function isFurnitureStoragePosition(object: SceneObject, room: RoomConfig): boolean {
  if (!hasFixedFurniture(room)) return false
  const [x, y, z] = object.transform.position
  return furnitureSurfaces(room, false).some(s => (s.kind === 'drawer' || s.id.startsWith('support-cabinet'))
    && Math.abs(y - s.y) <= .001 && x >= s.rect.x0 - .001 && x <= s.rect.x1 + .001
    && z >= s.rect.z0 - .001 && z <= s.rect.z1 + .001)
}
