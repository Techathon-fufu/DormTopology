import * as THREE from 'three'

/**
 * 抽屉推拉（桌柜分离模型）运行时：部件清单、运动学纯函数与悬停高亮。
 *
 * 模型来源 `models/dormdesk_parts/`（清单 `drawers.manifest.json`：`pull_axis = -x`、
 * 坐标与桌体同一建模坐标系，未施加平移）；运行时副本由 `scripts/sync-desk-parts.ts`
 * 同步（含材质注入）。设计与交互口径见 `frontend/docs/drawer-interaction.md`。
 *
 * 本模块的运动学部分为纯函数（可被 `scripts/check-desk-model.ts` 直跑校验）。
 */

export type DrawerSlotId = 'bot' | 'mid' | 'top'
export type DrawerOffsets = Partial<Record<DrawerSlotId, number>>

export function drawerIdForPart(name: string): DrawerSlotId | undefined {
  return name.startsWith('drawer_bottom:') ? 'bot' : name.startsWith('drawer_middle:') ? 'mid' : name.startsWith('drawer_top:') ? 'top' : undefined
}
export function drawerIdForSurface(id: string): DrawerSlotId | undefined {
  return id === 'support-drawer-bottom' ? 'bot' : id === 'support-drawer-middle' ? 'mid' : id === 'support-drawer-top' ? 'top' : undefined
}

export interface DormDeskDrawerSpec {
  id: DrawerSlotId
  /** 运行时资源路径（frontend/public 下相对路径） */
  url: string
  label: string
  /** 全开行程（米）：盒体沿滑出轴长 0.304 − 面板厚 0.018 − 2cm 重叠余量，取 0.30（实测见 docs） */
  travelM: number
}

/** 三只抽屉的运行时清单（顺序 = 自上而下语义：下 / 中 / 上层） */
export const DORM_DESK_DRAWERS: DormDeskDrawerSpec[] = [
  { id: 'bot', url: 'models/dormdesk_parts/drawer_bottom.glb', label: '下层抽屉', travelM: 0.3 },
  { id: 'mid', url: 'models/dormdesk_parts/drawer_middle.glb', label: '中层抽屉', travelM: 0.3 },
  { id: 'top', url: 'models/dormdesk_parts/drawer_top.glb', label: '上层抽屉', travelM: 0.3 },
]

/** 滑出方向（模型局部 -x）：抽屉前板 / 拉手槽位于 x 最小侧（与清单 pull_axis=-x 一致） */
export const DRAWER_SLIDE_DIRECTION_X = -1

/** 行程比例 → 局部 x 偏移（米）：progress 0 = 全闭，1 = 全开 */
export function drawerSlideX(travelM: number, progress: number): number {
  return DRAWER_SLIDE_DIRECTION_X * travelM * clampDrawerProgress(progress)
}

/** 行程比例钳制到 [0, 1]（非有限值按 0 处理） */
export function clampDrawerProgress(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/** 松手 / Esc 吸附：progress ≥ 0.5 → 全开，否则全关 */
export function snapDrawerTarget(progress: number): 0 | 1 {
  return clampDrawerProgress(progress) >= 0.5 ? 1 : 0
}

/** 每帧指数缓动逼近目标（~220ms 收敛）；已足够接近时直接落到目标 */
export function advanceDrawerProgress(
  current: number,
  target: number,
  deltaSeconds: number,
  tau = 0.22,
): number {
  const c = clampDrawerProgress(current)
  const t = clampDrawerProgress(target)
  if (Math.abs(t - c) < 1e-3) return t
  const next = t + (c - t) * Math.exp(-Math.max(0, deltaSeconds) / tau)
  return Math.abs(t - next) < 1e-3 ? t : next
}

/** 悬停高亮：调亮抽屉材质自发光（保存原值，离开时还原） */
const originalEmissive = new WeakMap<THREE.Material, { color: number; intensity: number }>()

export function setDrawerHighlight(root: THREE.Object3D, highlighted: boolean): void {
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (!(mesh as THREE.Mesh).isMesh) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue
      if (highlighted) {
        if (!originalEmissive.has(material)) {
          originalEmissive.set(material, {
            color: material.emissive.getHex(),
            intensity: material.emissiveIntensity,
          })
        }
        material.emissive.setHex(0x2e8b6a)
        material.emissiveIntensity = 0.32
      } else {
        const original = originalEmissive.get(material)
        if (!original) continue
        material.emissive.setHex(original.color)
        material.emissiveIntensity = original.intensity
      }
    }
  })
}
