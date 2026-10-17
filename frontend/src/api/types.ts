import type {
  CableConnection,
  LayoutPlan,
  ObjectCategory,
  ObjectDimensions,
  Port,
  Project,
  RoomConfig,
  SceneObject,
} from '@/types/project'
import type { OrganizationPlan, OrganizationPreferences, OrganizationSceneRef } from '@/types/organization'

/**
 * 服务接口层：识别 / 模型生成 / 布局规划 / 走线规划 / 空间整理。
 *
 * - mock 实现（src/api/mock）：本地模拟，界面标注「模拟」
 * - real 实现（src/api/http）：调用应用后端（VITE_API_MODE=real），统一经
 *   src/api/core 的 HTTP 客户端与 jobId 长任务轮询；Rodin 等第三方密钥由后端持有，前端不配置
 * - 界面必须区分数据来源：mock 结果标注「模拟」，本地计算标注「计算值」，真实后端标注「真实后端」
 */

export type ServiceProgress = (progress: number, stageLabel?: string) => void

/**
 * @deprecated 旧桩实现的占位错误（服务层已接入真实适配器）。
 * 保留导出以兼容旧引用；新代码不应再抛出该错误。
 */
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
  /** 结果本地校验提示（不合格条目被显式丢弃的原因） */
  warnings?: string[]
}

export interface RecognitionService {
  recognize(input: {
    projectId: string
    photoIds: string[]
    /** mock 专用：强制模拟失败，用于演示识别失败 / 重试流程 */
    simulateFailure?: boolean
    onProgress?: ServiceProgress
    /** 调用方中止（组件卸载 / 用户离开） */
    signal?: AbortSignal
  }): Promise<RecognitionResult>
}

// ── 模型生成 ─────────────────────────────────────────────────────────────

export interface ModelGenerationResult {
  objectId: string
  status: 'ready' | 'failed'
  /** 写入 IndexedDB modelFiles 表的资产 id（mock 不产生真实文件） */
  assetId?: string
  /** 真实后端生成的资产 URL（三维渲染接入 URL 模型前仅记录，界面仍为占位几何） */
  assetUrl?: string
  format?: 'glb' | 'gltf'
  error?: string
  note?: string
  warnings?: string[]
}

export interface ModelGenerationService {
  generateObject(input: {
    projectId: string
    object: SceneObject
    /** 第几次尝试，从 0 开始（mock 用首次失败、重试成功演示失败/重试状态） */
    attempt?: number
    onProgress?: ServiceProgress
    signal?: AbortSignal
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
    signal?: AbortSignal
  }): Promise<LayoutPlanningResult>
}

// ── 走线规划 ─────────────────────────────────────────────────────────────

export interface CablePlanningResult {
  /** 真实规划返回全场景线缆；Mock 可只返回本次目标线缆的更新。 */
  cables: CableConnection[]
  plannedCount: number
  conflictCount: number
  /** 是否经过真实算法验证（Mock 恒为 false，real 校验正式版本及全部单线状态后为 true）。 */
  algorithmVerified: boolean
  notes: string[]
  /** 本地校验提示（不合格路径被丢弃的原因） */
  warnings?: string[]
  sceneRef?: OrganizationSceneRef
}

/**
 * 走线规划服务：接口 → 场景路径节点（桌边 / 桌底 / 立柱 / 出线孔）→ 平滑曲线 → 障碍检查。
 *
 * 产品固定调用后端走线算法服务（jobId 长任务），结果经本地校验后采用。
 * 本地规划适配器仅保留用于历史测试，不注册到产品入口。
 */
export interface CablePlanningService {
  planCables(input: {
    projectId: string
    /** 真实走线必须提交完整当前场景；旧调用仅供 Mock 兼容。 */
    project?: Project
    baseline?: LayoutPlan
    confirmed?: boolean
    objects: SceneObject[]
    room: RoomConfig
    cables: CableConnection[]
    /** 优先更新的线缆；真实服务始终共同复查全部线缆，Mock 只更新目标。 */
    targetIds?: string[]
    preferences: OrganizationPreferences
    onProgress?: ServiceProgress
    signal?: AbortSignal
  }): Promise<CablePlanningResult>
}

// ── 空间整理（分区布局） ─────────────────────────────────────────────────

/**
 * 空间整理服务：三区（桌面常用区 / 书架收纳区 / 桌下隐藏区）+ 偏好（打字活动区、
 * 水杯活动区、偏好收纳分区）→ 整理方案（含未放置物品与原因、指标、动画批次）。
 *
 * 产品固定调用后端布局算法服务（jobId 长任务），结果经本地校验后采用。
 * 本地规划适配器仅保留用于历史测试，不注册到产品入口。
 */
export interface OrganizationPlanningService {
  planOrganization(input: {
    projectId: string
    objects: SceneObject[]
    room: RoomConfig
    preferences: OrganizationPreferences
    baseline: LayoutPlan
    confirmed: boolean
    onProgress?: ServiceProgress
    signal?: AbortSignal
  }): Promise<OrganizationPlan>
  applyOrganization(input: {
    projectId: string
    plan: OrganizationPlan
    objects: SceneObject[]
    room: RoomConfig
    preferences: OrganizationPreferences
  }): Promise<OrganizationSceneRef | void>
}

// ── 服务集合 ─────────────────────────────────────────────────────────────

export interface AppServices {
  mode: 'mock' | 'real'
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
