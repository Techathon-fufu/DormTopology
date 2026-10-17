import { create } from 'zustand'
import { uid } from '@/lib/utils'
import type { GenerationJob, JobType } from '@/types/project'

type NewJobInput = Pick<GenerationJob, 'projectId' | 'type' | 'title'> &
  Partial<Pick<GenerationJob, 'itemIds' | 'mock' | 'retryOf' | 'stageLabel'>>

/** 长耗时任务队列（会话级，不持久化）：识别 / 模型生成 / 布局规划 / 走线规划 */
interface JobsState {
  jobs: GenerationJob[]
  create: (input: NewJobInput) => GenerationJob
  update: (id: string, patch: Partial<GenerationJob>) => void
  remove: (id: string) => void
  clearFinished: (projectId: string) => void
  /** 删除项目的全部任务记录（演示重置时使用） */
  dropProject: (projectId: string) => void
}

export const useJobsStore = create<JobsState>()((set) => ({
  jobs: [],
  create(input) {
    const job: GenerationJob = {
      id: uid('job'),
      projectId: input.projectId,
      type: input.type as JobType,
      status: 'queued',
      progress: 0,
      title: input.title,
      itemIds: input.itemIds,
      mock: input.mock ?? true,
      retryOf: input.retryOf,
      stageLabel: input.stageLabel,
      attempts: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    set((s) => ({ jobs: [job, ...s.jobs].slice(0, 30) }))
    return job
  },
  update(id, patch) {
    set((s) => ({
      jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch, updatedAt: Date.now() } : j)),
    }))
  },
  remove(id) {
    set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) }))
  },
  clearFinished(projectId) {
    set((s) => ({
      jobs: s.jobs.filter(
        (j) =>
          j.projectId !== projectId ||
          !['success', 'failed', 'partial', 'canceled'].includes(j.status),
      ),
    }))
  },
  dropProject(projectId) {
    set((s) => ({ jobs: s.jobs.filter((j) => j.projectId !== projectId) }))
  },
}))

export function useProjectJobs(projectId: string | undefined): GenerationJob[] {
  return useJobsStore((s) => (projectId ? s.jobs.filter((j) => j.projectId === projectId) : []))
}

export function getJobs(): GenerationJob[] {
  return useJobsStore.getState().jobs
}
