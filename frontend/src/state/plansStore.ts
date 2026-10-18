import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { recordStorage } from './recordStorage'
import type { LayoutPlan, Project } from '@/types/project'
import { duplicatePlan, planFromProject } from '@/lib/plans'
import { invalidateCableRoutes } from '@/scene/cables'
import { useProjectsStore } from './projectsStore'
import { useWorkspaceStore } from './workspaceStore'
import { useCableStore } from './cableStore'
import { repairDuplicatePortIds } from '@/scene/portIds'

/**
 * 布局方案仓库：
 * - baselines：整理前状态快照（独立于当前方案保存）
 * - candidates：对比用方案（「保存方案」生成，0.8.0 起携带完整场景 / 线缆快照）
 * 当前方案实时保存在 Project.objects（projectsStore）。
 *
 * 持久化版本：v1（仅物品指派）→ v2（updatedAt / 场景快照 / 来源）→ v3（接口 ID 去重修复）。
 * v1 数据迁移时仅补齐 updatedAt，其余字段保持缺失（界面按「旧版本方案」展示，不丢数据）。
 */
interface PlansState {
  baselines: Record<string, LayoutPlan>
  candidates: Record<string, LayoutPlan[]>
  captureBaseline: (project: Project) => void
  recaptureBaseline: (project: Project) => void
  saveCandidate: (project: Project, name?: string) => LayoutPlan
  /** 重命名候选方案（空名称忽略；更新时间一并刷新） */
  renameCandidate: (projectId: string, planId: string, name: string) => void
  /** 复制候选方案（含场景快照深拷贝）；返回新方案 */
  duplicateCandidate: (projectId: string, planId: string) => LayoutPlan | null
  removeCandidate: (projectId: string, planId: string) => void
  /** 清空项目的整理前快照与候选方案（演示重置 / 删除项目时使用） */
  clearProject: (projectId: string) => void
  archiveProjectRecords: (projectId: string, archiveId: string) => void
}

/** v1 → v2：为缺少 updatedAt 的方案补默认值（保持其余字段不动） */
function migratePlan(plan: LayoutPlan): LayoutPlan {
  return { ...plan, updatedAt: plan.updatedAt ?? plan.createdAt }
}

export const usePlansStore = create<PlansState>()(
  persist(
    (set, get) => ({
      baselines: {},
      candidates: {},
      archiveProjectRecords(projectId, archiveId) {
        const remap = (plan: LayoutPlan): LayoutPlan => ({ ...structuredClone(plan), projectId: archiveId,
          ...(plan.scene ? { scene: { ...structuredClone(plan.scene),
            objects: plan.scene.objects.map((o) => ({ ...structuredClone(o), projectId: archiveId })),
            cables: plan.scene.cables.map((c) => ({ ...structuredClone(c), projectId: archiveId })),
          } } : {}),
        })
        set((s) => {
          const baselines = { ...s.baselines }, candidates = { ...s.candidates }
          if (baselines[projectId]) baselines[archiveId] = remap(baselines[projectId])
          if (candidates[projectId]) candidates[archiveId] = candidates[projectId].map(remap)
          delete baselines[projectId]
          delete candidates[projectId]
          return { baselines, candidates }
        })
      },
      captureBaseline(project) {
        if (get().baselines[project.id]) return
        set((s) => ({
          baselines: {
            ...s.baselines,
            [project.id]: planFromProject(project, 'baseline', '整理前状态', { withScene: true }),
          },
        }))
      },
      recaptureBaseline(project) {
        const current = useProjectsStore.getState().projects[project.id] ?? project
        const next = { ...current, cables: invalidateCableRoutes(current.cables) }
        // A new baseline changes the formal scene version even when geometry stays unchanged.
        useProjectsStore.getState().update(project.id, () => next)
        useCableStore.getState().resetAnim()
        useWorkspaceStore.getState().resetHistory()
        set((s) => ({
          baselines: {
            ...s.baselines,
            [project.id]: planFromProject(next, 'baseline', '整理前状态（重新采集）', { withScene: true }),
          },
        }))
      },
      saveCandidate(project, name) {
        const plan = planFromProject(
          project,
          'candidate',
          name ??
            `方案 ${new Date().toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit',
            })}`,
        )
        set((s) => ({
          candidates: {
            ...s.candidates,
            [project.id]: [...(s.candidates[project.id] ?? []), plan],
          },
        }))
        return plan
      },
      renameCandidate(projectId, planId, name) {
        const trimmed = name.trim()
        if (!trimmed) return
        set((s) => ({
          candidates: {
            ...s.candidates,
            [projectId]: (s.candidates[projectId] ?? []).map((p) =>
              p.id === planId ? { ...p, name: trimmed, updatedAt: Date.now() } : p,
            ),
          },
        }))
      },
      duplicateCandidate(projectId, planId) {
        const source = (get().candidates[projectId] ?? []).find((p) => p.id === planId)
        if (!source) return null
        const copy = duplicatePlan(source, `${source.name} 副本`)
        set((s) => ({
          candidates: {
            ...s.candidates,
            [projectId]: [...(s.candidates[projectId] ?? []), copy],
          },
        }))
        return copy
      },
      removeCandidate(projectId, planId) {
        set((s) => ({
          candidates: {
            ...s.candidates,
            [projectId]: (s.candidates[projectId] ?? []).filter((p) => p.id !== planId),
          },
        }))
      },
      clearProject(projectId) {
        set((s) => {
          const baselines = { ...s.baselines }
          const candidates = { ...s.candidates }
          delete baselines[projectId]
          delete candidates[projectId]
          return { baselines, candidates }
        })
      },
    }),
    {
      name: 'dormtopology.plans',
      storage: createJSONStorage(() => recordStorage(['baselines', 'candidates'])),
      version: 3,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<PlansState>
        if (version < 2) {
          const baselines: Record<string, LayoutPlan> = {}
          for (const [projectId, plan] of Object.entries(state.baselines ?? {})) {
            if (plan) baselines[projectId] = migratePlan(plan)
          }
          const candidates: Record<string, LayoutPlan[]> = {}
          for (const [projectId, plans] of Object.entries(state.candidates ?? {})) {
            if (plans) candidates[projectId] = plans.map(migratePlan)
          }
          state.baselines = baselines
          state.candidates = candidates
        }
        if (version < 3) {
          const repair = (plan: LayoutPlan): LayoutPlan => {
            if (!plan.scene) return plan
            const scene = repairDuplicatePortIds(plan.scene)
            return scene === plan.scene ? plan : { ...plan, scene }
          }
          return { ...state,
            baselines: Object.fromEntries(Object.entries(state.baselines ?? {}).map(([id, plan]) => [id, repair(plan)])),
            candidates: Object.fromEntries(Object.entries(state.candidates ?? {}).map(([id, plans]) => [id, plans.map(repair)])),
          } as PlansState
        }
        return state as PlansState
      },
    },
  ),
)
