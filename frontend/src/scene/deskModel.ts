import * as THREE from 'three'
import type { RoomConfig, Vec3 } from '@/types/project'
import { DESK_GAP, SHELF_THICKNESS } from '@/scene/sceneValidation'

/**
 * 桌体 GLB 模型接入：配置、归一化与实测锚点。
 * 运行时副本 `frontend/public/models/`，源资产见 `Prefabmodel/dormdesk_parts/`。
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
  /** 居中到桌面基准（x = 0，z = 桌面中心）；false 时仅做垂直对齐。未给 backWallZ 时 x / z 一起居中 */
  centerXZ: boolean
  /**
   * 后墙对齐（米）：给出时把模型背面（最小 z）贴到该 z 平面（整组固定家具用，如 0 = 后墙）；
   * 同时保留 x 居中。未给出（null）时按 centerXZ 在进深方向居中（单桌体模型用）。
   */
  backWallZ?: number | null
  /** 垂直对齐：'bottom' 底部贴地；'deskTop' 桌面锚点对齐到 RoomConfig 桌面高度（需锚点，否则退回底部对齐） */
  verticalAlign: 'bottom' | 'deskTop'
  /** 手工微调（米） */
  offset: Vec3
  anchorPatterns: DeskModelAnchorPatterns
}

/**
 * 默认配置：仓库内置的整组「上床下桌」固定家具（Blender 源 dormdesk.blend 导出；
 * 运行时副本 frontend/public/models/dorm_desk_assembled.glb）。
 *
 * 摆放口径（固定模型，实测见 frontend/docs/desk-model.md）：
 * - 单位已是米、Y-up、正面朝 +z，无需单位换算或轴校正；
 * - 尺寸保持原始比例（fitWidthM = null）；
 * - x 居中到桌面中心，背面（最小 z）贴后墙 z = 0；
 * - 桌面锚点（Desk_Top_Main / Desk_Top_L_Return）对齐到逻辑桌面高度 room.desk.height，
 *   使物品摆放面与模型桌面一致（模型标称 770mm → 对齐后整体下沉约 20mm，底脚藏于地面内）。
 *
 * 注：`Prefabmodel/dormdesk_parts/` 另提供拆分版资产（无抽屉桌体 + 三个独立抽屉，
 * 共用世界原点、抽屉可抽拉）；切换到拆分版时需改为
 * `centerXZ: false` + `verticalAlign: 'bottom'`，且不得居中，否则抽屉会与柜体错位
 * （见 docs/data_contract.md 第 1.1 节）。
 */
export const DORM_DESK_MODEL_CONFIG: DeskModelConfig = {
  url: 'models/dorm_desk_assembled.glb',
  unitScale: 1,
  axisRotationY: 0,
  fitWidthM: null,
  centerXZ: true,
  backWallZ: 0,
  verticalAlign: 'deskTop',
  offset: [0, 0, 0],
  anchorPatterns: {
    deskTop: ['desk_top', 'desktop', 'desk-top', 'tabletop', '桌面'],
    // 模型自带上层四格书架（Bookshelf_*，y 1.46–1.9）与配置层的「桌面书架」不是同一支撑面；
    // 支撑面 / 分区对齐随分区重构单独处理（见 docs/desk-model.md 已知差异），此处不参与锚点匹配。
    shelf: [],
    // 不含裸 'hole'：Cabinet_Lock_Keyhole（锁孔）会被误匹配；当前模型无出线孔节点。
    cableHole: ['cable_hole', 'cablehole', '出线孔'],
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
  /** 后墙对齐（米）：模型背面（最小 z）贴到该 z 平面；见 DeskModelConfig.backWallZ */
  backWallZ?: number | null
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
      if (options.backWallZ == null) root.position.z += options.deskCenter.z - _center.z
      root.updateMatrixWorld(true)
      _box.setFromObject(root)
    }
    if (options.backWallZ != null) {
      // 整组固定家具：背面贴后墙，不按桌面中心在进深方向居中
      root.position.z += options.backWallZ - _box.min.z
      root.updateMatrixWorld(true)
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
    backWallZ: config.backWallZ ?? null,
    verticalAlign: config.verticalAlign,
    offset: config.offset,
    deskCenter: deskCenterOf(room),
    anchorsForAlign: preAnchors,
  })
  const anchors = extractDeskAnchors(root, config.anchorPatterns)
  const metrics = resolveDeskSurfaceMetrics(room, anchors, normalize)
  return { normalize, anchors, metrics }
}

/** 床体 / 护栏 / 爬梯节点名前缀（整组家具模型俯视剖切用） */
export const DORM_DESK_BED_NODE_PREFIXES = ['bed_', 'guardrail_', 'ladder_'] as const

/**
 * 显示-only 剖切：俯视时隐藏床体 / 护栏 / 爬梯，便于查看桌面与地面布局。
 * 碰撞体与校验几何不受影响（与参数化模式 showBed 的既有口径一致）；恢复时重设为可见。
 */
export function applyBedCutaway(root: THREE.Object3D, hidden: boolean): void {
  root.traverse((node) => {
    const name = node.name.trim().toLowerCase()
    if (name.length === 0) return
    if (DORM_DESK_BED_NODE_PREFIXES.some((prefix) => name.startsWith(prefix))) node.visible = !hidden
  })
}
