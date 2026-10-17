/**
 * API 运行模式与连接配置（服务适配层唯一配置入口）。
 *
 * - `VITE_API_MODE=mock`（默认）：本地模拟服务，界面标注「模拟」
 * - `VITE_API_MODE=real`：调用应用后端（接口路径与载荷见 frontend/docs/api-integration.md）
 * - 兼容旧变量：`VITE_SERVICE_MODE=mock|service`（service 等价 real）；两者同时存在时 VITE_API_MODE 优先
 * - 后端不可用时可在界面「切换到演示模式」：写入 localStorage，刷新后仍生效，可随时恢复真实模式
 * - 第三方密钥（Rodin 等）只允许存在于后端；前端不读取、不存储任何密钥
 */

export type ApiMode = 'mock' | 'real'

const OVERRIDE_KEY = 'dormtopology.api-mode-override'

function readEnvMode(): ApiMode {
  const raw =
    (import.meta.env.VITE_API_MODE as string | undefined) ??
    (import.meta.env.VITE_SERVICE_MODE as string | undefined)
  return raw === 'real' || raw === 'service' ? 'real' : 'mock'
}

function readOverride(): ApiMode | null {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY)
    return v === 'mock' || v === 'real' ? v : null
  } catch {
    return null
  }
}

/** 构建时环境变量指定的模式（不随运行时切换变化） */
export const envApiMode: ApiMode = readEnvMode()

const override = readOverride()

/** 实际生效模式：运行时切换优先，否则取环境变量 */
export const resolvedApiMode: ApiMode = override ?? envApiMode

const organizationEnvMode = import.meta.env.VITE_ORGANIZATION_API_MODE as string | undefined
export const organizationApiMode: ApiMode = override ?? (organizationEnvMode === 'real' || organizationEnvMode === 'mock' ? organizationEnvMode : resolvedApiMode)

/**
 * 是否处于「真实模式被手动切换到演示模式」状态。
 * 用于界面提示与「恢复真实模式」入口；全局或整理能力原本启用 real 时显示。
 */
export const isDemoFallbackMode: boolean = (envApiMode === 'real' || organizationEnvMode === 'real') && resolvedApiMode === 'mock' && organizationApiMode === 'mock'

/**
 * 写入运行时模式偏好（刷新后仍生效）。
 * mode = null 表示清除切换、恢复环境变量指定的模式。
 */
export function setApiModeOverride(mode: ApiMode | null): void {
  try {
    if (mode === null) localStorage.removeItem(OVERRIDE_KEY)
    else localStorage.setItem(OVERRIDE_KEY, mode)
  } catch {
    /* 隐私模式等存储不可用：仅本次会话不生效，不阻断流程 */
  }
}

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
