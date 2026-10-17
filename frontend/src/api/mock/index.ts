import type { AppServices } from '../types'
import { mockCablePlanningService } from './cablePlanning'
import { mockLayoutPlanningService } from './layoutPlanning'
import { mockModelGenerationService } from './modelGeneration'
import { mockOrganizationPlanningService } from './organizationPlanning'
import { mockRecognitionService } from './recognition'

export const mockServices: AppServices = {
  mode: 'mock',
  meta: {
    label: '演示模式（模拟服务）',
    description: '识别 / 模型生成 / 规划均为本地模拟结果，界面标注「模拟」，不调用任何外部服务',
  },
  recognition: mockRecognitionService,
  modelGeneration: mockModelGenerationService,
  layoutPlanning: mockLayoutPlanningService,
  cablePlanning: mockCablePlanningService,
  organizationPlanning: mockOrganizationPlanningService,
}
