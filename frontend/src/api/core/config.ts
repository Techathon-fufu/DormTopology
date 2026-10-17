/**
 * 供应商能力与后端连接配置（服务适配层唯一配置入口）。
 *
 * - 整理与走线始终请求应用后端，旧规划模式变量和浏览器覆盖不再生效。
 * - `VITE_API_MODE=mock`（默认）：识别与模型生成使用明确标注的模拟结果。
 * - `VITE_API_MODE=real`：识别与模型生成也调用应用后端。
 * - 兼容旧变量：`VITE_SERVICE_MODE=mock|service`（service 等价 real）；两者同时存在时 VITE_API_MODE 优先
 * - 第三方密钥（Rodin 等）只允许存在于后端；前端不读取、不存储任何密钥
 */

export type ApiMode = 'mock' | 'real'

function readEnvMode(): ApiMode {
  const raw =
    (import.meta.env.VITE_API_MODE as string | undefined) ??
    (import.meta.env.VITE_SERVICE_MODE as string | undefined)
  return raw === 'real' || raw === 'service' ? 'real' : 'mock'
}

/** 构建时环境变量指定的模式（不随运行时切换变化） */
export const envApiMode: ApiMode = readEnvMode()

/** 仅控制识别和模型生成；不读取旧浏览器模式偏好。 */
export const resolvedApiMode: ApiMode = envApiMode

/** 后端地址（real 模式）：VITE_API_BASE_URL；空字符串 = 与前端同源部署 */
export const apiBaseUrl: string = ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(
  /\/+$/,
  '',
)

const rawTimeout = Number(import.meta.env.VITE_API_TIMEOUT_MS)
/** 单次 HTTP 请求超时（毫秒），默认 15s；长任务轮询使用独立的轮询节奏 */
export const apiTimeoutMs: number = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 15000

/** 应用接口前缀（前后端约定，见 docs/api-integration.md） */
export const API_PREFIX = '/api/v1'

/** 拼接应用接口完整地址（base 为空时为同源相对路径） */
export function apiUrl(path: string): string {
  return `${apiBaseUrl}${API_PREFIX}${path}`
}
