import { mockSleep } from '@/lib/mockPacing'
import { computeRuleBasedPlan } from '@/scene/ruleLayout'
import type { OrganizationPlanningService } from '../types'

/**
 * 空间整理（mock 模式）：本地「规则式演示方案」。
 *
 * 计算在浏览器内按可解释规则完成（见 src/lib/ruleLayout.ts），并用阶段等待模拟
 * 一次「方案生成」的长任务流程；结果在界面上标注「规则式演示方案 / 计算值」。
 * 真实布局 / 搬运优化算法入口保留在服务层接口 OrganizationPlanningService，
 * service 模式下由后端实现（当前为桩）。
 */
export const mockOrganizationPlanningService: OrganizationPlanningService = {
  async planOrganization({ projectId, objects, room, preferences, onProgress }) {
    onProgress?.(0.12, '读取物品包围盒')
    await mockSleep(360)
    onProgress?.(0.32, '划分三区可用容量')
    await mockSleep(400)
    const plan = computeRuleBasedPlan({ projectId, objects, room, preferences })
    onProgress?.(0.68, '按规则排序落位')
    await mockSleep(420)
    onProgress?.(0.88, '校验分界、边界与相交')
    await mockSleep(320)
    onProgress?.(1, '完成')
    return plan
  },
  async applyOrganization() {},
}
