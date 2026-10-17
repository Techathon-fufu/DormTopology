import type { AppServices } from './types'
import { mockServices } from './mock'
import { httpServices } from './http'
import { envApiMode, isDemoFallbackMode, resolvedApiMode, setApiModeOverride } from './core/config'

/**
 * 服务注册入口：按运行模式选择实现（唯一开关，其他模块不得自行判断环境变量）。
 *
 * - `VITE_API_MODE=mock`（默认）：本地模拟服务，界面标注「模拟」
 * - `VITE_API_MODE=real`：调用应用后端（统一 HTTP 客户端 + jobId 长任务轮询 + 健康检查）
 * - 兼容旧变量 `VITE_SERVICE_MODE=mock|service`；VITE_API_MODE 优先
 * - 后端不可用时界面提供「切换到演示模式」入口（持久化到 localStorage，刷新后仍生效）
 */

const mode = resolvedApiMode

export const services: AppServices = mode === 'real' ? httpServices : mockServices

export const isMockMode = services.mode === 'mock'
export const apiMode = services.mode

// 运行模式（供界面展示与切换；密钥边界：前端没有任何服务密钥）
export { envApiMode, isDemoFallbackMode, setApiModeOverride }

// 统一错误与健康检查 / 长任务工具（界面与服务层共用）
export { ApiError, describeApiError, isApiError, isServiceFailure } from './core/errors'
export { checkBackendHealth } from './core/health'
export {
  cancelRemoteJob,
  isLocallyPolled,
  refreshActiveRemoteJobs,
  refreshRemoteJob,
  runRemoteJob,
} from './core/jobs'
export {
  REMOTE_CAPABILITY_LABELS,
  REMOTE_CAPABILITY_PATHS,
  summarizeWireResult,
} from './core/wire'
export type { RemoteCapability } from './core/wire'
export type { BackendHealth } from './core/health'

// 旧桩错误类保留导出（@deprecated，兼容旧引用）
export { ServiceNotImplementedError } from './types'
export type {
  AppServices,
  CablePlanningResult,
  CablePlanningService,
  LayoutPlanningResult,
  ModelGenerationResult,
  OrganizationPlanningService,
  RecognitionResult,
  RecognizedItem,
  ServiceProgress,
} from './types'
