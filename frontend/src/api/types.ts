import type {
  CableConnection,
  LayoutPlan,
  ObjectCategory,
  ObjectDimensions,
  Port,
  RoomConfig,
  SceneObject,
} from '@/types/project'
import type { OrganizationPlan, OrganizationPreferences } from '@/types/organization'

/**
 * 服务接口层：识别 / 模型生成 / 布局规划 / 走线规划。
 *
 * - mock 实现（src/services/mock）：本地模拟等待、成功、失败与部分成功
 * - service 实现（src/services/http）：调用应用后端；Rodin 等第三方密钥由后端持有，前端不配置
 * - 界面必须区分数据来源：mock 结果标注「模拟」，计算结果标注「计算值」，未实现能力标注「未接入」
 */

export type ServiceProgress = (progress: number, stageLabel?: string) => void

export class ServiceNotImplementedError extends Error {
  readonly api: string
  constructor(api: string) {
    super(`真实服务未接入：需要后端提供 ${api}。密钥（如 Rodin）由后端持有，前端不配置。`)
    this.name = 'ServiceNotImplementedError'
    this.api = api
  }
}

// ── 识别 ────────────────────────────────────────────────────────────────

export interface RecognizedItem {
  tempId: string
  name: string
  category: ObjectCategory
  dimensions: ObjectDimensions
  quantity: number
  needsPower: boolean
  /** 固定摆放（自动整理时保持位置） */
  fixed: boolean
  /** 尺寸来源：estimated = AI 估计值（需用户确认）；user = 用户确认值 */
  dimensionSource: 'estimated' | 'user'
  ports: Port[]
  /** 0 ~ 1 */
  confidence: number
}

export interface RecognitionResult {
  items: RecognizedItem[]
  /** 低置信度（< 0.75）数量，界面按「部分成功」提示待确认 */
  lowConfidence: number
  note?: string
}

export interface RecognitionService {
  recognize(input: {
    projectId: string
    photoIds: string[]
    /** mock 专用：强制模拟失败，用于演示识别失败 / 重试流程 */
    simulateFailure?: boolean
    onProgress?: ServiceProgress
  }): Promise<RecognitionResult>
}

// ── 模型生成 ─────────────────────────────────────────────────────────────

export interface ModelGenerationResult {
  objectId: string
  status: 'ready' | 'failed'
  /** 写入 IndexedDB modelFiles 表的资产 id（mock 不产生真实文件） */
  assetId?: string
  error?: string
  note?: string
}

export interface ModelGenerationService {
  generateObject(input: {
    projectId: string
    object: SceneObject
    /** 第几次尝试，从 0 开始（mock 用首次失败、重试成功演示失败/重试状态） */
    attempt?: number
    onProgress?: ServiceProgress
  }): Promise<ModelGenerationResult>
}

// ── 布局规划 ─────────────────────────────────────────────────────────────

export interface LayoutPlanningResult {
  plan: LayoutPlan
  score: number
  summary: string
}

export interface LayoutPlanningService {
  planLayout(input: {
    projectId: string
    objects: SceneObject[]
    room: RoomConfig
    onProgress?: ServiceProgress
  }): Promise<LayoutPlanningResult>
}

// ── 走线规划 ─────────────────────────────────────────────────────────────

export interface CablePlanningResult {
  /** 规划后的线缆（仅包含本次目标线缆的更新） */
  cables: CableConnection[]
  plannedCount: number
  conflictCount: number
  /** 是否经过真实算法验证（演示实现恒为 false，不得显示为已验证） */
  algorithmVerified: boolean
  notes: string[]
}

/**
 * 走线规划服务：接口 → 场景路径节点（桌边 / 桌底 / 立柱 / 出线孔）→ 平滑曲线 → 障碍检查。
 *
 * - mock 实现：本地「规则式演示规划」（候选节点链 + 平滑采样障碍检查），可解释、演示用；
 * - service 实现：真实走线求解算法入口（当前为桩，未接入时抛 ServiceNotImplementedError）。
 */
export interface CablePlanningService {
  planCables(input: {
    projectId: string
    objects: SceneObject[]
    room: RoomConfig
    cables: CableConnection[]
    /** 仅规划这些线缆；缺省 = 全部 */
    targetIds?: string[]
    preferences: OrganizationPreferences
    onProgress?: ServiceProgress
  }): Promise<CablePlanningResult>
}

// ── 空间整理（分区布局） ─────────────────────────────────────────────────

/**
 * 空间整理服务：三区（桌面常用区 / 书架收纳区 / 桌下隐藏区）+ 偏好（打字活动区、
 * 水杯活动区、偏好收纳分区）→ 可解释的整理方案（含未放置物品与原因、指标、动画批次）。
 *
 * - mock 实现：本地「规则式演示方案」（可解释规则计算，演示用）
 * - service 实现：真实布局 / 搬运优化算法入口（当前为桩，未接入时抛 ServiceNotImplementedError）
 */
export interface OrganizationPlanningService {
  planOrganization(input: {
    projectId: string
    objects: SceneObject[]
    room: RoomConfig
    preferences: OrganizationPreferences
    onProgress?: ServiceProgress
  }): Promise<OrganizationPlan>
}

// ── 服务集合 ─────────────────────────────────────────────────────────────

export interface AppServices {
  mode: 'mock' | 'service'
  meta: {
    label: string
    description: string
  }
  recognition: RecognitionService
  modelGeneration: ModelGenerationService
  layoutPlanning: LayoutPlanningService
  cablePlanning: CablePlanningService
  organizationPlanning: OrganizationPlanningService
}
