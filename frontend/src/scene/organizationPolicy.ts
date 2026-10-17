import type { SceneObject } from '@/types/project'
import type { OrganizationPreferences } from '@/types/organization'
import { localCollision, worldCollision } from './collisionGeometry'
import type { OrganizationZones, RectOnPlane, ZoneRect } from './organizationZones'

export function subtractRect(rect: ZoneRect, cut: ZoneRect, spanning = false): ZoneRect[] {
  const x0 = Math.max(rect.x0, cut.x0), x1 = Math.min(rect.x1, cut.x1)
  const z0 = Math.max(rect.z0, cut.z0), z1 = Math.min(rect.z1, cut.z1)
  if (x0 >= x1 || z0 >= z1) return [rect]
  return [
    { ...rect, x1: x0 }, { ...rect, x0: x1 },
    { x0: spanning ? rect.x0 : x0, x1: spanning ? rect.x1 : x1, z0: rect.z0, z1: z0 },
    { x0: spanning ? rect.x0 : x0, x1: spanning ? rect.x1 : x1, z0: z1, z1: rect.z1 },
  ].filter((r) => r.x1 - r.x0 > 0.001 && r.z1 - r.z0 > 0.001)
}

/** A forward-facing screen aligned with the typing area's centre, behind the keys. */
export function monitorViewRegion(object: SceneObject, zones: OrganizationZones): RectOnPlane | null {
  const { min, max } = localCollision(object).bounds
  const back = zones.workstation?.monitor.rect ?? zones.deskBackBand.rect
  const centre = zones.workstation?.slotCenterX ?? (zones.typing.rect.x0 + zones.typing.rect.x1) / 2
  const tolerance = 0.0001
  const z = back.z1 - max[2] - tolerance
  const rect = {
    x0: centre + min[0] - tolerance, x1: centre + max[0] + tolerance,
    z0: z + min[2] - tolerance, z1: back.z1,
  }
  if (rect.x0 < back.x0 - .001 || rect.x1 > back.x1 + .001 || rect.z0 < back.z0) return null
  if (zones.workstation) return { rect, y: zones.deskBackBand.y }
  const cup = zones.cup.rect
  if (rect.x0 < cup.x1 && rect.x1 > cup.x0 && rect.z0 < cup.z1 && rect.z1 > cup.z0) return null
  return { rect, y: zones.deskBackBand.y }
}

/** Keep the paper-access position beside both the working lane and screen columns. */
export function printerSideRegions(zones: OrganizationZones, monitors: SceneObject[], useCurrentPoses = false): RectOnPlane[] {
  if (zones.workstation) return [{ rect: { x0: -.43, x1: -.045, z0: .305, z1: .61 }, y: zones.deskSurface.y }]
  const columns = monitors.flatMap((monitor) => {
    const view = monitorViewRegion(monitor, zones)
    const columns: Array<{ x0: number; x1: number }> = view ? [view.rect] : []
    // Backend target regions must stay stable when movable objects are applied.
    if (useCurrentPoses || monitor.fixed || monitor.locked) {
      const bounds = worldCollision(monitor).bounds
      columns.push({ x0: bounds.min[0], x1: bounds.max[0] })
    }
    return columns
  })
  const left = Math.min(zones.typing.rect.x0, ...columns.map((r) => r.x0)) - 0.02
  const right = Math.max(zones.typing.rect.x1, ...columns.map((r) => r.x1)) + 0.02
  return (zones.deskSurfaces ?? [zones.deskSurface]).flatMap(({ rect: desk }) => [
    { ...desk, x1: Math.min(desk.x1, left) },
    { ...desk, x0: Math.max(desk.x0, right) },
  ]).filter((r) => r.x1 - r.x0 > 0.001)
    .flatMap((r) => subtractRect(r, zones.cup.rect, !!zones.deskSurfaces))
    .map((rect) => ({ rect, y: zones.deskSurface.y }))
}

/** Only explicitly registered daily-item prefabs enter the return zone. */
export function isDailyMiscellaneous(object: SceneObject): boolean {
  return ['cup', 'stainless_bottle', 'tissue_box'].includes(object.model.prefabId ?? '')
}

export function isStudyItem(object: SceneObject): boolean {
  return ['books_stack', 'bookpile', 'pencil_case'].includes(object.model.prefabId ?? '')
    || object.model.shape === 'book' || object.model.shape === 'books'
}

/** Physical floor support does not make the floor a suitable organization target. */
export function allowsFloorPlacement(object: SceneObject, preferences: OrganizationPreferences): boolean {
  const shape = object.model.shape
  if (shape === 'computerTower') return true
  if (object.frequent || preferences.preferredStorageZone !== 'underDesk' || object.powerStrip) return false
  if (shape === 'storageBox') return true
  if (shape && shape !== 'genericBox') return false
  return object.category === 'storage'
}
