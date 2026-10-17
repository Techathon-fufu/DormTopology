/**
 * 统一 API 错误：所有真实后端调用失败都必须归入以下分类之一，
 * 界面上给出可读原因，绝不静默降级为「成功」。
 */

export type ApiErrorKind =
  /** 连接失败 / 断网 / 后端未启动 */
  | 'network'
  /** 请求超时 */
  | 'timeout'
  /** 非 2xx 响应 */
  | 'http'
  /** 本地场景与后端版本无法安全自动合并 */
  | 'conflict'
  /** 响应不是有效 JSON，或结构不符合约定 */
  | 'malformed'
  /** 资源 / 任务不存在（404、已过期、后端重启） */
  | 'not-found'
  /** 后端任务失败（status=failed） */
  | 'job'
  /** 请求前置条件不满足（如未选择照片） */
  | 'input'
  /** 用户主动取消 */
  | 'cancelled'
  /** 调用方中止（组件卸载等），一般不作为错误展示 */
  | 'aborted'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number
  /** 请求的完整地址（用于排查） */
  readonly path?: string
  /** 后端返回的原始细节（可能是 JSON 中的 detail/message 字段） */
  readonly detail?: string
  readonly jobId?: string

  constructor(
    message: string,
    opts: { kind: ApiErrorKind; status?: number; path?: string; detail?: string; jobId?: string },
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = opts.kind
    this.status = opts.status
    this.path = opts.path
    this.detail = opts.detail
    this.jobId = opts.jobId
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError
}

/** 把任意错误收敛为面向用户的一句话（保留真实原因，不吞错） */
export function describeApiError(e: unknown): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error) return e.message
  return String(e)
}

/** 该错误是否值得展示「切换到演示模式」入口（真实模式下的服务/网络类失败） */
export function isServiceFailure(e: unknown): boolean {
  if (!isApiError(e)) return e instanceof Error
  return e.kind !== 'aborted' && e.kind !== 'input'
}
