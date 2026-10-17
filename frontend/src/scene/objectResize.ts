import type { ObjectDimensions, Vec3 } from '@/types/project'

/**
 * 物体等比缩放数学辅助（独立模块，不依赖场景 / 状态）。
 *
 * 约定：
 * - 尺寸单位米；等比缩放 dx=dy=dz 同步；
 * - 结果始终为正、有限并落在 min/max 边界内；
 * - 角点由符号元组 (sx, sy, sz) 唯一表示，每个分量取 -1 | 1，共 8 个；
 * - 拖拽倍率由「屏幕位移在角点对角方向上的有符号投影」计算：
 *   对角线在屏幕上的方向 (dx, dy) 提供单位方向，位移与之点积得到沿对角线方向的像素推进量。
 */

export const RESIZE_MIN = { width: 0.01, height: 0.005, depth: 0.01 } as const
/** 单轴最大尺寸（米） */
export const RESIZE_MAX = 5 as const

/** 角点符号元组：[x 方向, y 方向, z 方向]，每项 ±1 */
export type ResizeCorner = readonly [Sign, Sign, Sign]
type Sign = -1 | 1

export interface ResizeCornerEntry {
  corner: ResizeCorner
  position: Vec3
}

function finitePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/** 对齐到有限正数的尺寸（无效值回退到最小值而不是 NaN / 负数 / 0） */
export function sanitizeDimensions(
  dimensions: Pick<ObjectDimensions, 'width' | 'height' | 'depth'>,
): ObjectDimensions {
  return {
    width: finitePositive(dimensions.width, RESIZE_MIN.width),
    height: finitePositive(dimensions.height, RESIZE_MIN.height),
    depth: finitePositive(dimensions.depth, RESIZE_MIN.depth),
  }
}

/** 8 个角点：每个符号元组对应对角线上的一个顶点。 */
export function cubeCorners(dims: Pick<ObjectDimensions, 'width' | 'height' | 'depth'>): ResizeCornerEntry[] {
  const d = sanitizeDimensions(dims)
  const out: ResizeCornerEntry[] = []
  for (const sx of [1, -1] as const) {
    for (const sy of [1, -1] as const) {
      for (const sz of [1, -1] as const) {
        const corner: ResizeCorner = [sx, sy, sz]
        out.push({
          corner,
          position: [(sx * d.width) / 2, (sy * d.height) / 2, (sz * d.depth) / 2],
        })
      }
    }
  }
  return out
}

/**
 * 本地对角向量：底面中心 → 选中顶点（局部坐标，米）。
 * 底面顶点 y 方向取 0（保持底面锚定），顶面取完整高度。
 */
export function cornerDiagonal(dims: ObjectDimensions, corner: ResizeCorner): Vec3 {
  const d = sanitizeDimensions(dims)
  const [sx, sy, sz] = corner
  return [(sx * d.width) / 2, sy > 0 ? d.height : 0, (sz * d.depth) / 2]
}

/** 角点是否位于底面（y 符号为 -1）。 */
export function isBottomCorner(corner: ResizeCorner): boolean {
  return corner[1] < 0
}

/**
 * 以单一倍率缩放尺寸，并夹到正数边界内。
 * - scale 非有限：返回原尺寸（避免 NaN 传播）；
 * - scale <= 0（含负数 / 0）：收敛到允许的最小倍率，而不是恢复原尺寸；
 * - 任一轴触顶 / 触底时整体收敛，保持等比。
 */
export function clampUniformResize(
  dimensions: Pick<ObjectDimensions, 'width' | 'height' | 'depth'>,
  scale: number,
): ObjectDimensions {
  const base = sanitizeDimensions(dimensions)
  if (!Number.isFinite(scale)) return base

  const minScale = Math.max(
    RESIZE_MIN.width / base.width,
    RESIZE_MIN.height / base.height,
    RESIZE_MIN.depth / base.depth,
  )
  const maxScale = Math.min(
    RESIZE_MAX / base.width,
    RESIZE_MAX / base.height,
    RESIZE_MAX / base.depth,
  )
  if (!Number.isFinite(minScale) || !Number.isFinite(maxScale) || minScale > maxScale) {
    return base
  }
  const effective = scale <= 0 ? minScale : scale
  const clamped = Math.min(maxScale, Math.max(minScale, effective))
  return {
    width: base.width * clamped,
    height: base.height * clamped,
    depth: base.depth * clamped,
  }
}

/**
 * 屏幕位移 → 等比倍率（有符号投影法）。
 * - (dx, dy) 为「底面中心 → 角点」世界向量在屏幕上的投影差（像素）；
 * - (sx, sy) 为拖拽起点到当前指针的屏幕位移（像素）；
 * - 倍率 = 1 + (sx*dx + sy*dy) / (dx² + dy²)。
 * 对角线投影过短（无法确定方向）时返回 null。
 */
export function scaleFromScreenDrag(
  dragDx: number,
  dragDy: number,
  diagDx: number,
  diagDy: number,
): number | null {
  if (![dragDx, dragDy, diagDx, diagDy].every((n) => Number.isFinite(n))) return null
  const lenSq = diagDx * diagDx + diagDy * diagDy
  if (lenSq < 1e-6) return null
  const scale = 1 + (dragDx * diagDx + dragDy * diagDy) / lenSq
  return Number.isFinite(scale) ? scale : null
}

/**
 * 世界坐标投影到 NDC 的像素点（相对视口左上角）。
 * `project` 由调用方用 camera.project 提供。
 */
export function projectToPixel(
  project: (point: Vec3) => { x: number; y: number } | null,
  point: Vec3,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } | null {
  if (!Number.isFinite(viewportWidth) || !Number.isFinite(viewportHeight)) return null
  if (viewportWidth <= 0 || viewportHeight <= 0) return null
  const ndc = project(point)
  if (!ndc || !Number.isFinite(ndc.x) || !Number.isFinite(ndc.y)) return null
  return {
    x: ((ndc.x + 1) / 2) * viewportWidth,
    y: ((1 - ndc.y) / 2) * viewportHeight,
  }
}
