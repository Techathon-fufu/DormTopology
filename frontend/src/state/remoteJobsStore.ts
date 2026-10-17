import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RemoteCapability } from '@/api/core/wire'

/**
 * 真实后端长任务登记表（持久化到 localStorage `dormtopology.remote-jobs`）。
 *
 * 只保存任务号、状态、进度、算法版本与请求参数摘要等小体量元数据；
 * 不保存任务结果载荷。刷新页面后可据此继续查询状态（见 api/core/jobs.ts 的
 * refreshActiveRemoteJobs，由 ui/service/ApiRuntime 周期调用）。
 */

export type RemoteJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export const REMOTE_JOB_TERMINAL: RemoteJobStatus[] = ['succeeded', 'failed', 'cancelled']
export const REMOTE_JOB_ACTIVE: RemoteJobStatus[] = ['queued', 'running']

export interface RemoteJobRecord {
  /** 服务端 job_id（唯一，直接作为主键） */
  id: string
  projectId: string
  capability: RemoteCapability
  /** 界面展示名（如「走线规划（真实后端）」） */
  label: string
  status: RemoteJobStatus
  /** 0 ~ 1（后端提供时才有） */
  progress?: number
  stage?: string
  /** 终态失败原因 */
  error?: string
  /** 最近一次状态查询失败（非终态错误；成功后清除） */
  lastQueryError?: string
  /** 算法版本（整理 / 走线等任务的服务端回报；需求要求的留痕字段） */
  algorithmVersion?: string
  /** 请求参数摘要（数量 / 偏好等；不含任何密钥，前端也没有密钥） */
  requestSummary?: Record<string, unknown>
  /** 轮询发现成功时记录的结果摘要（不存完整结果） */
  resultSummary?: string
  /** 服务端创建时间（ISO），缺省为本地提交时间 */
  createdAt: string
  /** 本地提交时间 */
  submittedAt: number
  updatedAt: number
}

interface RemoteJobsState {
  records: RemoteJobRecord[]
  upsert: (record: RemoteJobRecord) => void
  patch: (id: string, patch: Partial<RemoteJobRecord>) => void
  remove: (id: string) => void
  /** 清除终态记录（指定项目时只清该项目） */
  clearFinished: (projectId?: string) => void
}

const MAX_RECORDS = 30

export const useRemoteJobsStore = create<RemoteJobsState>()(
  persist(
    (set) => ({
      records: [],
      upsert: (record) =>
        set((s) => {
          const rest = s.records.filter((r) => r.id !== record.id)
          return { records: [record, ...rest].slice(0, MAX_RECORDS) }
        }),
      patch: (id, patch) =>
        set((s) => ({
          records: s.records.map((r) => (r.id === id ? { ...r, ...patch, updatedAt: Date.now() } : r)),
        })),
      remove: (id) => set((s) => ({ records: s.records.filter((r) => r.id !== id) })),
      clearFinished: (projectId) =>
        set((s) => ({
          records: s.records.filter((r) => {
            if (projectId && r.projectId !== projectId) return true
            return !REMOTE_JOB_TERMINAL.includes(r.status)
          }),
        })),
    }),
    {
      name: 'dormtopology.remote-jobs',
      version: 1,
      partialize: (s) => ({ records: s.records }),
    },
  ),
)
