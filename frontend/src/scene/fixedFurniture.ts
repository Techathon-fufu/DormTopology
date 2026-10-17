import type { RoomConfig, Vec3 } from '@/types/project'
import asset from './furnitureAsset.generated.json'

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

/** Cut an inscribed square tunnel: conservative clearance for the configured circular grommet. */
export function furnitureBoxes(room: RoomConfig): FurnitureBox[] {
  return fixedFurnitureBoxes.flatMap((box) => {
    if (!box.name.startsWith('Desk_Top_')) return [box]
    let parts = [box]
    room.cableHoles.forEach((hole) => {
      const [x, , z] = hole.position, half = hole.diameter / (2 * Math.sqrt(2))
      if (!validFurnitureHole(room, hole.position, hole.diameter) || x < box.min[0] || x > box.max[0] || z < box.min[2] || z > box.max[2]) return
      parts = parts.flatMap((p) => {
        const a = Math.max(p.min[0], x - half), b = Math.min(p.max[0], x + half)
        const c = Math.max(p.min[2], z - half), d = Math.min(p.max[2], z + half)
        if (a >= b || c >= d) return [p]
        return [
          { min: p.min, max: [a, p.max[1], p.max[2]] as Vec3 },
          { min: [b, p.min[1], p.min[2]] as Vec3, max: p.max },
          { min: [a, p.min[1], p.min[2]] as Vec3, max: [b, p.max[1], c] as Vec3 },
          { min: [a, p.min[1], d] as Vec3, max: [b, p.max[1], p.max[2]] as Vec3 },
        ].filter((v) => v.max[0] - v.min[0] > 1e-6 && v.max[2] - v.min[2] > 1e-6).map((v, i) => ({ ...v, name: `${p.name}:cut-${i}` }))
      })
    })
    return parts
  })
}

function surface(id: string, kind: FurnitureSurface['kind'], label: string, bounds: [number, number, number, number], y: number, ceiling: number): FurnitureSurface {
  const [x0, x1, z0, z1] = bounds
  return { id, kind, label, rect: { x0, x1, z0, z1 }, y, clearance: +(ceiling - y).toFixed(6) }
}

/** Actual free interiors, excluding the divider boards and drawer shells. */
export function furnitureSurfaces(room: RoomConfig, cutHoles = true): FurnitureSurface[] {
  const desks = (cutHoles ? furnitureBoxes(room) : fixedFurnitureBoxes).filter((p) => p.name.startsWith('Desk_Top_'))
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
  return [...desks, ...shelves, ...drawers]
}

export function validFurnitureHole(room: RoomConfig, position: Vec3, diameter: number): boolean {
  if (!hasFixedFurniture(room)) return false
  if (!position.every(Number.isFinite) || !Number.isFinite(diameter) || diameter <= 0 || Math.abs(position[1] - .75) > .001) return false
  const radius = diameter / 2
  return fixedFurnitureBoxes.some((p) => p.name.startsWith('Desk_Top_') && position[0] - radius >= p.min[0] && position[0] + radius <= p.max[0] && position[2] - radius >= p.min[2] && position[2] + radius <= p.max[2])
}
