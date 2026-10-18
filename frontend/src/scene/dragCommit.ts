import type { Vec3 } from '@/types/project'

/** 判定两个位置是否一致（1e-6 米容差，避免浮点噪声产生无变化的提交） */
function samePosition(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a[0] - b[0]) <= 1e-6 &&
    Math.abs(a[1] - b[1]) <= 1e-6 &&
    Math.abs(a[2] - b[2]) <= 1e-6
  )
}

/**
 * 拖拽释放的落点决策（纯函数，便于测试）：
 * - 拖动摆放取消硬性碰撞拦截与弹回，仅提醒存在干涉；
 * - 释放时直接提交落点位置 finalPos，并在界面上以警示红框与问题清单提醒干涉；
 * - 与起点一致（未发生有效位移）→ 返回 null：不提交、不产生空历史记录。
 */
export function resolveDropCommit(
  start: Vec3,
  _lastValid: Vec3,
  finalPos: Vec3,
  _finalValid?: boolean,
): Vec3 | null {
  // 取消碰撞干涉强行弹回，直接提交落点位置 finalPos（未位移时不提交）
  return samePosition(finalPos, start) ? null : finalPos
}
