import type { Vec3 } from '@/types/project'

/**
 * 单位约定（全工程唯一换算入口）：
 * - 三维计算 / 数据存储统一使用「米（m）」
 * - 面向用户的表单展示使用「毫米（mm）」
 * - 任何 mm <-> m 的换算都必须经过本文件，禁止在业务代码里散写 *1000 / /1000
 */
export const MM_PER_M = 1000

export function mmToM(mm: number): number {
  return mm / MM_PER_M
}

export function mToMm(m: number): number {
  return m * MM_PER_M
}

/** 米 -> 带单位的毫米文本，如 1200 mm */
export function formatMm(m: number, digits = 0): string {
  return `${mToMm(m).toFixed(digits)} mm`
}

export function formatMeters(m: number, digits = 2): string {
  return `${m.toFixed(digits)} m`
}

export function formatVec3Mm(v: Vec3): string {
  return v.map((n) => mToMm(n).toFixed(0)).join(' × ')
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
