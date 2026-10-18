import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import { worldCollision } from './collisionGeometry'
import { DESKTOP_REGIONS } from './desktopBindings'
import { baffleTopExclusion, hasFixedFurniture } from './fixedFurniture'

export interface SpatialCostPolicy {
  desktop_min: Vec3
  desktop_max: Vec3
  corner_start: Vec3
  corner_end: Vec3
  seat_position: Vec3
  distance_scale_m: number
  corner_weight: number
  seat_weight: number
}

/** Shared by planning input and manual/final route validation. No endpoint exemption. */
export function routingExclusions(room: RoomConfig, objects: SceneObject[]) {
  if (!hasFixedFurniture(room)) return []
  const mouse = DESKTOP_REGIONS.mouse
  return [baffleTopExclusion(room), {
    name: 'routing:no-mouse-area', min: [mouse.x0, room.desk.height, mouse.z0] as Vec3,
    max: [mouse.x1, room.height, mouse.z1] as Vec3,
  }, ...objects.filter(o => o.model.shape === 'laptop' || o.model.prefabId === 'laptop_extend').map(o => {
    const b = worldCollision(o).bounds
    // Conservative world footprint follows edits/rotation. Side sockets sit at
    // 5 mm above the base; the overhead volume begins at 12 mm, above the deck.
    return { name: `routing:no-laptop-overhead:${o.id}`,
      min: [b.min[0], b.min[1] + .012, b.min[2]] as Vec3,
      max: [b.max[0], Math.max(room.height, b.max[1] + .1), b.max[2]] as Vec3 }
  })]
}
