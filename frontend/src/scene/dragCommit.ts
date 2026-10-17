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
 * 拖拽释放的落点决策（纯函数，便于冒烟测试）：
 * - 落点有效 → 提交落点；
 * - 落点无效（越界 / 相交）→ 恢复到本次拖拽中最后一次有效预览位置；
 * - 与起点一致（含本次拖拽从未产生过有效移动）→ 返回 null：不提交、不产生历史记录。
 *
 * 对应验收口径「无效拖动恢复到上一次有效状态」（见 docs/project_tasks.md）。
 */
export function resolveDropCommit(
  start: Vec3,
  lastValid: Vec3,
  finalPos: Vec3,
  finalValid: boolean,
): Vec3 | null {
  const target = finalValid ? finalPos : lastValid
  return samePosition(target, start) ? null : target
}
