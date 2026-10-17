import type { Port, PortDirection, PortType, SceneObject, Vec3 } from '@/types/project'
import { resolvePortLocalDirection } from '@/features/connections/portGeometry'

/**
 * 电气设备接口：默认接口生成 + 接口世界坐标 / 朝向推导。
 *
 * 坐标约定：接口位置以「相对设备底面中心点的局部偏移」保存（米），
 * 设备移动或绕 y 轴旋转后，世界坐标由设备位姿实时推导（无需手动同步）。
 */

export const PORT_TYPE_COLORS: Record<PortType, string> = {
  'power-ac': '#E5484D',
  'usb-a': '#10B981',
  'usb-c': '#0EA5E9',
  dc: '#F59E0B',
  rj45: '#3B82F6',
  hdmi: '#8B5CF6',
  audio: '#EC4899',
  wireless: '#94A3B8',
}

/** 局部朝向单位向量（设备自身坐标系：+x 右 / +y 上 / +z 朝人） */
export function localDirVec(dir: PortDirection): Vec3 {
  switch (dir) {
    case 'back':
      return [0, 0, -1]
    case 'front':
      return [0, 0, 1]
    case 'left':
      return [-1, 0, 0]
    case 'right':
      return [1, 0, 0]
    case 'up':
      return [0, 1, 0]
    case 'down':
      return [0, -1, 0]
  }
}

/** 绕 y 轴旋转局部向量（与 three.js 的 Y 旋转矩阵一致） */
export function rotateLocalVecY(v: Vec3, rotationY: number): Vec3 {
  const cos = Math.cos(rotationY)
  const sin = Math.sin(rotationY)
  return [v[0] * cos + v[2] * sin, v[1], -v[0] * sin + v[2] * cos]
}

/** 局部点（相对底面中心）→ 世界坐标 */
export function localToWorld(object: SceneObject, local: Vec3): Vec3 {
  const r = rotateLocalVecY(local, object.transform.rotationY)
  return [
    object.transform.position[0] + r[0],
    object.transform.position[1] + r[1],
    object.transform.position[2] + r[2],
  ]
}

/**
 * 未显式设置偏移时派生默认接口位置：
 * 设备背面（局部 -z）居中，多个接口沿 x 均匀铺开。
 */
export function defaultPortOffset(object: SceneObject, index: number, total: number): Vec3 {
  const { width, height, depth } = object.dimensions
  const spread = Math.min(0.05, width / Math.max(2, total + 1))
  const x = total <= 1 ? 0 : -((total - 1) / 2) * spread + index * spread
  const y = Math.min(Math.max(0.35 * height, 0.02), Math.max(0.02, height - 0.02))
  return [x, y, -depth / 2 - 0.002]
}

/** 接口最终生效的局部偏移（显式 offset 优先，否则派生默认值） */
export function resolvePortOffset(object: SceneObject, port: Port): Vec3 {
  if (port.offset) return port.offset
  const index = Math.max(0, object.ports.indexOf(port))
  return defaultPortOffset(object, index, object.ports.length)
}

/** 接口世界坐标（米） */
export function portWorldPosition(object: SceneObject, port: Port): Vec3 {
  return localToWorld(object, resolvePortOffset(object, port))
}

/** 接口世界朝向（单位向量） */
export function portWorldDirection(object: SceneObject, port: Port): Vec3 {
  return rotateLocalVecY(resolvePortLocalDirection(port), object.transform.rotationY)
}

/**
 * 为缺少接口的用电设备补充默认接口（仅电气设备 / 需要供电的设备）。
 * 已有接口的设备返回 null（无需变更）。
 */
export function ensureDefaultPorts(object: SceneObject): Port[] | null {
  if (object.ports.length > 0) return null
  if (object.category !== 'electrical' && !object.needsPower) return null
  return [
    {
      id: `${object.id}-port-default`,
      type: 'power-ac',
      label: '默认电源口（自动补充）',
      powered: true,
    },
  ]
}

/** 依据两端接口类型 / 供电属性推断线缆大类 */
export function inferCableKind(
  from: { type?: PortType; powered?: boolean } | null,
  to: { type?: PortType; powered?: boolean } | null,
): import('@/types/project').CableKind {
  const types = [from?.type, to?.type]
  if (types.includes('hdmi')) return 'video'
  if ((from?.powered ?? false) && (to?.powered ?? false)) return 'power'
  if (types.includes('power-ac')) return 'power'
  if (types.includes('dc')) return 'charging'
  return 'data'
}
