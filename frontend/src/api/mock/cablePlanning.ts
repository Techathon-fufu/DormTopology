import { mockSleep } from '@/lib/mockPacing'
import { planCableRoute } from '@/scene/cableRoute'
import { validateCableConnection } from '@/scene/cables'
import { computeCableAvoidZones } from '@/scene/routeNodes'
import { CABLE_VISIBILITY_META } from '@/types/project'
import type { CableConnection } from '@/types/project'
import type { CablePlanningService, CablePlanningResult } from '../types'

/**
 * 模拟走线规划：本地「规则式演示规划」。
 *
 * 流程（分阶段延时，不伪造精确百分比阶段之外的进度）：
 * 1. 收集避让区（打字活动区 / 水杯活动区 / 桌下腿部活动区）；
 * 2. 对每条目标线缆：按线材类型（可见线 = 出线槽策略 / 隐藏线 = 背板后策略）
 *    在候选节点链（桌边 / 桌底 / 背板 / 桌腿 / 出线孔 / 地面）中挑选第一条通过
 *    「连接、线长、平滑采样障碍与弯曲检查」的路径；
 * 3. 首次规划时把规划前的走线留存为「原始走线」快照（用于对比与收拢动画）；
 * 4. 全部候选失败 → 标记 conflict 并附具体问题（用户可调整路径节点）。
 *
 * 线缆之间允许共线 / 交叠，不做线径和间距检查。
 * 重要：结果为演示数据，未经过真实算法验证（algorithmVerified 恒为 false）。
 */
export const mockCablePlanningService: CablePlanningService = {
  async planCables({ objects, room, cables, targetIds, preferences, onProgress }) {
    onProgress?.(0.08, '收集避让区与路径节点')
    await mockSleep(320)

    const avoidZones = computeCableAvoidZones(room, preferences)
    const targets = targetIds && targetIds.length > 0
      ? cables.filter((c) => targetIds.includes(c.id))
      : cables

    if (targets.length === 0) {
      throw new Error('当前没有可规划的线缆：请先在「设备与接口」中选择两个接口建立连接。')
    }

    const updated: CableConnection[] = []
    let plannedCount = 0
    let conflictCount = 0

    for (let i = 0; i < targets.length; i += 1) {
      const cable = targets[i]
      onProgress?.(0.15 + 0.7 * (i / targets.length), `规划走线 ${i + 1}/${targets.length}`)
      await mockSleep(220)

      const fromObject = objects.find((o) => o.id === cable.from.objectId)
      const toObject = objects.find((o) => o.id === cable.to.objectId)
      const connection = validateCableConnection({ objects, cables }, cable.from, cable.to, { excludeCableId: cable.id, kind: cable.kind })
      if (!fromObject || !toObject || !connection.ok) {
        conflictCount += 1
        const { verification: _verification, pathLengthM: _pathLengthM, ...route } = cable.route
        updated.push({
          ...cable,
          route,
          status: 'conflict',
          planSource: 'demo-rule',
          note: !connection.ok ? connection.reason : '端点设备已删除，无法规划路径（请重新建立连接）',
          updatedAt: Date.now(),
        })
        continue
      }

      const result = planCableRoute(cable, objects, room, avoidZones, cables)
      const originalRoute = cable.originalRoute
        ? cable.originalRoute
        : {
            channels: [...cable.route.channels],
            points: cable.route.points.map((p) => [p[0], p[1], p[2]] as [number, number, number]),
          }

      if (result.ok) {
        plannedCount += 1
        const nodeSummary = result.route.nodeIds.filter(Boolean).length
        const visLabel = CABLE_VISIBILITY_META[result.visibility].label
        updated.push({
          ...cable,
          route: {
            channels: result.route.channels,
            points: result.route.points,
            nodeIds: result.route.nodeIds,
            smooth: true,
            strategy: result.strategy,
          },
          originalRoute,
          status: 'planned',
          planSource: 'demo-rule',
          note:
            nodeSummary > 0
              ? `演示规划（${visLabel}）：沿 ${nodeSummary} 个场景路径节点走线（未经真实算法验证）`
              : `演示规划（${visLabel}）：就近直连（未经真实算法验证）`,
          updatedAt: Date.now(),
        })
      } else {
        conflictCount += 1
        const firstIssue = result.issues[0]?.message ?? '未知障碍'
        const visLabel = CABLE_VISIBILITY_META[result.visibility].label
        updated.push({
          ...cable,
          route: {
            channels: result.route.channels,
            points: result.route.points,
            nodeIds: result.route.nodeIds,
            smooth: true,
            strategy: result.strategy,
          },
          originalRoute,
          status: 'conflict',
          planSource: 'demo-rule',
          note: `${visLabel}演示路径未通过检查：${firstIssue}（共 ${result.issues.length} 处，请检查连接、线长或路径节点）`,
          updatedAt: Date.now(),
        })
      }
    }

    onProgress?.(0.92, '汇总路径检查结果')
    await mockSleep(260)
    onProgress?.(1, '完成')

    const result: CablePlanningResult = {
      cables: updated,
      plannedCount,
      conflictCount,
      algorithmVerified: false,
      notes: [
        '路径为规则式演示规划，平滑曲线仅用于显示，未经过真实算法验证。',
        '避让结论来自本地采样几何检查（含线径扫掠），不是真实寻路算法。',
        ...(targets.some((c) => c.actualLengthM === undefined) ? ['部分线缆未填写实际线长，尚未验证长度是否足够。'] : []),
        '线径净空与弯曲半径只经过本地采样检查；连续曲线与支撑可行性需要真实后端验证。',
      ],
    }
    return result
  },
}
