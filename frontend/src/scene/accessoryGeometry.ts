import * as THREE from 'three'
import { GLTFExporter } from 'three-stdlib'
import { boxGeometry, cylinderGeometry } from '@/scene/resources'

/**
 * 理线配件「参数化外观预览」几何。
 *
 * 诚实标注：
 * - 本模块由基本体（长方体 / 圆柱）拼装生成预览几何，是「外观预览」而非可打印几何体：
 *   部件之间相互穿插、未做布尔合并与壁厚 / 公差处理，不能直接用于 3D 打印；
 * - GLB 导出已实现（导出同款外观预览模型）；STL 导出需要封闭（水密）几何生成能力，尚未接入；
 * - 几何体来自全局缓存（@/scene/resources.ts），释放时只释放本模块新建的材质。
 */

export type AccessoryKind = 'desk-clip' | 'post-hook'

export const ACCESSORY_KIND_LABELS: Record<AccessoryKind, string> = {
  'desk-clip': '桌沿理线卡扣',
  'post-hook': '立柱理线挂钩',
}

export interface AccessoryParams {
  kind: AccessoryKind
  /** 单根线缆外径（米） */
  cableDiameter: number
  /** 容纳线缆数量（根） */
  capacity: number
  /** 桌板厚度（米；桌沿卡扣用） */
  deskThickness: number
  /** 立柱截面边长（米；立柱挂钩用） */
  postSection: number
}

/** 参数允许范围（米 / 根，与界面输入约束一致） */
export const ACCESSORY_LIMITS = {
  cableDiameter: { min: 0.0015, max: 0.012 },
  capacity: { min: 1, max: 6 },
  deskThickness: { min: 0.008, max: 0.05 },
  postSection: { min: 0.012, max: 0.09 },
} as const

/** 能力标注：外观预览 vs 可打印几何体、导出能力 */
export const ACCESSORY_CAPABILITY = {
  /** 当前几何不能直接用于 3D 打印（非水密、无壁厚 / 公差处理） */
  printableGeometry: false,
  /** GLB 导出已实现（外观预览模型） */
  glbExport: true,
  /** STL 导出尚未接入（需要封闭几何生成能力） */
  stlExport: false,
} as const

export const ACCESSORY_NOTES = {
  appearance:
    '当前模型是参数化「外观预览」：由基本体拼装，部件间相互穿插，未做布尔合并、壁厚与打印公差处理，不能直接用于 3D 打印。',
  glb: 'GLB 导出已实现：导出的是外观预览模型（查看 / 演示用），非打印级几何。',
  stl: '尚未接入：STL 导出需要封闭（水密）几何生成能力（布尔合并），当前不具备，因此暂不提供。',
} as const

/** 单个规格项：数值型（米，由界面格式化为 mm）或文本型（已含单位） */
export interface AccessorySpec {
  label: string
  valueM?: number
  text?: string
}

/** 归一化后的参数与推导尺寸（预览与规格表共用，均为米 / 根） */
export interface NormalizedAccessory {
  kind: AccessoryKind
  cableDiameter: number
  capacity: number
  deskThickness: number
  postSection: number
  /** 相邻线缆中心距 */
  cableStep: number
  /** 走线通道总高 */
  channelHeight: number
  /** 走线通道深度（从安装面外侧算起） */
  channelDepth: number
  /** 沿安装方向的宽度 */
  width: number
  /** 夹口高度（卡扣 = 桌板厚度 + 双侧板厚；挂钩 = 适配立柱截面） */
  grip: number
  totalHeight: number
  totalDepth: number
  /** 走线通道底板顶面（局部 y） */
  shelfTop: number
  /** 通道起始 z（相对安装面中心） */
  channelZ0: number
}

/** 板件厚度（米） */
const PLATE = 0.0028
/** 桌沿卡扣沿桌沿方向的宽度（米） */
const CLIP_WIDTH = 0.02
/** 相邻线缆之间的最小间隙（米） */
const CABLE_CLEARANCE = 0.0012

function clampNum(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export function normalizeAccessoryParams(params: AccessoryParams): NormalizedAccessory {
  const cableDiameter = clampNum(
    params.cableDiameter,
    ACCESSORY_LIMITS.cableDiameter.min,
    ACCESSORY_LIMITS.cableDiameter.max,
  )
  const capacity = Math.round(
    clampNum(params.capacity, ACCESSORY_LIMITS.capacity.min, ACCESSORY_LIMITS.capacity.max),
  )
  const deskThickness = clampNum(
    params.deskThickness,
    ACCESSORY_LIMITS.deskThickness.min,
    ACCESSORY_LIMITS.deskThickness.max,
  )
  const postSection = clampNum(
    params.postSection,
    ACCESSORY_LIMITS.postSection.min,
    ACCESSORY_LIMITS.postSection.max,
  )
  const cableStep = cableDiameter + CABLE_CLEARANCE

  if (params.kind === 'desk-clip') {
    const channelHeight = capacity * cableDiameter + (capacity - 1) * CABLE_CLEARANCE
    const channelDepth = cableDiameter + 0.006
    return {
      kind: 'desk-clip',
      cableDiameter,
      capacity,
      deskThickness,
      postSection,
      cableStep,
      channelHeight,
      channelDepth,
      width: CLIP_WIDTH,
      grip: deskThickness + PLATE * 2,
      totalHeight: deskThickness + 0.014 + PLATE * 2,
      totalDepth: 0.008 + channelDepth,
      shelfTop: -deskThickness / 2 - 0.014,
      channelZ0: 0.008,
    }
  }

  const channelHeight = cableDiameter + 0.004
  const channelDepth = cableDiameter + 0.008
  return {
    kind: 'post-hook',
    cableDiameter,
    capacity,
    deskThickness,
    postSection,
    cableStep,
    channelHeight,
    channelDepth,
    width: capacity * cableDiameter + (capacity - 1) * CABLE_CLEARANCE + 0.006,
    grip: postSection,
    totalHeight: 0.04,
    totalDepth: postSection / 2 + PLATE + channelDepth,
    shelfTop: -0.018,
    channelZ0: postSection / 2 + PLATE,
  }
}

/** 规格表：由参数推导的几何尺寸（供界面以 mm 展示） */
export function accessoryDimSpecs(params: AccessoryParams): AccessorySpec[] {
  const g = normalizeAccessoryParams(params)
  const sizeText = `${Math.round(g.width * 1000)} × ${Math.round(g.totalHeight * 1000)} × ${Math.round(g.totalDepth * 1000)} mm`
  const channelText = `${Math.round(g.channelDepth * 1000)} × ${Math.round(g.channelHeight * 1000)} mm`
  if (g.kind === 'desk-clip') {
    return [
      { label: '夹持桌板厚度', valueM: g.deskThickness },
      { label: '走线通道 深 × 高', text: channelText },
      { label: '适应线径', valueM: g.cableDiameter },
      { label: '容纳线缆', text: `${g.capacity} 根` },
      { label: '整体 宽 × 高 × 深', text: sizeText },
    ]
  }
  return [
    { label: '适配立柱截面', valueM: g.postSection },
    { label: '挂架宽度', valueM: g.width },
    { label: '走线通道 深 × 高', text: channelText },
    { label: '适应线径', valueM: g.cableDiameter },
    { label: '容纳线缆', text: `${g.capacity} 根` },
    { label: '整体 宽 × 高 × 深', text: sizeText },
  ]
}

/**
 * 构建配件预览几何（外观预览）。
 * 每次调用新建材质；几何体复用全局缓存，卸载时请调用 disposeAccessoryGroup。
 */
export function buildAccessoryGroup(params: AccessoryParams): THREE.Group {
  const g = normalizeAccessoryParams(params)
  const group = new THREE.Group()
  group.name = `${g.kind}-preview`

  // 本模块自建材质（不进入全局材质缓存），随 disposeAccessoryGroup 释放
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#4C5A67', roughness: 0.55, metalness: 0.12 })
  const cableMat = new THREE.MeshStandardMaterial({ color: '#3B424D', roughness: 0.9 })
  const proxyMat = new THREE.MeshStandardMaterial({
    color: '#C9B998',
    roughness: 0.9,
    transparent: true,
    opacity: 0.42,
  })

  const addBox = (w: number, h: number, d: number, pos: [number, number, number], mat: THREE.Material) => {
    const mesh = new THREE.Mesh(boxGeometry(w, h, d), mat)
    mesh.position.set(pos[0], pos[1], pos[2])
    group.add(mesh)
    return mesh
  }

  if (g.kind === 'desk-clip') {
    const t = g.deskThickness
    // 上盖 / 下托：跨过桌板前后
    addBox(g.width, PLATE, 0.016, [0, t / 2 + PLATE / 2, 0], bodyMat)
    addBox(g.width, PLATE, 0.012, [0, -t / 2 - PLATE / 2, -0.004], bodyMat)
    // 外侧壁（把上下两片连成夹口）
    addBox(g.width, t + 0.014, PLATE, [0, -0.007, g.channelZ0 - PLATE / 2], bodyMat)
    // 走线通道底板
    addBox(
      g.width,
      PLATE,
      g.channelDepth,
      [0, g.shelfTop - PLATE / 2, g.channelZ0 + g.channelDepth / 2],
      bodyMat,
    )
    // 通道两侧壁 + 前端限位凸缘
    for (const sx of [-1, 1]) {
      addBox(
        PLATE,
        g.channelHeight,
        g.channelDepth,
        [sx * (g.width / 2 - PLATE / 2), g.shelfTop + g.channelHeight / 2, g.channelZ0 + g.channelDepth / 2],
        bodyMat,
      )
    }
    addBox(
      g.width,
      0.0022,
      0.0032,
      [0, g.shelfTop + g.channelHeight + 0.0011, g.channelZ0 + g.channelDepth - 0.0016],
      bodyMat,
    )
    // 桌板参考体（半透明）
    addBox(0.07, t, 0.09, [0, 0, -0.045], proxyMat)
    // 线缆束（沿桌沿方向）
    for (let i = 0; i < g.capacity; i += 1) {
      const cable = new THREE.Mesh(
        cylinderGeometry(g.cableDiameter / 2, g.cableDiameter / 2, g.width + 0.01, 12),
        cableMat,
      )
      cable.rotation.z = Math.PI / 2
      cable.position.set(
        0,
        g.shelfTop + g.cableDiameter / 2 + i * g.cableStep,
        g.channelZ0 + g.channelDepth / 2,
      )
      group.add(cable)
    }
  } else {
    const s = g.postSection
    // 背板 + 两侧抱臂（抱住立柱）
    addBox(g.width, 0.04, PLATE, [0, 0, s / 2 + PLATE / 2], bodyMat)
    for (const sx of [-1, 1]) {
      addBox(PLATE, 0.034, s + 0.012, [sx * (g.width / 2 - PLATE / 2), 0, 0], bodyMat)
    }
    // 承线托板 + 前端限位
    addBox(
      g.width + 0.002,
      PLATE,
      g.channelDepth,
      [0, g.shelfTop - PLATE / 2, s / 2 + PLATE + g.channelDepth / 2],
      bodyMat,
    )
    addBox(
      g.width + 0.002,
      0.014,
      PLATE,
      [0, g.shelfTop - PLATE + 0.007, s / 2 + PLATE + g.channelDepth - PLATE / 2],
      bodyMat,
    )
    // 立柱参考体（半透明）
    const post = new THREE.Mesh(boxGeometry(s, 0.22, s), proxyMat)
    group.add(post)
    // 线缆束（竖直悬挂）
    for (let i = 0; i < g.capacity; i += 1) {
      const cable = new THREE.Mesh(
        cylinderGeometry(g.cableDiameter / 2, g.cableDiameter / 2, 0.085, 12),
        cableMat,
      )
      cable.position.set(
        (i - (g.capacity - 1) / 2) * g.cableStep,
        g.shelfTop + 0.0425,
        s / 2 + PLATE + g.channelDepth / 2,
      )
      group.add(cable)
    }
  }

  return group
}

/** 释放本模块新建的材质（几何体来自全局缓存，不在此释放） */
export function disposeAccessoryGroup(group: THREE.Group): void {
  group.traverse((obj) => {
    const mesh = obj as THREE.Mesh
    if (!mesh.isMesh) return
    const material = mesh.material
    const list = Array.isArray(material) ? material : [material]
    for (const m of list) m.dispose()
  })
}

/**
 * 导出配件为 GLB（外观预览模型，二进制 ArrayBuffer）。
 * 导出用几何临时构建，完成后立即释放。
 */
export function exportAccessoryToGlb(params: AccessoryParams): Promise<ArrayBuffer> {
  const group = buildAccessoryGroup(params)
  return new Promise((resolve, reject) => {
    const fail = (error: unknown) => {
      disposeAccessoryGroup(group)
      const message =
        error && typeof error === 'object' && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : String(error)
      reject(new Error(message || 'GLB 导出失败'))
    }
    const exporter = new GLTFExporter()
    exporter.parse(
      group,
      (gltf) => {
        disposeAccessoryGroup(group)
        if (gltf instanceof ArrayBuffer) resolve(gltf)
        else reject(new Error('导出器未返回二进制结果'))
      },
      fail,
      { binary: true },
    )
  })
}
