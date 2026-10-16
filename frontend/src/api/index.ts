import type { AppServices } from './types'
import { mockServices } from './mock'
import { httpServices } from './http'

/**
 * 服务注册入口：按环境变量选择实现。
 * - VITE_SERVICE_MODE=mock（默认）：本地模拟，标注「模拟」
 * - VITE_SERVICE_MODE=service：调用应用后端（当前为桩，未接入时抛 ServiceNotImplementedError）
 */
const mode = (import.meta.env.VITE_SERVICE_MODE as string | undefined) ?? 'mock'

export const services: AppServices = mode === 'service' ? httpServices : mockServices

export const isMockMode = services.mode === 'mock'

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
