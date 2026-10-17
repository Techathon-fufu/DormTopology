import type {
  CableConnection,
  CableEndpoint,
  Port,
  Project,
  SceneObject,
  Vec3,
} from '@/types/project'
import { portWorldDirection, portWorldPosition, inferCableKind } from '@/scene/ports'
import { uid } from '@/lib/utils'
import { clonePoints } from '@/types/cable'

/**
 * 线缆端点与展示辅助：
 * - 端点世界坐标由「设备 + 接口」实时推导（设备移动 / 旋转后自动同步）；
 * - 接口缺失时退回端点快照位置（历史数据兼容）。
 */

export function findPort(object: SceneObject, portId?: string): Port | null {
  if (!portId) return null
  return object.ports.find((p) => p.id === portId) ?? null
}

/** 端点世界坐标（优先由接口实时推导） */
export function resolveEndpointPosition(
  objects: SceneObject[],
  endpoint: CableEndpoint,
): Vec3 {
  const object = objects.find((o) => o.id === endpoint.objectId)
  if (object) {
    const port = findPort(object, endpoint.portId)
    if (port) return portWorldPosition(object, port)
    // 接口被删除：退回设备背面中心（仍跟随设备位姿）
    return portWorldPosition(object, {
      id: '__fallback__',
      type: 'power-ac',
      powered: false,
      offset: [0, Math.min(0.35 * object.dimensions.height, 0.05), -object.dimensions.depth / 2 - 0.01],
    })
  }
  return clonePoints([endpoint.position])[0]
}

/** 端点世界朝向（接口缺失时朝后） */
export function resolveEndpointDirection(
  objects: SceneObject[],
  endpoint: CableEndpoint,
): Vec3 {
  const object = objects.find((o) => o.id === endpoint.objectId)
  if (!object) return [0, 0, -1]
  const port = findPort(object, endpoint.portId)
  if (!port) return [0, 0, -1]
  return portWorldDirection(object, port)
}

/** 由设备 + 接口生成线缆端点（position 为快照，渲染时实时推导覆盖） */
export function endpointOf(object: SceneObject, port: Port | undefined | null): CableEndpoint {
  const portId = port?.id
  const position = port ? portWorldPosition(object, port) : ([...object.transform.position] as Vec3)
  return { objectId: object.id, portId, position }
}

export interface CableRouteView {
  /** 已贴合接口端点的控制点（米） */
  points: Vec3[]
  nodeIds: (string | null)[]
}

/**
 * 线缆展示控制点：route.points 首末点替换为接口实时世界坐标。
 * view = 'original' 时读取 originalRoute（没有则退回当前 route）。
 */
export function cableDisplayPoints(
  cable: CableConnection,
  objects: SceneObject[],
  view: 'suggested' | 'original' = 'suggested',
): Vec3[] {
  const route = view === 'original' && cable.originalRoute ? cable.originalRoute : cable.route
  return cableDisplayRoute(cable, objects, route.points, route.nodeIds)
}

/** 指定控制点 -> 端点贴合后的展示控制点（节点拖拽预览也走这里） */
export function cableDisplayRoute(
  cable: CableConnection,
  objects: SceneObject[],
  points: Vec3[],
  nodeIds?: (string | null)[],
): Vec3[] {
  const pts = clonePoints(points)
  if (pts.length === 0) return pts
  const fromPos = resolveEndpointPosition(objects, cable.from)
  const toPos = resolveEndpointPosition(objects, cable.to)
  pts[0] = fromPos
  if (pts.length > 1) pts[pts.length - 1] = toPos
  else pts.push(toPos)
  void nodeIds
  return pts
}

export type CreateCableResult = { ok: true; cable: CableConnection } | { ok: false; reason: string }

/**
 * 在两个接口之间建立连接（新建线缆）：
 * - 拒绝同一接口自连 / 重复连接；
 * - 初始路径为直连两点（未规划），用户可点击「规划走线」生成建议路径。
 */
export function createCableBetween(
  project: Project,
  fromObjectId: string,
  fromPortId: string,
  toObjectId: string,
  toPortId: string,
): CreateCableResult {
  const fromObject = project.objects.find((o) => o.id === fromObjectId)
  const toObject = project.objects.find((o) => o.id === toObjectId)
  const fromPort = fromObject ? findPort(fromObject, fromPortId) : null
  const toPort = toObject ? findPort(toObject, toPortId) : null
  if (!fromObject || !toObject || !fromPort || !toPort) {
    return { ok: false, reason: '接口不存在（设备或接口可能已被删除）' }
  }
  if (fromObject.id === toObject.id && fromPort.id === toPort.id) {
    return { ok: false, reason: '不能把接口连接到它自身' }
  }
  const duplicate = project.cables.some(
    (c) =>
      (c.from.objectId === fromObjectId &&
        c.from.portId === fromPortId &&
        c.to.objectId === toObjectId &&
        c.to.portId === toPortId) ||
      (c.from.objectId === toObjectId &&
        c.from.portId === toPortId &&
        c.to.objectId === fromObjectId &&
        c.to.portId === fromPortId),
  )
  if (duplicate) return { ok: false, reason: '这两个接口之间已存在连接' }

  const fromPos = portWorldPosition(fromObject, fromPort)
  const toPos = portWorldPosition(toObject, toPort)
  const mid: Vec3 = [
    (fromPos[0] + toPos[0]) / 2,
    Math.max(fromPos[1], toPos[1]) + 0.02,
    (fromPos[2] + toPos[2]) / 2,
  ]

  const cable: CableConnection = {
    id: uid('cable'),
    projectId: project.id,
    kind: inferCableKind(fromPort, toPort),
    from: endpointOf(fromObject, fromPort),
    to: endpointOf(toObject, toPort),
    route: { channels: ['free'], points: [fromPos, mid, toPos], nodeIds: [null, null, null] },
    status: 'existing',
    planSource: 'manual',
    accessories: [],
    note: '手动建立连接：尚未规划路径（可点击「规划走线」生成建议路径）',
    updatedAt: Date.now(),
  }
  return { ok: true, cable }
}

/** 端点描述文本：设备名 · 接口名 */
export function endpointLabel(
  objects: SceneObject[],
  endpoint: CableEndpoint,
): { objectName: string; portLabel: string } {
  const object = objects.find((o) => o.id === endpoint.objectId)
  const port = object ? findPort(object, endpoint.portId) : null
  return {
    objectName: object?.name ?? '（设备已删除）',
    portLabel: port?.label ?? (port ? port.type : '（接口缺失）'),
  }
}
