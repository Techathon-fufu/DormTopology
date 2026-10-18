import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import { worldCollision } from './collisionGeometry'
import type { DrawerSlotId } from './dormDeskDrawers'
import asset from './furnitureAsset.generated.json'
import { drawerIdForPart, drawerIdForSurface, type DrawerOffsets } from './dormDeskDrawers'

export const FURNITURE_OFFSET: Vec3 = [-1, -0.02, 0.9]
export const FIXED_MODEL_URLS = ['dormdesk_body', 'drawer_bottom', 'drawer_middle', 'drawer_top'].map((name) => `models/dormdesk_parts/${name}.glb`)

export interface FurnitureBox { name: string; min: Vec3; max: Vec3 }
export interface FurnitureSurface {
  id: string
  kind: 'desk' | 'shelf' | 'drawer'
  label: string
  rect: { x0: number; x1: number; z0: number; z1: number }
  y: number
  clearance: number
}

const drawerSurfaceIds: Record<DrawerSlotId, string> = {
  bot: 'support-drawer-bottom', mid: 'support-drawer-middle', top: 'support-drawer-top',
}

export function drawerSlotForSurface(id: string): DrawerSlotId | null {
  return (Object.keys(drawerSurfaceIds) as DrawerSlotId[]).find((slot) => drawerSurfaceIds[slot] === id) ?? null
}

/** A stored item belongs to a drawer only if its full volume fits the closed interior. */
export function drawerSlotForObject(object: SceneObject, position: Vec3, room: RoomConfig, rotationY = object.transform.rotationY): DrawerSlotId | null {
  if (!hasFixedFurniture(room)) return null
  const bounds = worldCollision({ ...object, transform: { position, rotationY } }).bounds
  const tolerance = .001
  for (const surface of furnitureSurfaces(room).filter((entry) => entry.kind === 'drawer')) {
    if (Math.abs(bounds.min[1] - surface.y) > tolerance || bounds.max[1] > surface.y + surface.clearance + tolerance) continue
    if (bounds.min[0] < surface.rect.x0 - tolerance || bounds.max[0] > surface.rect.x1 + tolerance ||
        bounds.min[2] < surface.rect.z0 - tolerance || bounds.max[2] > surface.rect.z1 + tolerance) continue
    return drawerSlotForSurface(surface.id)
  }
  return null
}

/** The moving drawer fronts and contents must have a clear path outside the cabinet. */
export function blockingDrawerOpening(object: SceneObject, position: Vec3, room: RoomConfig): string | null {
  if (!hasFixedFurniture(room) || drawerSlotForObject(object, position, room)) return null
  const bounds = worldCollision(object, position).bounds
  for (const surface of furnitureSurfaces(room).filter((entry) => entry.kind === 'drawer')) {
    const { x0, z0, z1 } = surface.rect
    if (bounds.min[0] < x0 - .002 && bounds.max[0] > x0 - .3 + .002 &&
        bounds.min[2] < z1 + .012 && bounds.max[2] > z0 - .012 &&
        bounds.min[1] < surface.y + surface.clearance && bounds.max[1] > surface.y - .035) {
      return surface.label
    }
  }
  return null
}

export function hasFixedFurniture(room: RoomConfig): boolean { return room.furnitureModel === 'dormdesk-v1' }
const translate = (v: number[]): Vec3 => v.map((n, i) => +(n + FURNITURE_OFFSET[i]).toFixed(6)) as Vec3
export const fixedFurnitureBoxes: FurnitureBox[] = asset.parts.flatMap((p) => p.name === 'Desk_Top_Main'
  ? [...asset.desktopSolids].sort((a, b) => Number(b.name === 'Desk_Top_Main') - Number(a.name === 'Desk_Top_Main')) : [p])
  .map((p) => ({ name: p.name, min: translate(p.min), max: translate(p.max) }))
/** Authored rear-edge notch, measured from the GLB vertex grid (not a user-created hole). */
export const rearCablePassage = { min: translate(asset.rearPassages[0].min), max: translate(asset.rearPassages[0].max) }

/** Routing policy only: never route over or along the top of the rear baffle. */
export function baffleTopExclusion(room: RoomConfig): FurnitureBox {
  const baffle = fixedFurnitureBoxes.find(p => p.name === 'Desk_Back_Baffle')!
  return { name: 'routing:no-baffle-top', min: [baffle.min[0], baffle.max[1], baffle.min[2] - .04],
    max: [baffle.max[0], Math.max(room.height, baffle.max[1] + .1), baffle.max[2] + .015] }
}

/** Geometry comes only from the prefab asset; saved hole settings cannot cut it. */
export function furnitureBoxes(_room: RoomConfig, offsets: DrawerOffsets = {}): FurnitureBox[] {
  return fixedFurnitureBoxes.map((original) => {
    const id = drawerIdForPart(original.name)
    const dx = id ? offsets[id] ?? 0 : 0
    return dx ? { ...original, min: [original.min[0] + dx, original.min[1], original.min[2]] as Vec3,
      max: [original.max[0] + dx, original.max[1], original.max[2]] as Vec3 } : original
  })
}

/** Circular user holes are retired; the authored rear notch is rearCablePassage. The solid prefab has no user-defined tabletop apertures. */
export function effectiveCableHoles(room: RoomConfig): RoomConfig['cableHoles'] {
  return hasFixedFurniture(room) ? [] : room.cableHoles
}

function surface(id: string, kind: FurnitureSurface['kind'], label: string, bounds: [number, number, number, number], y: number, ceiling: number): FurnitureSurface {
  const [x0, x1, z0, z1] = bounds
  return { id, kind, label, rect: { x0, x1, z0, z1 }, y, clearance: +(ceiling - y).toFixed(6) }
}

/** Actual free interiors, excluding the divider boards and drawer shells. */
export function furnitureSurfaces(_room: RoomConfig, _legacyCutHoles = true, offsets: DrawerOffsets = {}): FurnitureSurface[] {
  // Retain the second argument for existing callers; prefab surfaces are always solid and follow the authored regions.
  const desks = fixedFurnitureBoxes.filter((p) => p.name.startsWith('Desk_Top_'))
    .map((p) => surface(`support-${p.name}`, 'desk', p.name.includes('Main') ? '主桌面' : '右侧回台',
      [p.min[0], p.max[0], p.min[2], p.name.startsWith('Desk_Top_Main_Rear_')
        ? fixedFurnitureBoxes.find(b => b.name === 'Desk_Top_Main')!.max[2] : p.max[2]], p.max[1], 1.88))
  const shelves = [
    surface('support-shelf-1-low', 'shelf', '书架左格下层', [-.43, -.11, .04, .29], 1.46, 1.652),
    surface('support-shelf-1-high', 'shelf', '书架左格上层', [-.43, -.11, .04, .29], 1.668, 1.86),
    surface('support-shelf-2', 'shelf', '书架第二格', [-.091, .231, .04, .29], 1.46, 1.86),
    surface('support-shelf-3', 'shelf', '书架第三格', [.249, .581, .04, .29], 1.46, 1.86),
    surface('support-shelf-4', 'shelf', '书架右格', [.599, .92, .04, .29], 1.46, 1.86),
  ]
  const drawers = [
    surface('support-drawer-bottom', 'drawer', '下层抽屉', [.64, .92, .524, .817], .084, .2975),
    surface('support-drawer-middle', 'drawer', '中层抽屉', [.64, .92, .524, .817], .334, .515),
    surface('support-drawer-top', 'drawer', '上层抽屉', [.64, .92, .524, .817], .549, .705),
  ]
  const cabinet = [
    surface('support-cabinet-lower', 'shelf', '柜内下层', [.635, .95, .14, .48], .058, .371),
    surface('support-cabinet-upper', 'shelf', '柜内上层', [.635, .95, .14, .48], .389, .707),
  ]
  return [...desks, ...shelves, ...drawers, ...cabinet].map((s) => {
    const id = drawerIdForSurface(s.id), dx = id ? offsets[id] ?? 0 : 0
    return dx ? { ...s, rect: { ...s.rect, x0: s.rect.x0 + dx, x1: s.rect.x1 + dx } } : s
  })
}

/** No user-defined circular hole is valid on the fixed prefab; the authored rear notch is rearCablePassage. */
export function validFurnitureHole(_room: RoomConfig, _position: Vec3, _diameter: number): boolean {
  return false
}
