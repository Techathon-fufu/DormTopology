import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LayoutPlan, Project } from '@/types/project'
import { planFromProject } from '@/lib/plans'

/**
 * 布局方案仓库：
 * - baselines：整理前状态快照（独立于当前方案保存）
 * - candidates：对比用方案（「保存方案」生成，供后续方案对比使用）
 * 当前方案实时保存在 Project.objects（projectsStore）。
 */
interface PlansState {
  baselines: Record<string, LayoutPlan>
  candidates: Record<string, LayoutPlan[]>
  captureBaseline: (project: Project) => void
  recaptureBaseline: (project: Project) => void
  saveCandidate: (project: Project, name?: string) => LayoutPlan
  removeCandidate: (projectId: string, planId: string) => void
  /** 清空项目的整理前快照与候选方案（演示重置 / 删除项目时使用） */
  clearProject: (projectId: string) => void
}

export const usePlansStore = create<PlansState>()(
  persist(
    (set, get) => ({
      baselines: {},
      candidates: {},
      captureBaseline(project) {
        if (get().baselines[project.id]) return
        set((s) => ({
          baselines: {
            ...s.baselines,
            [project.id]: planFromProject(project, 'baseline', '整理前状态'),
          },
        }))
      },
      recaptureBaseline(project) {
        set((s) => ({
          baselines: {
            ...s.baselines,
            [project.id]: planFromProject(project, 'baseline', '整理前状态（重新采集）'),
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
    { name: 'dormtopology.plans', version: 1 },
  ),
)
