import type { Port, PortDirection, Vec3 } from '@/types/project'

/**
 * 端口局部方向解析（纯几何助手）。
 *
 * 该模块刻意不导入 `@/scene/ports.ts`，避免依赖环；
 * 需要传统六向回退时使用本模块自带的轴映射。
 * 坐标约定与 `SceneObject.transform` 一致：+x 右 / +y 上 / +z 朝人。
 */

const AXIS_MAP: Record<PortDirection, Vec3> = {
  back: [0, 0, -1],
  front: [0, 0, 1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  up: [0, 1, 0],
  down: [0, -1, 0],
}

function isFiniteVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v))
}

function normalize(v: Vec3): Vec3 | null {
  const len = Math.hypot(v[0], v[1], v[2])
  if (!Number.isFinite(len) || len <= 0) return null
  return [v[0] / len, v[1] / len, v[2] / len]
}

/**
 * 解析端口局部朝向（单位向量）。
 * - 优先使用 `port.localDirection`（必须是有限且非零的三维向量，归一化后返回，原方向符号保留）；
 * - 否则回退到传统 `port.direction` 六轴（默认 back）；
 * - `localDirection` 非法（非有限 / 零向量）时也回退六轴，确保旧数据与错误数据都能工作。
 */
export function resolvePortLocalDirection(port: Pick<Port, 'localDirection' | 'direction'>): Vec3 {
  if (port.localDirection !== undefined) {
    if (!isFiniteVec3(port.localDirection)) return [...AXIS_MAP[port.direction ?? 'back']]
    const normalized = normalize(port.localDirection)
    if (normalized) return normalized
  }
  return [...AXIS_MAP[port.direction ?? 'back']]
}

/**
 * 本地副本轴映射：供调用方（含 `@/scene/ports.ts`）在需要传统六向向量时使用，
 * 避免再次硬编码方向表达式。
 */
export function axisDirVec(dir: PortDirection): Vec3 {
  return [...AXIS_MAP[dir]]
}
