import type { RoomConfig, Vec3 } from '@/types/project'
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

export function hasFixedFurniture(room: RoomConfig): boolean { return room.furnitureModel === 'dormdesk-v1' }
const translate = (v: number[]): Vec3 => v.map((n, i) => +(n + FURNITURE_OFFSET[i]).toFixed(6)) as Vec3
export const fixedFurnitureBoxes: FurnitureBox[] = asset.parts.map((p) => ({ name: p.name, min: translate(p.min), max: translate(p.max) }))

/** Geometry comes only from the prefab asset; saved hole settings cannot cut it. */
export function furnitureBoxes(_room: RoomConfig, offsets: DrawerOffsets = {}): FurnitureBox[] {
  return fixedFurnitureBoxes.map((original) => {
    const id = drawerIdForPart(original.name)
    const dx = id ? offsets[id] ?? 0 : 0
    return dx ? { ...original, min: [original.min[0] + dx, original.min[1], original.min[2]] as Vec3,
      max: [original.max[0] + dx, original.max[1], original.max[2]] as Vec3 } : original
  })
}

/** dormdesk-v1 has no modeled tabletop apertures. Legacy parametric rooms retain their own holes. */
export function effectiveCableHoles(room: RoomConfig): RoomConfig['cableHoles'] {
  return hasFixedFurniture(room) ? [] : room.cableHoles
}

function surface(id: string, kind: FurnitureSurface['kind'], label: string, bounds: [number, number, number, number], y: number, ceiling: number): FurnitureSurface {
  const [x0, x1, z0, z1] = bounds
  return { id, kind, label, rect: { x0, x1, z0, z1 }, y, clearance: +(ceiling - y).toFixed(6) }
}

/** Actual free interiors, excluding the divider boards and drawer shells. */
export function furnitureSurfaces(_room: RoomConfig, _legacyCutHoles = true, offsets: DrawerOffsets = {}): FurnitureSurface[] {
  // Retain the second argument for existing callers; prefab surfaces are always solid.
  const desks = fixedFurnitureBoxes.filter((p) => p.name.startsWith('Desk_Top_'))
    .map((p) => surface(`support-${p.name}`, 'desk', p.name.includes('Main') ? '主桌面' : '右侧回台', [p.min[0], p.max[0], p.min[2], p.max[2]], p.max[1], 1.88))
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

/** No hole is valid until it is declared by the prefab geometry itself. */
export function validFurnitureHole(_room: RoomConfig, _position: Vec3, _diameter: number): boolean {
  return false
}
