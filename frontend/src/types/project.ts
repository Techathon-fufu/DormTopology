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

/** 电源插座 / 插排固定点 */
export interface PowerOutlet {
  id: string
  position: Vec3
  label: string
  slots: number
}

export interface RoomConfig {
  template: 'loft-standard' | 'custom'
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
  /** 创建时的说明（如：示例尺寸可修改） */
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
  /** 渲染用法说明（占位盒 / glb 等） */
  format?: 'placeholder-box' | 'glb' | 'gltf'
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

/** 走线通道：桌沿 / 桌底 / 立柱 / 地面 / 自由（未规划） */
export type CableChannel = 'deskEdge' | 'deskUnderside' | 'post' | 'floor' | 'free'

export const CABLE_CHANNEL_LABELS: Record<CableChannel, string> = {
  deskEdge: '桌沿',
  deskUnderside: '桌底走线',
  post: '立柱绑扎',
  floor: '地面',
  free: '自由摆放',
}

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
}

export type CableRouteStatus = 'existing' | 'planned' | 'adjusted' | 'stale' | 'conflict'

export const CABLE_STATUS_META: Record<
  CableRouteStatus,
  { label: string; tone: 'default' | 'primary' | 'warning' | 'danger' | 'success' }
> = {
  existing: { label: '原始走线', tone: 'default' },
  planned: { label: '已规划（演示）', tone: 'primary' },
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
  from: CableEndpoint
  to: CableEndpoint
  route: CableRoute
  /**
   * 原始走线快照（首次规划前采集）：用于「原始走线 / 建议走线」切换与收拢动画。
   * 未规划过的线缆没有该字段。
   */
  originalRoute?: CableRoute
  /** 用户填写的实际线长（米；undefined = 未填写） */
  actualLengthM?: number
  /** 用户填写的预留长度（米；undefined = 按 0 处理） */
  reserveLengthM?: number
  status: CableRouteStatus
  /** 规划来源：demo-rule = 规则式演示路径规划（非真实算法验证） */
  planSource?: 'demo-rule' | 'manual'
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
 * - kind = 'candidate'：对比用方案（「保存方案」生成）
 */
export interface LayoutPlan {
  id: string
  projectId: string
  name: string
  kind: 'baseline' | 'current' | 'candidate'
  createdAt: number
  assignments: LayoutAssignment[]
  score?: number
  summary?: string
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
  stage: ProjectStage
}
