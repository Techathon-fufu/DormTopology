import { DESKTOP_REGIONS, DESKTOP_CENTER_X } from './desktopBindings'
import type { RoomConfig } from '@/types/project'
import { furnitureSurfaces, hasFixedFurniture, type FurnitureSurface } from './fixedFurniture'
import { DESK_GAP, shelfTopY } from '@/scene/sceneValidation'
import {
  CUP_AREA_SIZE,
  TYPING_AREA_DEPTH,
  type CupCorner,
  type OrganizationPreferences,
} from '@/types/organization'

/**
 * 空间整理三区（桌面常用区 / 书架收纳区 / 桌下隐藏区）的可用矩形计算。
 * rect 表示「物品包围盒（宽 × 深）必须完整放入」的范围，y 为该区的放置面高度（米）。
 * 三维参考线叠加（ZoneOverlay）与规则式布局算法（ruleLayout）共用这里的计算，保证一致。
 */

export interface ZoneRect {
  x0: number
  x1: number
  z0: number
  z1: number
}

export interface RectOnPlane {
  rect: ZoneRect
  /** 放置面高度（米） */
  y: number
}

/** 床架横梁下沿高度（与 RoomShell 渲染一致）：上床下桌的净空上界 */
export const BED_UNDERSIDE_Y = 1.62 - 0.037 - 0.035

export function clampNumber(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}

export interface OrganizationZones {
  /** Fixed furniture ergonomics, measured from the runtime desk GLB. */
  workstation?: {
    slotCenterX: number
    monitor: RectOnPlane
    laptop: RectOnPlane & { rotationY: number }
    keyboard: RectOnPlane
    mouse: RectOnPlane
    miscellaneous: RectOnPlane
    operation: RectOnPlane
    seated: RectOnPlane
    study: FurnitureSurface
  }
  deskSurfaces?: RectOnPlane[]
  storageSurfaces?: FurnitureSurface[]
  /** 桌面整体可用面（含打字 / 水杯活动区投影，用于放置面定位） */
  deskSurface: RectOnPlane
  /** 桌面后带（靠墙一侧，显示器 / 台灯 / 带电设备） */
  deskBackBand: RectOnPlane
  /** 桌面左前带（键鼠操作区左侧，常用物品易取位） */
  deskLeftBand: RectOnPlane
  /** 桌面右前带（键鼠操作区右侧） */
  deskRightBand: RectOnPlane
  /** 打字活动区（键鼠操作空间，其它物品默认避让） */
  typing: RectOnPlane
  /** 水杯活动区 */
  cup: RectOnPlane
  /** 书架收纳区（未启用书架时为 null） */
  shelf: (RectOnPlane & { clearance: number }) | null
  /** 桌下隐藏区（桌板下沿与四根桌腿之间的地面区域） */
  underDesk: RectOnPlane & { clearance: number }
}

/** 水杯活动区矩形（四角之一） */
export function cupCornerRect(
  corner: CupCorner,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  size = CUP_AREA_SIZE,
  offset = 0.02,
): ZoneRect {
  const left = { x0: x0 + offset, x1: x0 + offset + size }
  const right = { x0: x1 - offset - size, x1: x1 - offset }
  const back = { z0: z0 + offset, z1: z0 + offset + size }
  const front = { z0: z1 - offset - size, z1: z1 - offset }
  const xr = corner === 'backLeft' || corner === 'frontLeft' ? left : right
  const zr = corner === 'backLeft' || corner === 'backRight' ? back : front
  return { x0: xr.x0, x1: xr.x1, z0: zr.z0, z1: zr.z1 }
}

export function computeOrganizationZones(
  room: RoomConfig,
  prefs: OrganizationPreferences,
): OrganizationZones {
  const desk = room.desk
  const fixed = hasFixedFurniture(room)
  const surfaces = fixed ? furnitureSurfaces(room, false) : []
  const main = surfaces.find((s) => s.id.includes('Main'))
  const x0 = main ? main.rect.x0 + .02 : -desk.width / 2 + .03
  const x1 = main ? main.rect.x1 - .02 : desk.width / 2 - .03
  const z0 = (main?.rect.z0 ?? DESK_GAP) + 0.02
  const z1 = (main?.rect.z1 ?? DESK_GAP + desk.depth) - 0.02
  const deskY = desk.height

  // 打字活动区：桌面靠人一侧居中（可偏左 / 偏右、可调宽度）
  const typingW = clampNumber(prefs.typingWidth, 0.32, Math.max(0.32, fixed ? x1 - x0 - .3 : desk.width - .5))
  const typingCx = clampNumber(
    prefs.typingOffsetX,
    fixed ? x0 + typingW / 2 + .02 : -desk.width / 2 + typingW / 2 + .04,
    fixed ? x1 - typingW / 2 - .02 : desk.width / 2 - typingW / 2 - .04,
  )
  const typingZ1 = z1
  const typingZ0 = Math.max(z0 + 0.06, z1 - TYPING_AREA_DEPTH)
  const typing: RectOnPlane = {
    rect: { x0: typingCx - typingW / 2, x1: typingCx + typingW / 2, z0: typingZ0, z1: typingZ1 },
    y: deskY,
  }

  // 水杯活动区：桌面四角之一
  const cupDesk = fixed && prefs.cupCorner.includes('Right') ? surfaces.find((s) => s.id.includes('Return'))?.rect : null
  const cup: RectOnPlane = {
    rect: cupDesk ? cupCornerRect(prefs.cupCorner, cupDesk.x0 + .02, cupDesk.x1 - .02, cupDesk.z0 + .02, cupDesk.z1 - .02) : cupCornerRect(prefs.cupCorner, x0, x1, z0, z1),
    y: deskY,
  }

  // 桌面后带：后墙与打字活动区之间
  const backZ1 = Math.max(z0 + 0.06, typingZ0 - 0.03)
  const deskBackBand: RectOnPlane = { rect: { x0, x1, z0, z1: backZ1 }, y: deskY }

  // 桌面左右前带：与打字活动区同排的左右两侧
  const leftX1 = Math.max(x0, typing.rect.x0 - 0.02)
  const rightX0 = Math.min(x1, typing.rect.x1 + 0.02)
  const deskLeftBand: RectOnPlane = {
    rect: { x0, x1: leftX1, z0: typingZ0, z1: typingZ1 },
    y: deskY,
  }
  const deskRightBand: RectOnPlane = {
    rect: { x0: rightX0, x1, z0: typingZ0, z1: typingZ1 },
    y: deskY,
  }

  const deskSurface: RectOnPlane = { rect: { x0, x1, z0, z1 }, y: deskY }
  // GLB Desk_Top_Main notch: x=[-.13,.42], z=[.06,.085].
  // The return begins at x=.59; only its part beyond the main front edge is for daily items.
  const plane = (x0: number, x1: number, z0: number, z1: number): RectOnPlane => ({ rect: { x0, x1, z0, z1 }, y: deskY })
  const workstation: OrganizationZones['workstation'] = fixed ? {
    slotCenterX: DESKTOP_CENTER_X,
    monitor: { rect: DESKTOP_REGIONS.monitor, y: deskY },
    laptop: { ...plane(.47, .98, .10, .59), rotationY: -Math.PI / 9 },
    keyboard: { rect: DESKTOP_REGIONS.keyboard, y: deskY },
    mouse: { rect: DESKTOP_REGIONS.mouse, y: deskY },
    miscellaneous: { rect: { x0: .45, x1: .68, z0: .085, z1: .21 }, y: deskY },
    operation: plane(-.025, .315, .51, .59),
    seated: { ...plane(-.155, .445, .61, 1.11), y: 0 },
    study: surfaces.find((s) => s.id === 'support-shelf-2')!,
  } : undefined

  // 书架收纳区：搁板上表面
  let shelf: OrganizationZones['shelf'] = null
  if (fixed) {
    const s = surfaces.find((s) => s.kind === 'shelf')!
    shelf = { rect: s.rect, y: s.y, clearance: s.clearance }
  } else if (room.shelf.enabled) {
    const sw = desk.width - 0.2
    const sx0 = -sw / 2 + 0.02
    const sx1 = sw / 2 - 0.02
    const sz0 = DESK_GAP + 0.01
    const sz1 = DESK_GAP + room.shelf.depth - 0.01
    const y = shelfTopY(room)
    shelf = {
      rect: { x0: sx0, x1: sx1, z0: sz0, z1: sz1 },
      y,
      clearance: Math.max(0, BED_UNDERSIDE_Y - y - 0.01),
    }
  }

  // 桌下隐藏区：桌板下方、内收避开桌腿的地面区域
  const underDesk: OrganizationZones['underDesk'] = {
    rect: {
      x0: main ? main.rect.x0 + .02 : -desk.width / 2 + 0.1,
      x1: main ? main.rect.x1 - .02 : desk.width / 2 - 0.1,
      z0: main ? main.rect.z0 + .02 : DESK_GAP + 0.1,
      z1: main ? main.rect.z1 - .02 : DESK_GAP + desk.depth - 0.08,
    },
    y: 0,
    clearance: Math.max(0, desk.height - desk.thickness - 0.02),
  }

  return { workstation, deskSurface, deskBackBand, deskLeftBand, deskRightBand, typing, cup, shelf, underDesk,
    ...(fixed ? { deskSurfaces: surfaces.filter((s) => s.kind === 'desk').map((s) => ({ ...s, rect: { x0: s.rect.x0 + .01, x1: s.rect.x1 - .01, z0: s.rect.z0 + .01, z1: s.rect.z1 - .01 } })), storageSurfaces: surfaces.filter((s) => s.kind !== 'desk') } : {}),
  }
}
