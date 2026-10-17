import { useEffect } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Project } from '@/types/project'
import { createDemoProject, DEMO_PROJECT_ID, DEMO_SEED_VERSION } from '@/data/demoProject'
import { cableRoutingObjectsSignature, invalidateCableRoutes } from '@/scene/cables'
import { resolveOrganizationPreferences } from '@/types/organization'
import { useCableStore } from './cableStore'

/**
 * 项目元数据与场景配置（localStorage 持久化）。
 * 照片与模型文件不放这里，见 src/storage/idb.ts。
 *
 * 两层版本，职责不同，不要混用：
 * - `PROJECTS_PERSIST_VERSION`：持久化 schema 版本。字段结构变化时 +1，并用 migrate 转换旧数据。
 * - `DEMO_SEED_VERSION`：内置示例项目的数据版本。示例场景内容变化时 +1，由 ensureDemo 重种。
 */
const PROJECTS_PERSIST_VERSION = 2

/** 内置示例项目是否需要按最新示例数据重种 */
export function isDemoProjectStale(project: Project | undefined): boolean {
  if (!project || project.id !== DEMO_PROJECT_ID) return false
  return (project.demoSeedVersion ?? 0) < DEMO_SEED_VERSION
}

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
        const existing = get().projects[DEMO_PROJECT_ID]
        // 不存在，或仍是旧种子版本的示例场景：按最新示例数据重种。
        // 仅作用于内置示例项目，用户自建项目不受影响。
        if (!existing || isDemoProjectStale(existing)) {
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
        const next = updater(p)
        const routingChanged = JSON.stringify(p.room) !== JSON.stringify(next.room)
          || JSON.stringify(resolveOrganizationPreferences(p)) !== JSON.stringify(resolveOrganizationPreferences(next))
          || cableRoutingObjectsSignature(p.objects) !== cableRoutingObjectsSignature(next.objects)
        if (routingChanged) useCableStore.getState().resetAnim()
        set((s) => ({
          projects: { ...s.projects, [id]: { ...next,
            cables: routingChanged ? invalidateCableRoutes(next.cables) : next.cables,
            updatedAt: Date.now() } },
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
      version: PROJECTS_PERSIST_VERSION,
      /**
       * v1 → v2：早期版本把示例场景写进了本地存储，示例数据更新后不会自动生效。
       * 迁移时仅按最新示例数据重种内置示例项目；用户自建项目原样保留（补默认种子版本除外）。
       */
      migrate: (persisted, from) => {
        const state = persisted as Partial<ProjectsState> | undefined
        if (!state?.projects) return persisted as ProjectsState
        const projects = { ...state.projects }
        if (from < PROJECTS_PERSIST_VERSION && isDemoProjectStale(projects[DEMO_PROJECT_ID])) {
          projects[DEMO_PROJECT_ID] = createDemoProject()
        }
        return { ...state, projects } as ProjectsState
      },
    },
  ),
)

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
