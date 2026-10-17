import type { Vec3 } from '@/types/project'

/** 判定两个位置是否一致（1e-6 米容差，避免浮点噪声产生无变化的提交） */
function samePosition(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a[0] - b[0]) <= 1e-6 &&
    Math.abs(a[1] - b[1]) <= 1e-6 &&
    Math.abs(a[2] - b[2]) <= 1e-6
  )
}

/** 手动落点始终保留，干涉只提醒；未移动时不生成历史。 */
export function resolveDropCommit(
  start: Vec3,
  _lastValid: Vec3,
  finalPos: Vec3,
  _finalValid?: boolean,
): Vec3 | null {
  return samePosition(finalPos, start) ? null : finalPos
}
