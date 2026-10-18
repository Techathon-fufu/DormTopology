import type { Project, RoomConfig, Vec3 } from '@/types/project'
import type { RoutingSupport, TrayCandidate } from '@/algorithm-lab/contract'
import type { CableManagementConfig, CableManagementPreset, CableMount, CableMountVolume } from '@/types/cableManagement'
import { roomSolids, type RoomSolid } from './roomCollision'

export function resolveCableManagement(room: RoomConfig): CableManagementConfig {
  return room.cableManagement ?? { mounts: [], verifySupport: false, maxUnsupportedSpanM: .3 }
}

export function currentCableTrayAnalysis(project: Project): Project['cableTrayAnalysis'] {
  const analysis = project.cableTrayAnalysis
  return analysis && project.cables.length > 0 && project.cables.every((cable) => {
    const verification = cable.route.verification
    return cable.status !== 'stale' && verification?.sceneId === analysis.sceneId && verification?.sceneRevision === analysis.sceneRevision
  }) ? analysis : undefined
}

function mountSolid(room: RoomConfig, mount: CableMount): RoomSolid | undefined {
  return roomSolids(room).find((solid) => `furniture:${solid.id}` === mount.obstacleId)
}

function faceAxes(mount: CableMount): { axis: number; tangents: number[] } {
  const axis = 'xyz'.indexOf(mount.face[0])
  return { axis, tangents: [0, 1, 2].filter((value) => value !== axis) }
}

export function cableMountVolume(room: RoomConfig, mount: CableMount): CableMountVolume | null {
  const solid = mountSolid(room, mount)
  if (!solid) return null
  const { axis, tangents } = faceAxes(mount)
  if (axis < 0 || !mount.boundsUvM.every(Number.isFinite) || !Number.isFinite(mount.standOffM) || mount.standOffM <= 0) return null
  const maximum = mount.kind === 'surface' ? .02 : mount.kind === 'cable_tie' ? .05 : .1
  if (mount.standOffM > maximum || (mount.kind === 'surface' && mount.face !== 'y_max') || (mount.kind === 'cable_tray' && mount.face !== 'y_min')) return null
  const min: Vec3 = [0, 0, 0], max: Vec3 = [0, 0, 0]
  for (const [index, tangent] of tangents.entries()) {
    const lower = mount.boundsUvM[index * 2], upper = mount.boundsUvM[index * 2 + 1]
    if (lower < solid.min[tangent] - 1e-8 || upper > solid.max[tangent] + 1e-8 || lower >= upper || (mount.kind === 'cable_tie' && upper - lower > .05 + 1e-8)) return null
    min[tangent] = lower; max[tangent] = upper
  }
  const negative = mount.face.endsWith('min')
  const plane = negative ? solid.min[axis] : solid.max[axis]
  min[axis] = negative ? plane - mount.standOffM : plane
  max[axis] = negative ? plane : plane + mount.standOffM
  return { min, max }
}

export function validCableMounts(room: RoomConfig): CableMount[] {
  return resolveCableManagement(room).mounts.filter((mount) => cableMountVolume(room, mount) !== null)
}

function volumeClear(room: RoomConfig, mount: CableMount): boolean {
  const volume = cableMountVolume(room, mount)
  return !!volume && !roomSolids(room).some((solid) => `furniture:${solid.id}` !== mount.obstacleId
    && volume.min.every((lower, axis) => lower < solid.max[axis] - 1e-6 && volume.max[axis] > solid.min[axis] + 1e-6))
}

/** Presets are suggestions on existing slabs, never automatically installed. */
export function createCableManagementPreset(room: RoomConfig, preset: CableManagementPreset): CableMount[] {
  const desktops = roomSolids(room).filter((solid) => solid.kind === 'deskTop')
    .sort((a, b) => (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) - (a.max[0] - a.min[0]) * (a.max[2] - a.min[2]))
  const result: CableMount[] = []
  for (const solid of desktops) {
    const width = solid.max[0] - solid.min[0], depth = solid.max[2] - solid.min[2]
    if (width < .12 || depth < .1) continue
    const common = { obstacleId: `furniture:${solid.id}`, installed: false, preset }
    if (preset === 'underside-tray') {
      const length = Math.min(.6, width - .08), center = (solid.min[0] + solid.max[0]) / 2
      for (const inset of [.06, .12, .18, .24]) {
        const z = solid.min[2] + Math.min(inset, depth / 3)
        const mount: CableMount = { ...common, id: `cable-mount:${preset}:${solid.id}`, label: '桌下集线槽', kind: 'cable_tray', face: 'y_min',
          boundsUvM: [center - length / 2, center + length / 2, z, Math.min(z + .08, solid.max[2] - .02)], standOffM: .07 }
        if (volumeClear(room, mount)) return [mount]
      }
    } else {
      const clip = preset === 'rear-clips'
      const positions = width >= .45 ? [.18, .5, .82] : [.5]
      const z = solid.min[2] + (clip ? .025 : Math.min(.09, depth / 3))
      positions.forEach((fraction, index) => {
        const x = solid.min[0] + width * fraction
        const mount: CableMount = { ...common, id: `cable-mount:${preset}:${solid.id}:${index}`,
          label: `${clip ? '桌后理线扣' : '桌下扎带'} ${index + 1}`, kind: 'cable_tie', face: clip ? 'y_max' : 'y_min',
          boundsUvM: [x - .014, x + .014, z, z + .028], standOffM: clip ? .028 : .04 }
        if (volumeClear(room, mount)) result.push(mount)
      })
      if (result.length) return result
    }
  }
  return result
}

/** Reuse the domain contract; caller supplies the shared world-to-scene translation. */
export function mountToRoutingSupport(mount: CableMount, toPosition: (point: Vec3) => Vec3): RoutingSupport {
  const { tangents } = faceAxes(mount)
  const lower: Vec3 = [0, 0, 0], upper: Vec3 = [0, 0, 0]
  tangents.forEach((axis, index) => { lower[axis] = mount.boundsUvM[index * 2]; upper[axis] = mount.boundsUvM[index * 2 + 1] })
  const a = toPosition(lower), b = toPosition(upper)
  return { id: mount.id, kind: mount.kind, obstacle_id: mount.obstacleId, face: mount.face,
    bounds_uv_m: [a[tangents[0]], b[tangents[0]], a[tangents[1]], b[tangents[1]]], stand_off_m: mount.standOffM }
}

export function mountToTrayCandidate(mount: CableMount, cableIds: string[], toPosition: (point: Vec3) => Vec3): TrayCandidate | null {
  const members = [...new Set(cableIds)]
  if (mount.installed || mount.kind !== 'cable_tray' || mount.face !== 'y_min' || members.length < 2) return null
  return { ...mountToRoutingSupport(mount, toPosition), kind: 'cable_tray', face: 'y_min', cable_ids: members }
}
