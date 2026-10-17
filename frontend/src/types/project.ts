/**
 * 领域类型定义（单位约定见 @/lib/units.ts）
 *
 * - 三维数值（尺寸 / 位置 / 线缆长度）一律使用「米」
 * - 面向表单展示时转换为「毫米」
 * - 场景坐标约定：后墙位于 z = 0，x 以桌面中心为 0，y 向上
 * - SceneObject 的 position 指物体底面中心点
 */

import type { OrganizationPreferences } from './organization'

export type Vec3 = [number, number, number]

// ───────────────────────────── 房间 / 空间配置 ─────────────────────────────

export interface DeskConfig {
  /** 桌面长度（米），示例 1.2 */
  width: number
  /** 桌面深度（米），示例 0.6 */
  depth: number
  /** 桌板厚度（米） */
  thickness: number
  /** 桌面上表面离地高度（米），示例 0.75 */
  height: number
}

export interface ShelfConfig {
  enabled: boolean
  levels: number
  /** 最下层离桌面高度（米） */
  heightAboveDesk: number
  depth: number
}

export interface PostConfig {
  id: string
  /** 底面中心位置（米） */
  position: Vec3
  /** 截面边长（米） */
  section: number
}

/** 桌面出线孔 */
export interface CableHole {
  id: string
  position: Vec3
  /** 直径（米） */
  diameter: number
}

/**
 * 后墙插座面板：离地高度固定（米），仅可沿后墙左右移动。
 * 2026-10-17 需求修订：墙面上只有一块面板，含两个「双插孔」插座（不再有左右两个独立插座）。
 */
export const OUTLET_FIXED_Y_M = 0.35

/** 墙面插座面板（固定模型）：一块面板含 slots 个「双插孔」插座，每个插座可插 1 个插头 */
export interface PowerOutlet {
  id: string
  position: Vec3
  label: string
  /** 面板上的双插孔插座数量 */
  slots: number
}

export interface RoomConfig {
  template: 'loft-standard' | 'custom'
  /** Versioned fixed furniture; absent means the historical parametric room. */
  furnitureModel?: 'dormdesk-v1'
  /** 房间长度（x 向，米） */
  length: number
  /** 房间进深（z 向，米） */
  width: number
  /** 层高（米） */
  height: number
  desk: DeskConfig
  shelf: ShelfConfig
  posts: PostConfig[]
  cableHoles: CableHole[]
  outlets: PowerOutlet[]
  /** 创建时的说明（如：固定标准模型 / 可调范围） */
  note?: string
}

// ───────────────────────────── 接口 / 端口 ─────────────────────────────

export type PortType =
  | 'power-ac'
  | 'usb-a'
  | 'usb-c'
  | 'dc'
  | 'rj45'
  | 'hdmi'
  | 'audio'
  | 'wireless'

export const PORT_TYPE_LABELS: Record<PortType, string> = {
  'power-ac': '电源插头',
  'usb-a': 'USB-A',
  'usb-c': 'USB-C',
  dc: 'DC 供电',
  rj45: '网口 RJ45',
  hdmi: 'HDMI',
  audio: '3.5mm 音频',
  wireless: '无线连接',
}

/** 接口朝向（相对设备自身的局部方向） */
export type PortDirection = 'back' | 'front' | 'left' | 'right' | 'up' | 'down'

export const PORT_DIRECTION_LABELS: Record<PortDirection, string> = {
  back: '朝后（-Z）',
  front: '朝前（+Z）',
  left: '朝左（-X）',
  right: '朝右（+X）',
  up: '朝上（+Y）',
  down: '朝下（-Y）',
}

export interface Port {
  id: string
  type: PortType
  label?: string
  /** 是否为供电接口 */
  powered: boolean
  /** 额定功率（瓦，可选） */
  maxWatt?: number
  /**
   * 接口位置：相对设备底面中心点的局部偏移（米，设备自身坐标系，+x 右 / +y 上 / +z 朝人）。
   * 未填写时按设备背面中心自动派生（见 @/scene/ports.ts 的 defaultPortOffset）。
   * 设备移动 / 旋转后，接口世界坐标由该偏移与设备位姿实时推导，无需手动同步。
   */
  offset?: Vec3
  /** 接口朝向（局部方向），默认朝后 */
  direction?: PortDirection
  /**
   * 接口局部朝向（单位向量，设备自身坐标系）。
   * 显式填写时优先于六轴 `direction`；非法（非有限 / 零向量）时回退 `direction`。
   * 与 `direction` 同义（不是新的走线字段，仅本地存储更精确方向）。
   */
  localDirection?: Vec3
  /** 用户本地备注（仅本地元数据，不参与后端走线 JSON） */
  note?: string
  /** 用户已核对当前局部接口位置、方向及类型；编辑这些字段后须重新确认。 */
  confirmed?: boolean
}

// ───────────────────────────── 场景对象 ─────────────────────────────

/** 左侧面板的三大分类 */
export type ObjectCategory = 'nonElectrical' | 'electrical' | 'storage'

export const CATEGORY_LABELS: Record<ObjectCategory, string> = {
  nonElectrical: '非电气物品',
  electrical: '电气设备',
  storage: '收纳容器',
}

export const CATEGORY_ORDER: ObjectCategory[] = ['nonElectrical', 'electrical', 'storage']

/** 尺寸（米，分别管理：宽 x / 高 y / 深 z） */
export interface ObjectDimensions {
  width: number
  height: number
  depth: number
}

/** 位姿（米 / 弧度，独立于尺寸与模型管理） */
export interface ObjectTransform {
  /** 物体底面中心点（米） */
  position: Vec3
  /** 绕 y 轴旋转（弧度） */
  rotationY: number
}

export type ModelStatus = 'none' | 'generating' | 'placeholder' | 'ready' | 'failed'

export const MODEL_STATUS_LABELS: Record<ModelStatus, string> = {
  none: '未生成',
  generating: '生成中',
  placeholder: '演示占位模型',
  ready: '已生成',
  failed: '生成失败',
}

/** 演示用语义化占位几何体（真实 GLB 接入前的渲染形态） */
export type PrimitiveShape =
  | 'laptop'
  | 'monitor'
  | 'keyboard'
  | 'mouse'
  | 'lamp'
  | 'books'
  | 'book'
  | 'printer'
  | 'computerTower'
  | 'powerAdapter'
  | 'thermos'
  | 'cup'
  | 'storageBox'
  | 'powerStrip'
  | 'genericBox'

/** 模型地址与状态（与尺寸、位姿分开管理；大文件存 IndexedDB，不放 localStorage） */
export interface ModelRef {
  status: ModelStatus
  source: 'demo' | 'generated' | 'library'
  /** IndexedDB 中的资产 id（modelFiles 表） */
  assetId?: string
  /** 真实后端返回的资产 URL（三维渲染接入 URL 模型前仅记录，界面仍为占位几何） */
  assetUrl?: string
  /** 渲染用法说明（占位盒 / glb 等） */
  format?: 'placeholder-box' | 'glb' | 'gltf'
  /**
   * 预制模型 id（Prefabmodel 随包资产，注册表见 scene/prefabItems.ts）。
   * 命中时三维渲染使用真实 GLB、摆放校验使用随包碰撞数据；model.shape 仍是语义键
   * （整理规则 / 后端打包按语义形状分发），不随模型接入变化。
   */
  prefabId?: string
  /** 占位渲染使用的语义几何体（模型未完成时统一用匹配尺寸的几何占位物） */
  shape?: PrimitiveShape
  /** 生成中的阶段文字（不编造百分比，仅显示阶段） */
  stage?: string
  note?: string
}

export interface RecognitionMeta {
  /** 0 ~ 1，模拟或真实识别置信度 */
  confidence: number
  /** 来源照片（IndexedDB photos 表） */
  photoId?: string
  source: 'mock' | 'ai'
  /** 尺寸来源：estimated = AI 估计值（待确认）；user = 用户确认值 */
  dimensionSource?: 'estimated' | 'user'
}

// ───────────────────────────── 插排规格 ─────────────────────────────

/** 插排可选插孔位数（4 / 6 / 8 位） */
export const POWER_STRIP_SOCKET_COUNTS = [4, 6, 8] as const

export type PowerStripSocketCount = (typeof POWER_STRIP_SOCKET_COUNTS)[number]

/** 插排两端留边（米）：插孔区之外的壳体长度 */
export const POWER_STRIP_MARGIN = 0.03

/**
 * 插排规格（仅对「排插」类物品生效；长度 = 两端留边 + (孔数-1) × 孔间距，保存在 dimensions.width）。
 * 切换孔数 / 间距时长度自动重算；插孔端口按其规格自动重建（端口 id 约定 port-strip-<n>）。
 */
export interface PowerStripConfig {
  socketCount: PowerStripSocketCount
  /** 相邻插孔中心间距（米） */
  socketSpacing: number
  /** 最大建议负载（瓦）：已连接设备的额定功率合计超过该值时给出警告（估算值） */
  maxLoadW: number
}

export const POWER_STRIP_DEFAULTS: PowerStripConfig = {
  socketCount: 4,
  socketSpacing: 0.05,
  maxLoadW: 2500,
}

/** 插排孔距可取范围（米，20–80 mm） */
export const POWER_STRIP_SPACING_RANGE = { min: 0.02, max: 0.08 }

export interface SceneObject {
  id: string
  projectId: string
  name: string
  category: ObjectCategory
  dimensions: ObjectDimensions
  transform: ObjectTransform
  model: ModelRef
  ports: Port[]
  quantity: number
  needsPower: boolean
  visible: boolean
  /** 固定摆放：自动整理时保持位置不动 */
  fixed: boolean
  /** 锁定位置：禁止一切移动 / 旋转（手动拖拽与自动整理都不移动） */
  locked: boolean
  /** 常用物品：空间整理时优先放在桌面常用区等易取位置 */
  frequent: boolean
  source: 'demo' | 'recognized' | 'manual'
  recognition?: RecognitionMeta
  /** 插排规格（仅排插类物品；长度/宽度/高度仍由 dimensions 管理，长度随规格自动重算） */
  powerStrip?: PowerStripConfig
  note?: string
}

// ───────────────────────────── 线缆 ─────────────────────────────

export type CableKind = 'power' | 'network' | 'data' | 'charging' | 'video'

/** 线缆大类：界面按「电源线 / 视频线 / 数据线」用颜色 + 文字共同区分 */
export type CableGroup = 'power' | 'video' | 'data'

export const CABLE_KIND_META: Record<CableKind, { label: string; color: string; group: CableGroup }> = {
  power: { label: '电源线', color: '#E5484D', group: 'power' },
  charging: { label: '充电线', color: '#F59E0B', group: 'power' },
  video: { label: '视频线', color: '#10B981', group: 'video' },
  network: { label: '网线', color: '#3B82F6', group: 'data' },
  data: { label: '数据线', color: '#8B5CF6', group: 'data' },
}

export const CABLE_GROUP_META: Record<CableGroup, { label: string; description: string }> = {
  power: { label: '电源线', description: '供电 / 充电线缆' },
  video: { label: '视频线', description: 'HDMI 等视频信号线' },
  data: { label: '数据线', description: 'USB / 网线等数据线' },
}

/** 走线通道：桌沿 / 桌底 / 背板 / 立柱 / 地面 / 自由（未规划） */
export type CableChannel = 'deskEdge' | 'deskUnderside' | 'backboard' | 'post' | 'floor' | 'free'

export const CABLE_CHANNEL_LABELS: Record<CableChannel, string> = {
  deskEdge: '桌沿',
  deskUnderside: '桌底走线',
  backboard: '背板走线',
  post: '立柱绑扎',
  floor: '地面',
  free: '自由摆放',
}

/** 线材可见性类型：可见线 = 从桌面出线槽（穿线孔）走线；隐藏线 = 从桌面背板后面走线 */
export type CableVisibility = 'visible' | 'hidden'

export const CABLE_VISIBILITY_META: Record<
  CableVisibility,
  { label: string; description: string; strategy: CableRouteStrategy }
> = {
  visible: {
    label: '可见线',
    description: '从桌面出线槽（穿线孔）走线，看得见但顺滑不凌乱',
    strategy: 'cableHole',
  },
  hidden: {
    label: '隐藏线',
    description: '从桌面背板后面走线，尽量不穿桌面、看不见',
    strategy: 'backboard',
  },
}

/** 走线策略：cableHole = 出线槽（穿线孔）策略；backboard = 背板后走线策略 */
export type CableRouteStrategy = 'cableHole' | 'backboard'

export const CABLE_STRATEGY_META: Record<CableRouteStrategy, { label: string }> = {
  cableHole: { label: '出线槽走线' },
  backboard: { label: '背板后走线' },
}

/** 线径档位：粗线 / 细线（影响渲染管径、最小弯曲半径与线缆间距检查） */
export type CableThickness = 'thick' | 'thin'

export const CABLE_THICKNESS_META: Record<
  CableThickness,
  {
    label: string
    /** 真实参考线径（米，含外被） */
    diameterM: number
    /** 三维渲染半径（米，约按真实半径 1.7 倍放大以便观察，界面需标注） */
    renderRadiusM: number
    /** 最小弯曲半径参考值（米） */
    minBendRadiusM: number
  }
> = {
  thick: { label: '粗线', diameterM: 0.0065, renderRadiusM: 0.0055, minBendRadiusM: 0.0325 },
  thin: { label: '细线', diameterM: 0.0035, renderRadiusM: 0.0032, minBendRadiusM: 0.0175 },
}

/** 线缆间最小净间隙（米）：两根线缆表面之间至少留出的距离（本地咨询级检查） */
export const CABLE_CLEARANCE_M = 0.008

export interface CableEndpoint {
  objectId: string
  portId?: string
  /** 端点在世界坐标中的位置（米），用于渲染 */
  position: Vec3
}

export interface CableRoute {
  channels: CableChannel[]
  /** 路径控制点（米；首末点渲染时由接口世界坐标实时推导） */
  points: Vec3[]
  /** 与 points 对齐的路径节点 id（null = 自由点 / 端点） */
  nodeIds?: (string | null)[]
  /** 渲染时是否按平滑曲线（Catmull-Rom）采样 */
  smooth?: boolean
  /** 本条路径实际采用的走线策略（由线材类型推导；用于「类型变更后需重算」判定） */
  strategy?: CableRouteStrategy
  /** 真实后端沿已验证连续曲线积分得到的长度，不能重新平滑后沿用。 */
  pathLengthM?: number
  verification?: {
    sceneId: string
    sceneRevision: number
    status: 'valid' | 'failed'
    reasonCode?: string
    supportStatus: 'verified' | 'not_evaluated'
    maxUnsupportedSpanM?: number | null
  }
}

export type CableRouteStatus = 'existing' | 'planned' | 'adjusted' | 'stale' | 'conflict'

export const CABLE_STATUS_META: Record<
  CableRouteStatus,
  { label: string; tone: 'default' | 'primary' | 'warning' | 'danger' | 'success' }
> = {
  existing: { label: '原始走线', tone: 'default' },
  planned: { label: '已规划', tone: 'primary' },
  adjusted: { label: '已手动调整', tone: 'success' },
  stale: { label: '需重新计算', tone: 'warning' },
  conflict: { label: '存在障碍', tone: 'danger' },
}

export interface CableAccessory {
  type: 'clip' | 'velcro' | 'sleeve' | 'tray'
  count: number
}

export const ACCESSORY_LABELS: Record<CableAccessory['type'], string> = {
  clip: '自粘理线扣',
  velcro: '魔术贴扎带',
  sleeve: '理线套管',
  tray: '桌底理线槽',
}

export interface CableConnection {
  id: string
  projectId: string
  kind: CableKind
  /** 线径档位（粗 / 细）：未填写时按线缆类型推导（电源 / 视频 / 网线 = 粗线，其余 = 细线） */
  thickness?: CableThickness
  /** 线材类型：可见线（出线槽）/ 隐藏线（背板后）；未填写时按两端设备名称推断（见 @/scene/cables.ts） */
  visibility?: CableVisibility
  from: CableEndpoint
  to: CableEndpoint
  route: CableRoute
  /**
   * 原始走线快照（首次规划前采集）：用于「原始走线 / 建议走线」切换与收拢动画。
   * 未规划过的线缆没有该字段。
   */
  originalRoute?: CableRoute
  /** 已知的现有线材长度（米；undefined = 未知），不作为规划必填项。 */
  actualLengthM?: number
  /** 用户填写的预留长度（米；undefined = 按 0 处理） */
  reserveLengthM?: number
  status: CableRouteStatus
  /** 规划来源：demo-rule = 规则式演示路径规划（非真实算法验证）；algorithm = 真实后端算法结果（经本地校验） */
  planSource?: 'demo-rule' | 'manual' | 'algorithm'
  accessories: CableAccessory[]
  note?: string
  updatedAt?: number
  /** @deprecated 旧字段：长度改为按当前路径实时计算（见 @/scene/cableRoute.ts） */
  lengthM?: number
  /** @deprecated 旧字段 */
  slackM?: number
}

// ───────────────────────────── 布局方案 ─────────────────────────────

export interface LayoutAssignment {
  objectId: string
  position: Vec3
  rotationY: number
  zone: 'deskBack' | 'deskFront' | 'deskSide' | 'floor' | 'free'
}

/**
 * 布局方案快照。
 * - kind = 'baseline'：整理前状态（进入工作台时自动采集，独立保存）
 * - kind = 'current'：当前方案（工作台实时编辑，存于 Project.objects）
 * - kind = 'candidate'：对比用方案（「保存方案」生成，0.8.0 起携带场景快照）
 */
export interface LayoutPlan {
  id: string
  projectId: string
  name: string
  kind: 'baseline' | 'current' | 'candidate'
  createdAt: number
  /** 最近一次重命名 / 复制等变更时间（旧数据缺失时按 createdAt 处理） */
  updatedAt?: number
  assignments: LayoutAssignment[]
  /** 场景快照（0.8.0 起随「保存方案」写入；旧数据缺失时按「旧版本方案」展示） */
  scene?: PlanSceneSnapshot
  /** 方案来源（布局 / 走线算法来源；旧数据缺失时为 undefined） */
  source?: PlanSourceInfo
  score?: number
  summary?: string
}

// ───────────────────────────── 方案快照与来源 ─────────────────────────────

/** 方案场景快照格式版本 */
export const PLAN_SCENE_SNAPSHOT_VERSION = 1

/**
 * 方案场景快照：保存方案时的房间 / 物品 / 线缆深拷贝。
 * 用于候选方案对比——当前方案继续编辑后，已保存方案不被覆盖。
 */
export interface PlanSceneSnapshot {
  version: number
  room: RoomConfig
  objects: SceneObject[]
  cables: CableConnection[]
}

/** 方案布局来源 */
export type PlanLayoutSource = 'rule' | 'algorithm' | 'manual' | 'unknown'

/** 方案走线来源 */
export type PlanCableSource = 'rule' | 'algorithm' | 'manual' | 'mixed' | 'none' | 'unknown'

export const PLAN_LAYOUT_SOURCE_LABELS: Record<PlanLayoutSource, string> = {
  rule: '规则式布局（演示）',
  algorithm: '真实布局算法',
  manual: '手动摆放',
  unknown: '未记录',
}

export const PLAN_CABLE_SOURCE_LABELS: Record<PlanCableSource, string> = {
  rule: '规则式走线（演示）',
  algorithm: '真实走线算法',
  manual: '手动调整',
  mixed: '混合来源',
  none: '无线缆',
  unknown: '未记录',
}

export interface PlanSourceInfo {
  layout: PlanLayoutSource
  cable: PlanCableSource
}

// ───────────────────────────── 生成任务 ─────────────────────────────

export type JobType = 'recognition' | 'model' | 'layout' | 'cable'
export type JobStatus =
  | 'queued'
  | 'waiting'
  | 'running'
  /** 待用户确认（如识别完成、等待确认物品清单） */
  | 'awaiting'
  | 'success'
  | 'failed'
  | 'partial'
  | 'canceled'

export interface GenerationJob {
  id: string
  projectId: string
  type: JobType
  status: JobStatus
  /** 0 ~ 1 */
  progress: number
  title: string
  stageLabel?: string
  error?: string
  itemIds?: string[]
  attempts: number
  retryOf?: string
  resultNote?: string
  /** 结果由 mock 服务产生时为 true（界面标注「模拟」） */
  mock: boolean
  createdAt: number
  updatedAt: number
}

// ───────────────────────────── 项目 ─────────────────────────────

export type ProjectStage = 'space' | 'photos' | 'items' | 'assets' | 'organize' | 'cable' | 'guide'

export interface Project {
  id: string
  name: string
  isDemo: boolean
  source: 'demo' | 'user'
  createdAt: number
  updatedAt: number
  room: RoomConfig
  /** 当前场景配置（工作台实时编辑并持久化） */
  objects: SceneObject[]
  cables: CableConnection[]
  /** 空间整理偏好（打字活动区 / 水杯活动区 / 偏好收纳分区等，用户可调整） */
  organization?: OrganizationPreferences
  /** 最近一次接受的整理方案来源（用于「保存方案」记录布局来源；未记录 = undefined） */
  layoutSource?: 'rule' | 'algorithm'
  /** 最近一次「设为当前方案」使用的候选方案（用于候选方案列表标识当前方案；后续编辑可能已使场景偏离该方案） */
  lastAppliedPlan?: { planId: string; at: number }
  /**
   * 内置示例项目的数据种子版本（仅 isDemo 项目使用）。
   * 小于当前 `DEMO_SEED_VERSION` 时会在载入时按最新示例数据重种，避免代码已更新而浏览器
   * 仍显示旧场景；用户自建项目不写该字段，也不受影响。
   */
  demoSeedVersion?: number
  stage: ProjectStage
}
