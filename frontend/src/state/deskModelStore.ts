import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DORM_DESK_MODEL_CONFIG,
  resolvePublicAssetUrl,
  type DeskSurfaceMetrics,
} from '@/scene/deskModel'

/**
 * 桌体模型（GLB）加载状态与显示偏好。
 *
 * - 会话状态（status / error / metrics / retryNonce）为派生状态：刷新后重新加载并重算；
 * - 用户偏好（showDesk）持久化到 localStorage（dormtopology.desk-model，刷新恢复）。
 */
export type DeskModelStatus = 'idle' | 'loading' | 'loaded' | 'failed'

interface DeskModelState {
  /** 桌体总开关（工具栏）：隐藏时 GLB 与简化几何都不渲染 */
  showDesk: boolean
  status: DeskModelStatus
  /** 失败原因（已转为可读提示） */
  error: string | null
  /** 重试计数：递增触发组件重新加载（重试 / 从简化几何恢复） */
  retryNonce: number
  /** 模型实测支撑面（拖拽 / 校验 / 吸附使用；null = 按 RoomConfig 计算） */
  metrics: DeskSurfaceMetrics | null
  /** 解析后的模型资源路径（dev 与构建后均正确） */
  modelUrl: string
  setShowDesk: (visible: boolean) => void
  /** 重新尝试加载 GLB（失败重试 / 从简化几何恢复） */
  retry: () => void
  beginLoad: () => void
  loadSucceeded: (metrics: DeskSurfaceMetrics) => void
  loadFailed: (message: string) => void
}

export const useDeskModelStore = create<DeskModelState>()(
  persist(
    (set) => ({
      showDesk: true,
      status: 'idle',
      error: null,
      retryNonce: 0,
      metrics: null,
      modelUrl: resolvePublicAssetUrl(DORM_DESK_MODEL_CONFIG.url),
      setShowDesk: (visible) => set({ showDesk: visible }),
      retry: () =>
        set((s) => ({ status: 'idle', error: null, retryNonce: s.retryNonce + 1 })),
      beginLoad: () => set({ status: 'loading', error: null }),
      loadSucceeded: (metrics) => set({ status: 'loaded', error: null, metrics }),
      loadFailed: (message) => set({ status: 'failed', error: message, metrics: null }),
    }),
    {
      name: 'dormtopology.desk-model',
      version: 2,
      migrate: (persisted) => ({ showDesk: (persisted as { showDesk?: boolean })?.showDesk ?? true }),
      // 只持久化用户偏好；会话状态 / 实测指标刷新后重新计算
      partialize: (s) => ({ showDesk: s.showDesk }),
    },
  ),
)
