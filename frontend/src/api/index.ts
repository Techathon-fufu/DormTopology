import type { AppServices } from './types'
import { mockRecognitionService } from './mock/recognition'
import { mockModelGenerationService } from './mock/modelGeneration'
import { httpServices } from './http'
import { resolvedApiMode } from './core/config'

/**
 * 服务注册入口：规划固定请求后端；供应商能力按构建配置选择实现。
 *
 * 旧规划模式变量与浏览器覆盖不能启用本地规则规划。
 */

const mode = resolvedApiMode

export const services: AppServices = {
  ...httpServices,
  mode,
  meta: {
    label: '后端规划',
    description: mode === 'mock' ? '整理与走线请求后端；识别和模型生成使用模拟数据' : '请求应用后端',
  },
  recognition: mode === 'real' ? httpServices.recognition : mockRecognitionService,
  modelGeneration: mode === 'real' ? httpServices.modelGeneration : mockModelGenerationService,
}

/** 识别与模型生成的供应商模式，不影响整理或走线。 */
export const isMockMode = services.mode === 'mock'
export const hasRealServices = true
export const apiMode = services.mode

export { envApiMode } from './core/config'

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
