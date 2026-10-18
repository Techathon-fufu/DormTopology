import type { PortDirection, RoomConfig, SceneObject, Vec3 } from '@/types/project'
import { resolvePortLocalDirection } from '@/features/connections/portGeometry'
import { fixedFurnitureBoxes, hasFixedFurniture } from './fixedFurniture'
import { isPowerStripObject, resolvePowerStripConfig } from './powerStrip'
import { resolvePortOffset } from './ports'

export function backboardSurface(room: RoomConfig) {
  if (!hasFixedFurniture(room)) return null
  const board = fixedFurnitureBoxes.find((p) => p.name === 'Desk_Back_Baffle')!
  return { id: board.name, x0: board.min[0], x1: board.max[0], y0: board.min[1],
    y1: Math.min(board.max[1], room.desk.height - room.desk.thickness), z: board.max[2] }
}

/** Rotate the physical strip and all authored ports about its centre, preserving IDs. */
export function orientPowerStrip(object: SceneObject, backboard: boolean): SceneObject {
  if (!isPowerStripObject(object) || (object.powerStrip?.mount === 'backboard') === backboard) return object
  const { height, depth } = object.dimensions
  const rotate = ([x, y, z]: Vec3): Vec3 => backboard ? [x, -z || 0, y] : [x, z, -y || 0]
  const dimensions = { ...object.dimensions, height: depth, depth: height }
  return { ...object, dimensions, powerStrip: { ...resolvePowerStripConfig(object), mount: backboard ? 'backboard' : undefined },
    transform: { ...object.transform, rotationY: backboard ? 0 : object.transform.rotationY },
    ports: object.ports.map((port) => {
      const [x, y, z] = resolvePortOffset(object, port)
      const p = rotate([x, y - height / 2, z])
      const normal = rotate(resolvePortLocalDirection(port))
      const axes: Array<[PortDirection, Vec3]> = [['up', [0, 1, 0]], ['down', [0, -1, 0]], ['front', [0, 0, 1]], ['back', [0, 0, -1]], ['left', [-1, 0, 0]], ['right', [1, 0, 0]]]
      const direction = axes.find(([, axis]) => axis.every((v, i) => Math.abs(v - normal[i]) < 1e-7))?.[0] ?? port.direction
      return { ...port, direction, offset: [p[0], p[1] + dimensions.height / 2, p[2]] as Vec3,
        localDirection: normal, confirmed: false }
    }) }
}

/** Input x/y are the strip's bottom-centre coordinates; only PDU can attach here. */
export function placePowerStripOnBackboard(object: SceneObject, room: RoomConfig, point?: Vec3): SceneObject {
  const board = backboardSurface(room)
  if (!board || !isPowerStripObject(object)) return object
  const mounted = orientPowerStrip(object, true), { width, height, depth } = mounted.dimensions
  const clamp = (v: number, low: number, high: number) => low > high ? (low + high) / 2 : Math.max(low, Math.min(high, v))
  const x = clamp(point?.[0] ?? (board.x0 + board.x1) / 2, board.x0 + width / 2, board.x1 - width / 2)
  const y = clamp(point?.[1] ?? (board.y0 + board.y1 - height) / 2, board.y0, board.y1 - height)
  return { ...mounted, transform: { position: [x, y, board.z + depth / 2], rotationY: 0 } }
}

export function validBackboardMount(object: SceneObject, position: Vec3, room: RoomConfig): boolean {
  const board = backboardSurface(room), d = object.dimensions
  return !!board && isPowerStripObject(object) && object.powerStrip?.mount === 'backboard'
    && Math.abs(object.transform.rotationY) < 1e-7 && Math.abs(position[2] - d.depth / 2 - board.z) <= .001
    && position[0] - d.width / 2 >= board.x0 - .001 && position[0] + d.width / 2 <= board.x1 + .001
    && position[1] >= board.y0 - .001 && position[1] + d.height <= board.y1 + .001
}
