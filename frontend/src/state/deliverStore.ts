import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AccessoryParams } from '@/scene/accessoryGeometry'

/**
 * 方案交付页（执行指南）的会话状态：
 * - 按项目记录「指南基准版本」（stamp）+ 生成时间 + 勾选进度 + 配件预览参数；
 * - stamp 来自 @/lib/guide.ts 的 guideStampOf：与当前项目数据不一致时提示「重新生成」；
 * - 勾选进度按步骤 id 记录（步骤 id 由方案数据推导，方案变化后旧 id 自然失效）。
 */
export interface DeliverEntry {
  /** 生成指南时的方案指纹（guideStampOf 结果） */
  stamp: string
  /** 用户点「重新生成」或首次进入的时间戳 */
  generatedAt: number
  /** 已完成步骤 id */
  checked: string[]
  /** 配件参数预览的当前参数 */
  accessory: AccessoryParams
}

interface DeliverState {
  byProject: Record<string, DeliverEntry>
  /** 首次进入：无记录时创建（记录当前 stamp 为基准版本） */
  ensure: (projectId: string, stamp: string, defaults: AccessoryParams) => void
  /** 重新生成：更新基准版本与生成时间，保留勾选与配件参数 */
  regenerate: (projectId: string, stamp: string, defaults: AccessoryParams) => void
  toggleStep: (projectId: string, stepId: string) => void
  clearChecked: (projectId: string) => void
  /** 更新配件参数（无记录时按当前 stamp 创建） */
  setAccessory: (
    projectId: string,
    stamp: string,
    defaults: AccessoryParams,
    patch: Partial<AccessoryParams>,
  ) => void
}

export const useDeliverStore = create<DeliverState>()(
  persist(
    (set, get) => ({
      byProject: {},

      ensure(projectId, stamp, defaults) {
        if (get().byProject[projectId]) return
        set((s) => ({
          byProject: {
            ...s.byProject,
            [projectId]: { stamp, generatedAt: Date.now(), checked: [], accessory: defaults },
          },
        }))
      },

      regenerate(projectId, stamp, defaults) {
        set((s) => {
          const prev = s.byProject[projectId]
          return {
            byProject: {
              ...s.byProject,
              [projectId]: {
                stamp,
                generatedAt: Date.now(),
                checked: prev?.checked ?? [],
                accessory: prev?.accessory ?? defaults,
              },
            },
          }
        })
      },

      toggleStep(projectId, stepId) {
        set((s) => {
          const prev = s.byProject[projectId]
          if (!prev) return s
          const checked = prev.checked.includes(stepId)
            ? prev.checked.filter((v) => v !== stepId)
            : [...prev.checked, stepId]
          return { byProject: { ...s.byProject, [projectId]: { ...prev, checked } } }
        })
      },

      clearChecked(projectId) {
        set((s) => {
          const prev = s.byProject[projectId]
          if (!prev) return s
          return { byProject: { ...s.byProject, [projectId]: { ...prev, checked: [] } } }
        })
      },

      setAccessory(projectId, stamp, defaults, patch) {
        set((s) => {
          const prev = s.byProject[projectId]
          const entry: DeliverEntry = prev ?? {
            stamp,
            generatedAt: Date.now(),
            checked: [],
            accessory: defaults,
          }
          return {
            byProject: {
              ...s.byProject,
              [projectId]: { ...entry, accessory: { ...entry.accessory, ...patch } },
            },
          }
        })
      },
    }),
    { name: 'dormtopology.deliver', version: 1 },
  ),
)
