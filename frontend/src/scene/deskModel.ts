import * as THREE from 'three'
import type { RoomConfig, Vec3 } from '@/types/project'
import { DESK_GAP, SHELF_THICKNESS } from '@/scene/sceneValidation'

/**
 * 桌体 GLB 模型（models/dorm_desk_assembled.glb）接入：配置、归一化与实测锚点。
 *
 * 口径说明（与 sceneValidation / deskModelStore 的分工）：
 * - 逻辑坐标（吸附面 / 碰撞边界 / 校验）仍以 RoomConfig 为单一事实来源；
 * - GLB 加载后统一换算为米制，并做底部对齐 / 居中 / 坐标轴校正（见下方配置项）；
 * - 模型若带可识别的命名节点（桌面 / 搁板 / 出线孔），实测高度以「锚点」形式经
 *   deskModelStore.metrics 提供给交互层（拖拽 / 校验 / 吸附优先采用实测面）；
 *   整理分区与规则式布局当前仍按 RoomConfig 计算（见 frontend/docs/desk-model.md 已知限制）。
 *
 * 本模块为纯计算（依赖 three 与 RoomConfig），可在无浏览器环境下单测。
 */

export interface DeskModelAnchorPatterns {
  /** 桌面节点名匹配（大小写不敏感子串） */
  deskTop: string[]
  shelf: string[]
  cableHole: string[]
}

export interface DeskModelConfig {
  /** 资源路径（frontend/public 下相对路径；经 resolvePublicAssetUrl 解析，dev 与构建后均正确） */
  url: string
  /** 源文件单位换算：glTF 规范为米；如按厘米导出填 0.01 */
  unitScale: number
  /** 坐标轴校正：绕 Y 轴旋转（弧度）。Z-up 导出可设 -Math.PI / 2 */
  axisRotationY: number
  /** 统一等比缩放到该宽度（米）：null = 保持源文件尺寸（仅做单位换算） */
  fitWidthM: number | null
  /** 居中到桌面基准（x = 0，z = 桌面中心）；false 时仅做垂直对齐 */
  centerXZ: boolean
  /** 垂直对齐：'bottom' 底部贴地；'deskTop' 桌面锚点对齐到 RoomConfig 桌面高度（需锚点，否则退回底部对齐） */
  verticalAlign: 'bottom' | 'deskTop'
  /** 手工微调（米） */
  offset: Vec3
  anchorPatterns: DeskModelAnchorPatterns
}

/**
 * 默认配置。仓库当前未包含 dorm_desk_assembled.glb（资产缺失时工作台自动回退参数化桌体并给出提示）；
 * 将文件放入 frontend/public/models/ 后即按本配置自动生效（单位 / 朝向 / 命名建议见 docs/desk-model.md）。
 */
export const DORM_DESK_MODEL_CONFIG: DeskModelConfig = {
  url: 'models/dorm_desk_assembled.glb',
  unitScale: 1,
  axisRotationY: 0,
  fitWidthM: null,
  centerXZ: true,
  verticalAlign: 'bottom',
  offset: [0, 0, 0],
  anchorPatterns: {
    deskTop: ['desktop', 'desk_top', 'desk-top', 'tabletop', '桌面'],
    shelf: ['shelf', '搁板', '书架'],
    cableHole: ['cable_hole', 'cablehole', '出线孔', 'hole'],
  },
}

/** 解析 public 静态资源路径：兼容 dev（/）与构建后的 BASE_URL（含子路径部署） */
export function resolvePublicAssetUrl(path: string): string {
  const env = (import.meta as unknown as { env?: { BASE_URL?: string } }).env
  const base = env?.BASE_URL && env.BASE_URL.length > 0 ? env.BASE_URL : '/'
  const normalizedBase = base.endsWith('/') ? base : `${base}/`
  return `${normalizedBase}${path.replace(/^\/+/, '')}`
}

/** 桌面基准（由 RoomConfig 推导，与 RoomShell / sceneValidation 同一组参数） */
export function deskCenterOf(room: RoomConfig): { x: number; z: number; topY: number } {
  return { x: 0, z: DESK_GAP + room.desk.depth / 2, topY: room.desk.height }
}

export interface DeskAnchors {
  deskTopY: number | null
  shelfTopY: number | null
  /** 出线孔节点世界坐标（诊断用；本阶段未接入走线计算） */
  cableHolePoints: Vec3[]
  matchedNames: string[]
}

const _box = new THREE.Box3()
const _center = new THREE.Vector3()

/** 按节点名提取桌面 / 搁板 / 出线孔锚点（实测包围盒；同名多节点取最高面） */
export function extractDeskAnchors(root: THREE.Object3D, patterns: DeskModelAnchorPatterns): DeskAnchors {
  root.updateMatrixWorld(true)
  const anchors: DeskAnchors = { deskTopY: null, shelfTopY: null, cableHolePoints: [], matchedNames: [] }
  const hit = (name: string, list: string[]) => list.some((p) => name.includes(p.toLowerCase()))

  root.traverse((node) => {
    const raw = node.name.trim()
    if (raw.length === 0) return
    const name = raw.toLowerCase()
    const isDeskTop = hit(name, patterns.deskTop)
    const isShelf = !isDeskTop && hit(name, patterns.shelf)
    const isHole = !isDeskTop && !isShelf && hit(name, patterns.cableHole)
    if (!isDeskTop && !isShelf && !isHole) return
    _box.setFromObject(node)
    if (_box.isEmpty()) return
    anchors.matchedNames.push(raw)
    if (isHole) {
      _box.getCenter(_center)
      anchors.cableHolePoints.push([_center.x, _center.y, _center.z])
      return
    }
    const top = _box.max.y
    if (isDeskTop) anchors.deskTopY = anchors.deskTopY === null ? top : Math.max(anchors.deskTopY, top)
    else anchors.shelfTopY = anchors.shelfTopY === null ? top : Math.max(anchors.shelfTopY, top)
  })
  return anchors
}

export interface DeskNormalizeOptions {
  fitWidthM: number | null
  centerXZ: boolean
  verticalAlign: 'bottom' | 'deskTop'
  offset: Vec3
  deskCenter: { x: number; z: number; topY: number }
  /** 预提取锚点（已含单位换算与轴校正、尚未应用等比缩放；'deskTop' 对齐用） */
  anchorsForAlign?: DeskAnchors | null
}

export interface DeskNormalizeResult {
  /** 归一化后的整体包围盒尺寸（米） */
  size: Vec3
  /** 归一化后底部离地高度（米；底部对齐时为 0） */
  minY: number
  /** 本函数应用的等比缩放（不含 mount 阶段的单位换算） */
  appliedScale: number
  /** 'deskTop' 对齐的实际平移量（米；底部对齐为 0） */
  deskTopShiftY: number
  alignUsed: 'bottom' | 'deskTop'
}

const _size = new THREE.Vector3()

/** 归一化（就地修改 root）：可选等比缩放 → 垂直对齐 → 居中 XZ → 微调 */
export function normalizeDeskModel(root: THREE.Object3D, options: DeskNormalizeOptions): DeskNormalizeResult {
  let appliedScale = 1
  if (options.fitWidthM) {
    _box.setFromObject(root)
    const width = _box.getSize(_size).x
    if (width > 1e-6) {
      appliedScale = options.fitWidthM / width
      root.scale.multiplyScalar(appliedScale)
      root.updateMatrixWorld(true)
    }
  }

  let alignUsed: 'bottom' | 'deskTop' = 'bottom'
  let deskTopShiftY = 0
  const anchorDeskTop = options.anchorsForAlign?.deskTopY
  if (options.verticalAlign === 'deskTop' && anchorDeskTop != null) {
    // 等比缩放围绕 root 原点进行：先把预提取锚点换算到缩放后的世界坐标
    const rootY0 = root.position.y
    const anchorYAfterFit = rootY0 + (anchorDeskTop - rootY0) * appliedScale
    deskTopShiftY = options.deskCenter.topY - anchorYAfterFit
    root.position.y += deskTopShiftY
    alignUsed = 'deskTop'
    root.updateMatrixWorld(true)
  }

  _box.setFromObject(root)
  if (!_box.isEmpty()) {
    if (alignUsed === 'bottom') {
      root.position.y += -_box.min.y
      root.updateMatrixWorld(true)
      _box.setFromObject(root)
    }
    if (options.centerXZ) {
      _box.getCenter(_center)
      root.position.x += options.deskCenter.x - _center.x
      root.position.z += options.deskCenter.z - _center.z
      root.updateMatrixWorld(true)
      _box.setFromObject(root)
    }
  }

  root.position.x += options.offset[0]
  root.position.y += options.offset[1]
  root.position.z += options.offset[2]
  root.updateMatrixWorld(true)
  _box.setFromObject(root)

  return {
    size: _box.isEmpty()
      ? [0, 0, 0]
      : [_box.max.x - _box.min.x, _box.max.y - _box.min.y, _box.max.z - _box.min.z],
    minY: _box.isEmpty() ? 0 : _box.min.y,
    appliedScale,
    deskTopShiftY,
    alignUsed,
  }
}

export interface DeskSurfaceMetrics {
  /** 交互层（拖拽 / 校验 / 吸附）使用的桌面高度（米） */
  deskTopY: number
  /** 书架搁板上表面高度（米） */
  shelfTopY: number
  /** 数据来源：'config' = RoomConfig 参数化口径；'model' = GLB 锚点实测 */
  source: 'config' | 'model'
  /** 归一化后的模型测量值（诊断） */
  measured: { width: number; height: number; depth: number; minY: number } | null
  /** 锚点匹配情况（诊断；未匹配到命名节点时为 null 值） */
  anchors: {
    matchedNames: string[]
    deskTopY: number | null
    shelfTopY: number | null
    cableHoleCount: number
  } | null
}

/** RoomConfig 口径的桌面高度（未加载模型或模型无锚点时的回退值） */
export function configDeskTopY(room: RoomConfig): number {
  return room.desk.height
}

/** RoomConfig 口径的搁板上表面高度（与 RoomShell / sceneValidation 一致） */
export function configShelfTopY(room: RoomConfig): number {
  return room.desk.height + room.shelf.heightAboveDesk + SHELF_THICKNESS / 2
}

/** 合并「模型实测锚点 / 归一化测量」与 RoomConfig 回退，产出交互层使用的支撑面指标 */
export function resolveDeskSurfaceMetrics(
  room: RoomConfig,
  anchors: DeskAnchors | null,
  normalized: DeskNormalizeResult | null,
): DeskSurfaceMetrics {
  const hasModelAnchor = anchors !== null && (anchors.deskTopY !== null || anchors.shelfTopY !== null)
  return {
    deskTopY: anchors?.deskTopY ?? configDeskTopY(room),
    shelfTopY: anchors?.shelfTopY ?? configShelfTopY(room),
    source: hasModelAnchor ? 'model' : 'config',
    measured: normalized
      ? {
          width: normalized.size[0],
          height: normalized.size[1],
          depth: normalized.size[2],
          minY: normalized.minY,
        }
      : null,
    anchors: anchors
      ? {
          matchedNames: anchors.matchedNames,
          deskTopY: anchors.deskTopY,
          shelfTopY: anchors.shelfTopY,
          cableHoleCount: anchors.cableHolePoints.length,
        }
      : null,
  }
}

export interface MountedDeskModel {
  normalize: DeskNormalizeResult
  anchors: DeskAnchors
  metrics: DeskSurfaceMetrics
}

/** 挂载前完整归一化流程：单位换算 + 轴校正 → 预提取锚点 → 归一化 → 最终锚点 → 指标 */
export function mountDeskModel(root: THREE.Object3D, config: DeskModelConfig, room: RoomConfig): MountedDeskModel {
  if (config.unitScale !== 1) root.scale.multiplyScalar(config.unitScale)
  if (config.axisRotationY !== 0) root.rotation.y += config.axisRotationY
  root.updateMatrixWorld(true)

  const preAnchors = extractDeskAnchors(root, config.anchorPatterns)
  const normalize = normalizeDeskModel(root, {
    fitWidthM: config.fitWidthM,
    centerXZ: config.centerXZ,
    verticalAlign: config.verticalAlign,
    offset: config.offset,
    deskCenter: deskCenterOf(room),
    anchorsForAlign: preAnchors,
  })
  const anchors = extractDeskAnchors(root, config.anchorPatterns)
  const metrics = resolveDeskSurfaceMetrics(room, anchors, normalize)
  return { normalize, anchors, metrics }
}
