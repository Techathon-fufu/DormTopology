import { requestJson } from './client'

/**
 * 后端健康检查：GET /api/v1/health（短超时）。
 * 返回结构约定：{ "status": "ok" | "degraded", "version"?: string }
 * 无法识别结构时按 degraded 处理并保留原始信息，不与 ok 混淆。
 */

export interface BackendHealth {
  status: 'ok' | 'degraded'
  version?: string
  detail?: string
}

export async function checkBackendHealth(signal?: AbortSignal): Promise<BackendHealth> {
  const data = await requestJson<Record<string, unknown>>('/health', { timeoutMs: 5000, signal })
  const version = typeof data.version === 'string' && data.version ? data.version : undefined
  if (data.status === 'ok') return { status: 'ok', version }
  if (data.status === 'degraded') {
    return {
      status: 'degraded',
      version,
      detail: typeof data.detail === 'string' ? data.detail : '后端自报状态 degraded',
    }
  }
  return {
    status: 'degraded',
    version,
    detail: `健康检查响应无法识别（status=${String(data.status)}）`,
  }
}
