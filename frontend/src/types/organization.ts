import type { Vec3 } from './project'

/**
 * 空间整理模式（分区与整理方案）类型定义。
 *
 * - 演示算法「规则式演示方案」在 src/lib/ruleLayout.ts 本地计算（可解释的规则式布局，非真实优化算法）
 * - 真实布局算法入口保留在服务层：services.organizationPlanning（当前为桩 / 未接入）
 */

// ───────────────────────────── 分区 ─────────────────────────────

export type ZoneKind = 'desk' | 'shelf' | 'underDesk'

export const ZONE_ORDER: ZoneKind[] = ['desk', 'shelf', 'underDesk']

export const ZONE_LABELS: Record<ZoneKind, string> = {
  desk: '桌面常用区',
  shelf: '书架收纳区',
  underDesk: '桌下隐藏区',
}

export const ZONE_DESCRIPTIONS: Record<ZoneKind, string> = {
  desk: '键鼠、常用物品与带电设备的易取位置（桌面后排与两侧）',
  shelf: '书本与收纳容器的主要归位区（书架搁板上）',
  underDesk: '主机及明确选择桌下的非常用收纳容器可放地面；插排使用横梁或桌面',
}

/** 分区参考线颜色（面板图例与三维叠加共用） */
export const ZONE_COLORS: Record<ZoneKind, string> = {
  desk: '#0F9D8A',
  shelf: '#D97706',
  underDesk: '#5B6BA8',
}

// ───────────────────────────── 整理偏好（用户可调整） ─────────────────────────────

/** 水杯活动区位置（以使用者面向桌面的视角：左 / 右 × 靠墙 / 靠人） */
export type CupCorner = 'backLeft' | 'backRight' | 'frontLeft' | 'frontRight'

export const CUP_CORNER_ORDER: CupCorner[] = ['backLeft', 'backRight', 'frontLeft', 'frontRight']

export const CUP_CORNER_LABELS: Record<CupCorner, string> = {
  backLeft: '左上',
  backRight: '右上',
  frontLeft: '左下',
  frontRight: '右下',
}

export interface OrganizationPreferences {
  /** 打字活动区水平偏移（米；相对桌面中心，负 = 偏左） */
  typingOffsetX: number
  /** 打字活动区宽度（米） */
  typingWidth: number
  /** 水杯活动区位置 */
  cupCorner: CupCorner
  /** 偏好的收纳分区：收纳容器 / 书本的优先去向 */
  preferredStorageZone: ZoneKind
}

export const DEFAULT_ORGANIZATION_PREFERENCES: OrganizationPreferences = {
  typingOffsetX: 0,
  typingWidth: 0.55,
  cupCorner: 'backRight',
  preferredStorageZone: 'shelf',
}

/** 打字活动区进深（米） */
export const TYPING_AREA_DEPTH = 0.24
/** 水杯活动区边长（米） */
export const CUP_AREA_SIZE = 0.16

/** 读取项目整理偏好（旧数据缺字段时回退默认值） */
export function resolveOrganizationPreferences(project: {
  organization?: Partial<OrganizationPreferences>
}): OrganizationPreferences {
  return { ...DEFAULT_ORGANIZATION_PREFERENCES, ...(project.organization ?? {}) }
}

// ───────────────────────────── 整理方案 ─────────────────────────────

/** 方案中的一次落位（含规则解释，保证可解释性） */
export interface PlanAssignment {
  objectId: string
  position: Vec3
  rotationY: number
  zone: ZoneKind
  /** 该物品的落位理由（用于界面展示「为什么放这里」） */
  reason: string
  targetRegionId?: string | null
  placementStatus?: 'placed' | 'unchanged' | 'unplaced'
}

/** 动画批次：按物品组分批移动 */
export interface PlanBatch {
  id: string
  label: string
  objectIds: string[]
  /** 该批动画时长（毫秒） */
  durationMs: number
}

export interface UnplacedItem {
  objectId: string
  name: string
  reason: string
}

export interface PlanMetrics {
  /** 桌面可用面积估算（平方米，四舍五入到 0.01） */
  deskFreeAreaBefore: number | null
  deskFreeAreaAfter: number | null
  /** 已归位物品数（本次方案完成落位的可移动物品） */
  placedCount: number
  /** 可移动物品总数（固定 / 锁定物品不计入） */
  movableCount: number
  unplacedCount: number
  /** 目标布局中仍相交的物品对数量 */
  overlapCount: number
  /** 目标布局中越界物品数量 */
  outOfBoundsCount: number
  /** 指标口径说明（界面必须同时展示，避免误读为实测值） */
  method: string
}

export interface OrganizationPlan {
  id: string
  projectId: string
  /** rule-demo = 规则式演示方案（本地规则计算）；algorithm = 真实后端布局算法结果（经本地校验） */
  kind: 'rule-demo' | 'algorithm'
  createdAt: number
  preferences: OrganizationPreferences
  assignments: PlanAssignment[]
  batches: PlanBatch[]
  unplaced: UnplacedItem[]
  /** 依次执行的规则解释 */
  rules: string[]
  metrics: PlanMetrics
  summary: string
  /** 真实后端结果的留痕（算法版本 / 后端状态 / 本地校验提示）；规则式演示方案没有该字段 */
  serviceMeta?: OrganizationServiceMeta
}

/** 真实后端整理方案的服务元数据（来源、后端状态、算法版本、本地校验提示） */
export interface OrganizationServiceMeta {
  source: 'real'
  status: 'success' | 'partial' | 'infeasible'
  sceneId: string
  sceneRevision: number
  jobId: string
  applicable: boolean
  issues: OrganizationIssue[]
  inputSignature: string
  algorithmVersion?: string
  warnings?: string[]
}

export interface OrganizationIssue {
  entity_id: string | null
  code: string
  message: string
}

export interface OrganizationSceneRef {
  sceneId: string
  sceneRevision: number
  baselineId: string | null
}
