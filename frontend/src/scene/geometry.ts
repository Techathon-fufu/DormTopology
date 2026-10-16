import type { RoomConfig, Vec3 } from '@/types/project'

/** 折线总长度（米） */
export function polylineLength(points: Vec3[]): number {
  let total = 0
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1]
    const b = points[i]
    total += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
  }
  return total
}

/** 计算目标点到折线各段的最小水平距离（用于就近吸附提示，米） */
export function distanceXZ(a: Vec3, b: Vec3): number {
  return Math.hypot(b[0] - a[0], b[2] - a[2])
}

/**
 * 场景坐标约定：后墙位于 z = 0，x 以桌面中心为 0，y 向上（米）。
 * 桌面后缘距墙 0.05 m，桌面中心 z = desk.depth / 2 + 0.05。
 */
export function deskCenterZ(room: RoomConfig): number {
  return room.desk.depth / 2 + 0.05
}

/**
 * 新识别物品的默认摆放（略微凌乱的初始状态，供后续「整理」阶段优化）。
 * index 为物品在当前清单中的序号。
 */
export function initialDeskPlacement(index: number, room: RoomConfig): Vec3 {
  const perRow = 5
  const col = index % perRow
  const row = Math.floor(index / perRow)
  const x = -0.48 + col * 0.24
  const z = deskCenterZ(room) - room.desk.depth / 2 + 0.10 + row * 0.26
  return [x, room.desk.height, z]
}

/** 由桌面中心与局部偏移得到世界坐标（米） */
export function onDesk(room: RoomConfig, x: number, zOffsetFromBack: number, y?: number): Vec3 {
  return [x, y ?? room.desk.height, 0.05 + zOffsetFromBack]
}
