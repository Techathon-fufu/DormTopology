import { create } from 'zustand'
import { checkBackendHealth } from '@/api/core/health'

/**
 * 后端连接状态（会话级，不持久化）：真实模式下由 ui/service/ApiRuntime
 * 在挂载 / 定时 / 网络恢复时刷新；刷新页面后自动重新检测。
 */

export type ApiHealthStatus = 'unknown' | 'checking' | 'ok' | 'degraded' | 'down'

interface ApiHealthState {
  status: ApiHealthStatus
  detail?: string
  backendVersion?: string
  checkedAt?: number
  setChecking: () => void
  setResult: (r: { status: Exclude<ApiHealthStatus, 'unknown' | 'checking'>; detail?: string; backendVersion?: string }) => void
}

export const useApiHealthStore = create<ApiHealthState>()((set) => ({
  status: 'unknown',
  detail: undefined,
  backendVersion: undefined,
  checkedAt: undefined,
  setChecking: () => set({ status: 'checking' }),
  setResult: (r) =>
    set({ status: r.status, detail: r.detail, backendVersion: r.backendVersion, checkedAt: Date.now() }),
}))

export const API_HEALTH_LABELS: Record<ApiHealthStatus, string> = {
  unknown: '未检测',
  checking: '检测中…',
  ok: '后端在线',
  degraded: '后端异常',
  down: '后端离线',
}

/**
 * 执行一次健康检查并写入状态（供 ApiRuntime 定时调用与界面「重新检测」按钮共用）。
 * 失败不抛错：记录 down 与真实原因。
 */
export async function runHealthCheck(signal?: AbortSignal): Promise<void> {
  useApiHealthStore.getState().setChecking()
  try {
    const r = await checkBackendHealth(signal)
    useApiHealthStore.getState().setResult({
      status: r.status,
      detail: r.detail,
      backendVersion: r.version,
    })
  } catch (err) {
    if (signal?.aborted) return
    useApiHealthStore.getState().setResult({
      status: 'down',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}
