import { apiTimeoutMs, apiUrl } from './config'
import { ApiError } from './errors'

/**
 * 统一 HTTP 客户端：JSON 与 multipart 两种请求形态共用同一套错误处理——
 * 超时 / 网络错误 / 非 2xx / JSON 格式异常 / 任务不存在（404）分类明确。
 * 不做任何重试与降级：重试由调用方（任务轮询）显式处理。
 */

export interface RequestOptions {
  method?: 'GET' | 'POST'
  /** JSON 请求体（与 form 二选一） */
  body?: unknown
  /** multipart 请求体（上传照片等） */
  form?: FormData
  timeoutMs?: number
  /** 调用方中止信号（组件卸载 / 用户取消） */
  signal?: AbortSignal
  /** 404 视为「资源 / 任务不存在」并抛出 not-found（默认 true） */
  notFoundAsMissing?: boolean
}

/** 从错误响应体提取可读细节（后端可能返回 {detail} / {message} / {error}） */
function extractDetail(text: string): string | undefined {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  try {
    const data = JSON.parse(trimmed) as Record<string, unknown>
    const msg = data.detail ?? data.message ?? data.error
    if (typeof msg === 'string' && msg) return msg
  } catch {
    /* 非 JSON：按原文截断展示 */
  }
  return trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed
}

async function doFetch(
  path: string,
  opts: RequestOptions,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Response> {
  const url = apiUrl(path)
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort)

  const headers: Record<string, string> = {}
  let payload: BodyInit | undefined
  if (opts.form) {
    payload = opts.form
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(opts.body)
  }

  try {
    return await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: payload,
      signal: controller.signal,
    })
  } catch (err) {
    if (signal?.aborted) {
      throw new ApiError('请求已取消', { kind: 'aborted', path: url })
    }
    if (timedOut) {
      throw new ApiError(`请求超时（超过 ${Math.round(timeoutMs / 1000)} 秒未响应），后端可能不可用`, {
        kind: 'timeout',
        path: url,
      })
    }
    throw new ApiError('无法连接后端服务：网络不可达或后端未启动（可切换到演示模式继续体验）', {
      kind: 'network',
      path: url,
      detail: err instanceof Error ? err.message : String(err),
    })
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

async function parseResponse<T>(res: Response, url: string, notFoundAsMissing: boolean): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    const detail = extractDetail(text)
    if (res.status === 404 && notFoundAsMissing) {
      throw new ApiError('任务或资源不存在（可能已过期，或后端已重启）', {
        kind: 'not-found',
        status: 404,
        path: url,
        detail,
      })
    }
    throw new ApiError(`后端请求失败（HTTP ${res.status}）${detail ? `：${detail}` : ''}`, {
      kind: 'http',
      status: res.status,
      path: url,
      detail,
    })
  }
  try {
    return (await res.json()) as T
  } catch (err) {
    throw new ApiError('后端响应不是有效 JSON（可能被代理 / 网关改写）', {
      kind: 'malformed',
      path: url,
      detail: err instanceof Error ? err.message : String(err),
    })
  }
}

/** JSON 请求（GET / POST），失败抛分类明确的 ApiError */
export async function requestJson<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? apiTimeoutMs
  const res = await doFetch(path, opts, timeoutMs, opts.signal)
  return parseResponse<T>(res, apiUrl(path), opts.notFoundAsMissing ?? true)
}

/** multipart 请求（上传照片等）；默认 POST */
export async function requestMultipart<T>(
  path: string,
  form: FormData,
  opts: Omit<RequestOptions, 'body' | 'form'> = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? apiTimeoutMs
  const res = await doFetch(path, { ...opts, method: opts.method ?? 'POST', form }, timeoutMs, opts.signal)
  return parseResponse<T>(res, apiUrl(path), opts.notFoundAsMissing ?? true)
}
