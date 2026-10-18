import type { CableConnection, Port, Project, SceneObject, Vec3 } from '@/types/project'
import { validateCableConnection } from '@/scene/cables'
import { bookPosePoint, bookPoseDirection } from '@/scene/bookPose'

/**
 * 前台表面端口核心 + 全场景连接审计。
 *
 * 该模块只做只读推导与问题汇总，不写入数据、不推断新连接：
 * 兼容的端口不会自动连线；仅当用户显式建立的线缆被引用时才参与审计。
 */

export interface SurfaceHit {
  objectId: string
  /** 相对物体底面中心的局部偏移（米，物体自身坐标系） */
  offset: Vec3
  /** 与 offset 同坐标系的局部单位方向 */
  localDirection: Vec3
}

export type ConnectionObjectStatus =
  | 'not_required'
  | 'wireless'
  | 'missing_ports'
  | 'unconnected'
  | 'connected'

export interface ConnectionObjectReport {
  objectId: string
  name: string
  status: ConnectionObjectStatus
  message: string
}

export interface ConnectionIssue {
  objectId?: string
  cableId?: string
  /** 能确定具体接口时给出，界面据此直接定位并高亮该接口（不参与空间计算） */
  portId?: string
  message: string
}

export interface ConnectionAudit {
  objects: ConnectionObjectReport[]
  issues: ConnectionIssue[]
  blocking: boolean
}

function isFiniteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v))
}

/**
 * 世界点 / 法线 → 物体局部表面命中。
 * - offset：世界点相对物体底面中心的反向 Y 旋转（米）；
 * - localDirection：世界法线的反向 Y 旋转并按物体局部方向归一化（拒绝非有限 / 零向量）；
 * - 输入无效或解析失败返回 null（调用方据此忽略该命中，不推断端口）。
 */
export function surfaceHit(object: SceneObject, worldPoint: Vec3, worldNormal: Vec3): SurfaceHit | null {
  if (!object || !isFiniteVec3(worldPoint) || !isFiniteVec3(worldNormal)) return null
  const rotationY = object.transform.rotationY
  if (!Number.isFinite(rotationY)) return null
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  const dx = worldPoint[0] - object.transform.position[0]
  const dy = worldPoint[1] - object.transform.position[1]
  const dz = worldPoint[2] - object.transform.position[2]
  const offset: Vec3 = bookPosePoint(object, [dx * cos - dz * sin, dy, dx * sin + dz * cos], true)
  if (!isFiniteVec3(offset)) return null
  const nx = worldNormal[0]
  const ny = worldNormal[1]
  const nz = worldNormal[2]
  const lx = nx * cos - nz * sin
  const ly = ny
  const lz = nx * sin + nz * cos
  const len = Math.hypot(lx, ly, lz)
  if (!Number.isFinite(len) || len <= 0) return null
  const localDirection: Vec3 = bookPoseDirection(object, [lx / len, ly / len, lz / len], true)
  return { objectId: object.id, offset, localDirection }
}

function isWirelessOnly(object: SceneObject): boolean {
  if (object.ports.length === 0) return false
  return object.ports.every((port) => port.type === 'wireless')
}

const SUPPORTED_BACKEND_PORT_TYPES = new Set(['power-ac', 'usb-a', 'usb-c', 'dc', 'rj45', 'hdmi'])
const SUPPORTED_BACKEND_KINDS = new Set(['power', 'network', 'data', 'video', 'charging'])

function endpointPort(objects: Map<string, SceneObject>, objectId: string | undefined, portId: string | undefined): Port | null {
  if (!objectId) return null
  const object = objects.get(objectId)
  if (!object || !portId) return null
  return object.ports.find((port) => port.id === portId) ?? null
}

function cableLabel(cable: CableConnection, index: number): string {
  return cable.id || `#${index + 1}`
}

/**
 * 全场景连接审计。
 *
 * - 覆盖全部物体（含隐藏物体），隐藏物体仍作为走线障碍 / 端点参与审计；
 * - 复用 `validateCableConnection` 校验每条现存线缆，并排除自身；
 * - 报告重复全局 id、悬空端口、未确认引用端口、非法偏移 / 法线、后端不支持的音频物理线缆；
 * - 不因端口兼容而自动推导连接；未使用的可选端口不是错误；
 * - 电气 / 需供电但未连接的设备给出非阻塞复核提示；
 * - 无任何线缆引用时缺端口不阻塞。
 */
export function auditConnections(project: Pick<Project, 'id' | 'objects' | 'cables'>): ConnectionAudit {
  const objects = project.objects ?? []
  const cables = project.cables ?? []
  const issues: ConnectionIssue[] = []

  // ── 全局 id 唯一性 ──
  const objectIds = new Map<string, SceneObject>()
  const seenObjectIds = new Set<string>()
  for (const object of objects) {
    if (seenObjectIds.has(object.id)) {
      issues.push({ objectId: object.id, message: `物体 ID 重复：${object.id}` })
      continue
    }
    seenObjectIds.add(object.id)
    objectIds.set(object.id, object)
  }

  const itemIds = new Set<string>(seenObjectIds)
  const cableIds = new Set<string>()
  for (const object of objects) {
    for (const port of object.ports) {
      if (itemIds.has(port.id)) {
        issues.push({ objectId: object.id, message: `接口 ID 全局重复：${port.id}` })
      }
      itemIds.add(port.id)
      if (port.offset !== undefined && !isFiniteVec3(port.offset)) {
        issues.push({ objectId: object.id, portId: port.id, message: `接口 ${port.id} 的偏移不是有效三维向量` })
      }
      if (port.localDirection !== undefined && !isFiniteVec3(port.localDirection)) {
        issues.push({ objectId: object.id, portId: port.id, message: `接口 ${port.id} 的局部方向不是有效三维向量` })
      } else if (port.localDirection !== undefined && port.localDirection.every((v) => v === 0)) {
        issues.push({ objectId: object.id, portId: port.id, message: `接口 ${port.id} 的局部方向为零向量` })
      }
    }
  }
  for (const cable of cables) {
    if (cableIds.has(cable.id) || itemIds.has(cable.id)) {
      issues.push({ cableId: cable.id, message: `线缆 ID 重复：${cable.id}` })
    }
    cableIds.add(cable.id)
  }

  // ── 每条线缆的端点 / 兼容性校验（排除自身）──
  for (let i = 0; i < cables.length; i += 1) {
    const cable = cables[i]
    const fromPort = endpointPort(objectIds, cable.from.objectId, cable.from.portId)
    const toPort = endpointPort(objectIds, cable.to.objectId, cable.to.portId)
    if (!objectIds.has(cable.from.objectId)) {
      issues.push({ cableId: cable.id, message: `线缆 ${cableLabel(cable, i)} 的起点设备已删除（悬空端口）` })
    } else if (!fromPort) {
      issues.push({ cableId: cable.id, objectId: cable.from.objectId, message: `线缆 ${cableLabel(cable, i)} 的起点端口不存在（悬空端口）` })
    } else if (fromPort.confirmed !== true) {
      issues.push({ cableId: cable.id, objectId: cable.from.objectId, portId: fromPort.id, message: `线缆 ${cableLabel(cable, i)} 的起点端口尚未确认` })
    }
    if (!objectIds.has(cable.to.objectId)) {
      issues.push({ cableId: cable.id, message: `线缆 ${cableLabel(cable, i)} 的终点设备已删除（悬空端口）` })
    } else if (!toPort) {
      issues.push({ cableId: cable.id, objectId: cable.to.objectId, message: `线缆 ${cableLabel(cable, i)} 的终点端口不存在（悬空端口）` })
    } else if (toPort.confirmed !== true) {
      issues.push({ cableId: cable.id, objectId: cable.to.objectId, portId: toPort.id, message: `线缆 ${cableLabel(cable, i)} 的终点端口尚未确认` })
    }

    if (fromPort && toPort) {
      const validation = validateCableConnection(project, cable.from, cable.to, { excludeCableId: cable.id, kind: cable.kind })
      if (!validation.ok) {
        issues.push({ cableId: cable.id, message: `线缆 ${cableLabel(cable, i)}：${validation.reason}` })
      }
      if (fromPort.type === 'audio' || toPort.type === 'audio') {
        issues.push({ cableId: cable.id, message: `线缆 ${cableLabel(cable, i)} 使用了当前后端不支持的音频物理接口` })
      }
      if (!SUPPORTED_BACKEND_KINDS.has(cable.kind)) {
        issues.push({ cableId: cable.id, message: `线缆 ${cableLabel(cable, i)} 的用途类型当前后端不支持：${cable.kind}` })
      }
      for (const port of [fromPort, toPort]) {
        if (!SUPPORTED_BACKEND_PORT_TYPES.has(port.type)) {
          issues.push({ cableId: cable.id, message: `线缆 ${cableLabel(cable, i)} 引用了当前后端不支持的端口类型：${port.type}` })
        }
      }
    }
  }

  // ── 每个物体的连接状态 ──
  const connectedObjectIds = new Set<string>()
  for (const cable of cables) {
    if (objectIds.has(cable.from.objectId) && endpointPort(objectIds, cable.from.objectId, cable.from.portId)) {
      connectedObjectIds.add(cable.from.objectId)
    }
    if (objectIds.has(cable.to.objectId) && endpointPort(objectIds, cable.to.objectId, cable.to.portId)) {
      connectedObjectIds.add(cable.to.objectId)
    }
  }

  const objectReports: ConnectionObjectReport[] = objects.map((object) => {
    const physicalPorts = object.ports.filter((port) => port.type !== 'wireless')
    const wirelessOnly = isWirelessOnly(object)
    const connected = connectedObjectIds.has(object.id)
    // 只有当存在线缆引用该物体时，缺端口才是问题
    const referencedByCable = cables.some(
      (cable) => cable.from.objectId === object.id || cable.to.objectId === object.id,
    )
    const needsReview = object.category === 'electrical' || object.needsPower

    let status: ConnectionObjectStatus
    let message: string
    if (connected) {
      status = 'connected'
      message = '已建立连接'
    } else if (wirelessOnly) {
      status = 'wireless'
      message = '仅无线接口，无需物理线缆'
    } else if (needsReview && physicalPorts.length === 0) {
      if (referencedByCable) {
        status = 'missing_ports'
        message = '用电设备缺少物理接口，但已有线缆引用，请补充接口'
        issues.push({ objectId: object.id, message: `${object.name} 被线缆引用但缺少物理接口` })
      } else {
        status = 'missing_ports'
        message = '用电设备缺少物理接口（无电缆引用，仅供参考）'
      }
    } else if (needsReview || physicalPorts.length > 0) {
      status = 'unconnected'
      message = needsReview
        ? '用电设备尚未建立连接，请复核是否需要接线'
        : '存在可选物理接口但未使用（可选）'
    } else {
      status = 'not_required'
      message = '无需连接'
    }

    return { objectId: object.id, name: object.name, status, message }
  })

  const blocking = issues.length > 0
  return { objects: objectReports, issues, blocking }
}
