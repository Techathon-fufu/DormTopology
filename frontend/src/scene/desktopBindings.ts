import { isFurnitureStoragePosition } from './drawerContents'
import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import { worldCollision } from './collisionGeometry'
import { hasFixedFurniture } from './fixedFurniture'

/** Approved desk proposal. Coordinates are product-world metres, +Z toward the seat. */
export const DESKTOP_REGIONS = {
  monitor: { x0: -.165, x1: .455, z0: .085, z1: .29 },
  keyboard: { x0: -.025, x1: .315, z0: .335, z1: .49 },
  mouse: { x0: .335, x1: .645, z0: .30, z1: .61 },
  miscellaneous: { x0: .45, x1: .68, z0: .085, z1: .21 },
  cup: { x0: .80, x1: .96, z0: .082, z1: .242 },
}
export const DESKTOP_CENTER_X = .145
export const DESKTOP_BINDINGS = {
  monitor: { region: 'monitor', label: '显示器后方中线区', position: [.145, .75, .195] },
  keyboard: { region: 'keyboard', label: '键盘中部区', position: [.145, .75, .4125] },
  mousepad: { region: 'mouse', label: '右侧鼠标垫区', position: [.485, .75, .46] },
  mouse: { region: 'mouse', label: '鼠标操作区', position: [.485, .751, .46] },
  tissue_box: { region: 'miscellaneous', label: '右侧常用品区', position: [.565, .75, .1475] },
  stainless_bottle: { region: 'cup', label: '右侧水杯区', position: [.88, .75, .14] },
  cup: { region: 'cup', label: '右侧水杯区', position: [.85, .75, .10] },
} as const
export type DesktopPrefab = keyof typeof DESKTOP_BINDINGS
export function desktopBinding(object: SceneObject, room: RoomConfig) {
  const id = object.model.prefabId
  return hasFixedFurniture(room) && id && Object.prototype.hasOwnProperty.call(DESKTOP_BINDINGS, id) ? DESKTOP_BINDINGS[id as DesktopPrefab] : null
}

/** Prefer the pad actually supporting this mouse; otherwise use the closest visible pad. */
export function mouseSupportPad(object: SceneObject, objects: SceneObject[]): SceneObject | undefined {
  if (object.model.prefabId !== 'mouse') return undefined
  const [x, , z] = object.transform.position
  return objects.filter((o) => o.id !== object.id && o.visible && o.model.prefabId === 'mousepad')
    .sort((a, b) => Math.hypot(a.transform.position[0] - x, a.transform.position[2] - z)
      - Math.hypot(b.transform.position[0] - x, b.transform.position[2] - z))[0]
}

export function desktopMovementRange(object: SceneObject, room: RoomConfig, others: SceneObject[]) {
  const binding = desktopBinding(object, room)
  if (!binding) return null
  const local = worldCollision({ ...object, transform: { position: [0, 0, 0], rotationY: 0 } }).bounds
  let rect = { ...DESKTOP_REGIONS[binding.region] }, surfaceY = .75
  const pad = mouseSupportPad(object, others)
  if (pad) {
    const b = worldCollision(pad).bounds
    rect = { x0: Math.max(rect.x0, b.min[0]), x1: Math.min(rect.x1, b.max[0]), z0: Math.max(rect.z0, b.min[2]), z1: Math.min(rect.z1, b.max[2]) }
    surfaceY = b.max[1]
  }
  let x0 = rect.x0 - local.min[0], x1 = rect.x1 - local.max[0]
  if (object.model.prefabId === 'monitor' || object.model.prefabId === 'keyboard') {
    x0 = Math.max(x0, DESKTOP_CENTER_X); x1 = Math.min(x1, DESKTOP_CENTER_X)
  }
  return { x0, x1, z0: rect.z0 - local.min[2], z1: rect.z1 - local.max[2], y: surfaceY - local.min[1], label: binding.label }
}

/** Used by both drag previews and all property/keyboard edits; never shrinks an item to fit. */
export function constrainDesktopPose(object: SceneObject, room: RoomConfig, others: SceneObject[]): SceneObject['transform'] {
  if (isFurnitureStoragePosition(object, room)) return object.transform
  const range = desktopMovementRange(object, room, others)
  if (!range) return object.transform
  if (range.x0 > range.x1 + 1e-6 || range.z0 > range.z1 + 1e-6) throw new Error(`${object.name}尺寸超出${range.label}，请核对尺寸；不会自动缩小物品`)
  const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n))
  return { position: [clamp(object.transform.position[0], range.x0, range.x1), range.y, clamp(object.transform.position[2], range.z0, range.z1)], rotationY: 0 }
}

export function desktopPlacementIssue(object: SceneObject, room: RoomConfig, others: SceneObject[]): string | null {
  if (!desktopBinding(object, room)) return null
  try {
    const pose = constrainDesktopPose(object, room, others)
    return pose.position.some((v, i) => Math.abs(v - object.transform.position[i]) > .002)
      || Math.abs(Math.atan2(Math.sin(object.transform.rotationY), Math.cos(object.transform.rotationY))) > 1e-6
      ? `${object.name}须位于${desktopBinding(object, room)!.label}并正向放置` : null
  } catch (error) { return (error as Error).message }
}

export function initialDesktopPose(object: SceneObject, room: RoomConfig, others: SceneObject[]): SceneObject['transform'] {
  const binding = desktopBinding(object, room)
  return binding ? constrainDesktopPose({ ...object, transform: { position: [...binding.position] as Vec3, rotationY: 0 } }, room, others) : object.transform
}

/** Pad movement, resizing, hiding or removal updates its mice in the same undoable edit. */
export function followMousepad(previous: SceneObject[], next: SceneObject[], room: RoomConfig): SceneObject[] {
  if (!hasFixedFurniture(room)) return next
  return next.map((mouse) => {
    if (mouse.model.prefabId !== 'mouse' || isFurnitureStoragePosition(mouse, room)) return mouse
    const oldMouse = previous.find((o) => o.id === mouse.id)
    if (!oldMouse) return mouse
    const oldPad = mouseSupportPad(oldMouse, previous), newPad = mouseSupportPad(mouse, next)
    if (JSON.stringify(oldPad) === JSON.stringify(newPad)) return mouse
    const position: Vec3 = [...mouse.transform.position]
    if (oldPad && newPad?.id === oldPad.id) for (const i of [0, 2]) position[i] += newPad.transform.position[i] - oldPad.transform.position[i]
    const transform = constrainDesktopPose({ ...mouse, transform: { ...mouse.transform, position } }, room, next)
    if ((mouse.fixed || mouse.locked) && JSON.stringify(transform) !== JSON.stringify(mouse.transform)) throw new Error(`请先解除「${mouse.name}」的固定或锁定，再修改鼠标垫`)
    return { ...mouse, transform }
  })
}
