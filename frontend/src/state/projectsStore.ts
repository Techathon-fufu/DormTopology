import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { OUTLET_FIXED_Y_M, type Project } from '@/types/project'
import { createDemoProject, DEMO_PROJECT_ID, DEMO_ROOM_NOTE } from '@/data/demoProject'

/**
 * 项目元数据与场景配置（localStorage 持久化）。
 * 照片与模型文件不放这里，见 src/storage/idb.ts。
 */
interface ProjectsState {
  projects: Record<string, Project>
  ensureDemo: () => void
  /** 重新种入内置示例项目（回到凌乱初始状态，供「一键演示 / 重置重播」使用） */
  resetDemo: () => void
  upsert: (project: Project) => void
  update: (id: string, updater: (p: Project) => Project) => void
  remove: (id: string) => void
}

export const useProjectsStore = create<ProjectsState>()(
  persist(
    (set, get) => ({
      projects: {},
      ensureDemo() {
        if (!get().projects[DEMO_PROJECT_ID]) {
          set((s) => ({ projects: { ...s.projects, [DEMO_PROJECT_ID]: createDemoProject() } }))
        }
      },
      resetDemo() {
        set((s) => ({
          projects: { ...s.projects, [DEMO_PROJECT_ID]: createDemoProject() },
        }))
      },
      upsert(project) {
        set((s) => ({
          projects: { ...s.projects, [project.id]: { ...project, updatedAt: Date.now() } },
        }))
      },
      update(id, updater) {
        const p = get().projects[id]
        if (!p) return
        set((s) => ({
          projects: { ...s.projects, [id]: { ...updater(p), updatedAt: Date.now() } },
        }))
      },
      remove(id) {
        if (id === DEMO_PROJECT_ID) return // 内置示例项目不可删除
        set((s) => {
          const next = { ...s.projects }
          delete next[id]
          return { projects: next }
        })
      },
    }),
    {
      name: 'dormtopology.projects',
      version: 2,
      /**
       * 0.9.0 迁移：墙面插座收敛为一块「双插孔 ×2」面板
       * （旧数据为左右两个独立插座，保留第一个插座的位置与 id）。
       */
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<ProjectsState>
        if (version < 2 && state.projects) {
          const projects: Record<string, Project> = {}
          for (const [id, p] of Object.entries(state.projects)) {
            if (!p?.room) continue
            projects[id] = {
              ...p,
              room: {
                ...p.room,
                outlets: [mergeOutletPanel(p.room.outlets?.[0])],
                note: id === DEMO_PROJECT_ID ? DEMO_ROOM_NOTE : p.room.note,
              },
            }
          }
          return { ...state, projects } as ProjectsState
        }
        return state as ProjectsState
      },
    },
  ),
)

/** 把旧的「左 / 右两个独立插座」合并为一块面板（保留第一个插座的 id 与左右位置） */
function mergeOutletPanel(first: Project['room']['outlets'][number] | undefined): Project['room']['outlets'][number] {
  return {
    id: first?.id ?? 'outlet-1',
    position: [first?.position?.[0] ?? 0, OUTLET_FIXED_Y_M, first?.position?.[2] ?? 0.01],
    label: '后墙插座（双插孔 ×2）',
    slots: 2,
  }
}

/** 页面级读取项目；确保内置示例项目存在（任意深链都能进入同一示例项目） */
export function useProject(id: string | undefined): Project | undefined {
  const ensureDemo = useProjectsStore((s) => s.ensureDemo)
  const project = useProjectsStore((s) => (id ? s.projects[id] : undefined))
  useEffect(() => {
    ensureDemo()
  }, [ensureDemo])
  return project
}

export function readProject(id: string): Project | undefined {
  return useProjectsStore.getState().projects[id]
}
