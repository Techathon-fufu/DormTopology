import type { AppServices } from '../types'
import { ServiceNotImplementedError } from '../types'

function notImplemented(api: string): never {
  throw new ServiceNotImplementedError(api)
}

/**
 * 真实后端服务（桩实现）。
 * 通过 VITE_SERVICE_MODE=service 启用；接口地址与鉴权由应用后端负责，
 * Rodin 等第三方服务的密钥只在后端持有，前端不接触。
 */
export const httpServices: AppServices = {
  mode: 'service',
  meta: {
    label: '后端服务模式',
    description: '调用应用后端接口；第三方密钥（Rodin 等）由后端持有',
  },
  recognition: {
    async recognize() {
      notImplemented('POST /api/v1/recognition（照片识别）')
    },
  },
  modelGeneration: {
    async generateObject() {
      notImplemented('POST /api/v1/models/generate（3D 资产生成，后端代理 Rodin）')
    },
  },
  layoutPlanning: {
    async planLayout() {
      notImplemented('POST /api/v1/layout/plan（布局规划）')
    },
  },
  cablePlanning: {
    async planCables() {
      notImplemented(
        'POST /api/v1/cables/plan（走线规划：真实路径求解 / 避障算法，服务端实现）',
      )
    },
  },
  organizationPlanning: {
    async planOrganization() {
      notImplemented(
        'POST /api/v1/organization/plan（空间整理：真实布局 / 搬运优化算法，服务端实现）',
      )
    },
  },
}
