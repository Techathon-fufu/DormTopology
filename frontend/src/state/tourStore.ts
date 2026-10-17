import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEMO_PROJECT_ID } from '@/data/demoProject'
import { useProjectsStore } from './projectsStore'
import { usePlansStore } from './plansStore'
import { useDeliverStore } from './deliverStore'
import { useJobsStore } from './jobsStore'
import { useOrganizeStore } from './organizeStore'
import { useCableStore } from './cableStore'
import { useWorkspaceStore } from './workspaceStore'

/**
 * 「一键演示」导览状态机：
 * - 6 步固定顺序：查看凌乱桌面 → 确认识别物品 → 自动整理 → 规划走线 → 对比前后 → 查看执行指南；
 * - 步骤完成来自各页面的显式信号（signal），部分步骤另有数据检测兜底（见 DemoTour 组件）；
 * - reset() 重置内置示例项目并清空依赖旧数据的会话状态 → 可重复播放；
 * - 进度持久化（刷新页面后导览继续）；「退出导览」仅关闭面板，不重置数据。
 */

export interface DemoTourStep {
  id: string
  title: string
  /** 建议执行的操作说明 */
  hint: string
  /** 相对路由（/projects/{id}/ 之后） */
  path: string
}

export const DEMO_TOUR_STEPS: DemoTourStep[] = [
  {
    id: 'messy',
    title: '查看凌乱桌面',
    hint: '这是整理前的桌面：物品有重叠、线缆散乱（演示现状）。拖动 / 旋转视角看一看。',
    path: 'workspace',
  },
  {
    id: 'confirm-items',
    title: '确认识别物品',
    hint: '打开照片导入页核对物品清单：可直接查看「③ 3D 资产」，或运行一次模拟识别 / 失败重试流程。',
    path: 'import',
  },
  {
    id: 'organize',
    title: '自动整理',
    hint: '回到工作台点「生成整理方案」→ 预览目标布局（可播放动画 + 对比前后）→「接受方案」。',
    path: 'workspace',
  },
  {
    id: 'cables',
    title: '规划走线',
    hint: '切换到「规划走线」模式 → 点顶部「规划走线」按钮：全部线缆按路径节点重算（规则式演示）。',
    path: 'workspace',
  },
  {
    id: 'compare',
    title: '对比前后',
    hint: '选中一条线缆切换「原始 / 建议」走线（可播放收拢动画）；「空间整理」面板里可「恢复整理前状态」一键还原。',
    path: 'workspace',
  },
  {
    id: 'guide',
    title: '查看执行指南',
    hint: '打开方案交付页：按步骤执行并勾选进度、预览配件参数、导出 JSON / 截图，或打印保存 PDF 版式。',
    path: 'guide',
  },
]

interface TourState {
  active: boolean
  projectId: string | null
  stepIndex: number
  /** 已完成步骤（id → true），点击「下一步」即视为完成（演示可跳过） */
  done: Record<string, boolean>
  startedAt: number | null
  /** 激活导览（不重置数据；用于工作台内的「演示导览」入口） */
  start: (projectId?: string) => void
  /** 重置示例项目数据并从头开始（一键演示 / 重置并重播） */
  reset: () => void
  exit: () => void
  goTo: (index: number) => void
  next: () => void
  prev: () => void
  /** 页面在完成某步骤操作后发出信号（非本导览项目时忽略） */
  signal: (projectId: string, stepId: string) => void
}

export const useTourStore = create<TourState>()(
  persist(
    (set, get) => ({
      active: false,
      projectId: null,
      stepIndex: 0,
      done: {},
      startedAt: null,

      start(projectId = DEMO_PROJECT_ID) {
        set({ active: true, projectId, stepIndex: 0, done: {}, startedAt: Date.now() })
      },

      reset() {
        // 重新种入示例项目（回到凌乱状态）
        useProjectsStore.getState().resetDemo()
        // 清掉依赖旧数据的会话 / 持久状态
        usePlansStore.getState().clearProject(DEMO_PROJECT_ID)
        useDeliverStore.getState().remove(DEMO_PROJECT_ID)
        useJobsStore.getState().dropProject(DEMO_PROJECT_ID)
        useOrganizeStore.getState().closePanel()
        useCableStore.getState().resetSession()
        useWorkspaceStore.getState().resetHistory()
        useWorkspaceStore.getState().select(null)
        // 立即按全新数据采集「整理前」快照（保证「查看凌乱桌面」步骤可对比）
        const fresh = useProjectsStore.getState().projects[DEMO_PROJECT_ID]
        if (fresh) usePlansStore.getState().captureBaseline(fresh)

        set({
          active: true,
          projectId: DEMO_PROJECT_ID,
          stepIndex: 0,
          done: {},
          startedAt: Date.now(),
        })
      },

      exit() {
        set({ active: false })
      },

      goTo(index) {
        const max = DEMO_TOUR_STEPS.length - 1
        set({ stepIndex: Math.max(0, Math.min(max, index)) })
      },

      next() {
        const s = get()
        const step = DEMO_TOUR_STEPS[s.stepIndex]
        if (step) set({ done: { ...s.done, [step.id]: true } })
        get().goTo(s.stepIndex + 1)
      },

      prev() {
        get().goTo(get().stepIndex - 1)
      },

      signal(projectId, stepId) {
        const s = get()
        if (!s.active || s.projectId !== projectId) return
        if (s.done[stepId]) return
        set({ done: { ...s.done, [stepId]: true } })
      },
    }),
    { name: 'dormtopology.tour', version: 1 },
  ),
)
