import type { Project, Vec3 } from '@/types/project'
import { cableDisplayPoints, hasUsableCableRoute } from '@/scene/cables'
import { sampleCurve } from '@/scene/cableRoute'
import { useCableStore } from '@/state/cableStore'
import { useTourStore } from '@/state/tourStore'

/**
 * 播放「收拢动画」：全部已有「原始走线」快照的线缆从原始路径过渡到当前（建议）路径。
 * 左右面板共用同一入口，行为一致：
 * - 无可对比线缆（尚未规划过走线）→ 返回 false 并给出提示；
 * - 播放时切换到「建议」视图，并发出导览「对比前后」信号（可跳过动画，点「下一步」即视为完成）；
 * - 动画仅用于展示（展示口径见线缆面板就地说明），不代表真实收拢过程经过验证。
 */
export function startCollectAnim(project: Project, onFlash: (msg: string) => void): boolean {
  const from: Record<string, Vec3[]> = {}
  for (const cable of project.cables) {
    if (!cable.originalRoute || !hasUsableCableRoute(cable)) continue
    const points = cableDisplayPoints(cable, project.objects, 'original')
    from[cable.id] = sampleCurve(points, 48)
  }
  if (Object.keys(from).length === 0) {
    onFlash('暂无有效的建议走线可对比，请先完成走线规划与检查')
    return false
  }
  useCableStore.getState().setRouteView('suggested')
  useCableStore.getState().startAnim(from)
  useTourStore.getState().signal(project.id, 'compare')
  return true
}
