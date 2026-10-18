import { OUTLET_FIXED_Y_M, type RoomConfig, type Vec3 } from '@/types/project'
import { createStandardRoom } from '@/data/demoProject'
import { normalizeProductRoom } from '@/data/fixedRoom'
import { mmToM, mToMm } from '@/lib/units'

/**
 * 空间配置表单模型（单位：毫米 mm，面向用户）。
 * 与 RoomConfig（三维内部使用米）之间必须经过本文件的 formToRoom / roomToForm 转换。
 *
 * 固定模型口径：
 * - 床桌 / 房间 / 立柱 / 书架 / 出线孔为预设固定模型，不提供结构与尺寸编辑（数值随房间数据原样带通）；
 * - 墙面插座：一块「双插孔 ×2」面板，离地高度固定 OUTLET_FIXED_Y_MM，仅可沿后墙左右移动（X）。
 */

/** 示例床架床板下沿高度（mm），用于书架结构冲突校验 */
export const BED_UNDERSIDE_MM = 1580
/** 桌面后沿与后墙的留缝（mm） */
export const DESK_WALL_GAP_MM = 50

/** 后墙插座固定离地高度（mm，与 @/types/project 的 OUTLET_FIXED_Y_M 一致） */
export const OUTLET_FIXED_Y_MM = Math.round(OUTLET_FIXED_Y_M * 1000)
/** 插座距墙面左右边缘的最小边距（mm） */
export const OUTLET_EDGE_MARGIN_MM = 60

export interface SpacePostForm {
  id: string
  x: number
  z: number
  section: number
}

export interface SpaceOutletForm {
  id: string
  x: number
  y: number
}

export interface SpaceForm {
  furnitureModel?: RoomConfig['furnitureModel']
  deskW: number
  deskD: number
  deskH: number
  deskT: number
  roomL: number
  roomW: number
  roomH: number
  shelfEnabled: boolean
  shelfLevels: number
  shelfAbove: number
  shelfDepth: number
  posts: SpacePostForm[]
  hole: { x: number; z: number; diameter: number }
  outlets: SpaceOutletForm[]
}

export const DEFAULT_HOLE_X_MM = 500

export interface ValidationIssue {
  id: string
  level: 'error' | 'warning'
  message: string
}

/** 空间校验（错误将阻止保存）：出线孔仅左右可调，插座仅左右可调 */
export function validateSpace(f: SpaceForm): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const push = (id: string, level: ValidationIssue['level'], message: string) =>
    issues.push({ id, level, message })

  // 插座（固定模型：一块双插孔 ×2 面板，仅可沿后墙左右移动，高度固定）
  f.outlets.forEach((o, i) => {
    const xMax = f.roomL / 2 - OUTLET_EDGE_MARGIN_MM
    if (Math.abs(o.x) > xMax) {
      push(
        `outlet-${i}-x`,
        'error',
        `插座超出后墙范围：X 需在 ±${Math.round(xMax)} mm 内（距墙面左右边缘至少 ${OUTLET_EDGE_MARGIN_MM} mm）`,
      )
    }
  })

  return issues
}

export function roomToForm(room: RoomConfig): SpaceForm {
  room = normalizeProductRoom(room)
  const hole = room.cableHoles[0]
  return {
    furnitureModel: room.furnitureModel,
    deskW: mToMm(room.desk.width),
    deskD: mToMm(room.desk.depth),
    deskH: mToMm(room.desk.height),
    deskT: mToMm(room.desk.thickness),
    roomL: mToMm(room.length),
    roomW: mToMm(room.width),
    roomH: mToMm(room.height),
    shelfEnabled: room.shelf.enabled,
    shelfLevels: room.shelf.levels,
    shelfAbove: mToMm(room.shelf.heightAboveDesk),
    shelfDepth: mToMm(room.shelf.depth),
    posts: room.posts.map((p) => ({
      id: p.id,
      x: mToMm(p.position[0]),
      z: mToMm(p.position[2]),
      section: mToMm(p.section),
    })),
    hole: hole
      ? {
          x: mToMm(hole.position[0]),
          z: mToMm(hole.position[2]),
          diameter: mToMm(hole.diameter),
        }
      : { x: DEFAULT_HOLE_X_MM, z: DESK_WALL_GAP_MM + 230, diameter: 50 },
    // 固定模型：墙面仅一块「双插孔 ×2」面板（历史数据如含多个，仅保留第一个）
    outlets:
      room.outlets.length > 0
        ? [{ id: room.outlets[0].id, x: mToMm(room.outlets[0].position[0]), y: OUTLET_FIXED_Y_MM }]
        : [defaultOutletForm()],
  }
}

export function formToRoom(f: SpaceForm): RoomConfig {
  return normalizeProductRoom({
    template: 'loft-standard',
    furnitureModel: f.furnitureModel,
    length: mmToM(f.roomL),
    width: mmToM(f.roomW),
    height: mmToM(f.roomH),
    desk: {
      width: mmToM(f.deskW),
      depth: mmToM(f.deskD),
      thickness: mmToM(f.deskT),
      height: mmToM(f.deskH),
    },
    shelf: {
      enabled: f.shelfEnabled,
      levels: f.shelfLevels,
      heightAboveDesk: mmToM(f.shelfAbove),
      depth: mmToM(f.shelfDepth),
    },
    posts: f.posts.map((p, i) => ({
      id: p.id || `post-${i + 1}`,
      position: [mmToM(p.x), 0, mmToM(p.z)] as Vec3,
      section: mmToM(p.section),
    })),
    cableHoles: [],
    outlets: [
      {
        id: f.outlets[0]?.id || 'outlet-1',
        position: [mmToM(f.outlets[0]?.x ?? 0), mmToM(OUTLET_FIXED_Y_MM), 0.01] as Vec3,
        label: '后墙插座（双插孔 ×2）',
        slots: 2,
      },
    ],
    note: '固定正式床桌及后沿长槽；仅墙面插座位置可调整',
  })
}

/** 标准空间默认值（上床下桌标准款：床桌 / 房间 / 立柱为固定模型数值） */
export function demoSpaceForm(): SpaceForm {
  return roomToForm(createStandardRoom())
}

/** 墙面插座默认表单（一块双插孔 ×2 面板：后墙居中、高度固定） */
export function defaultOutletForm(): SpaceOutletForm {
  return { id: 'outlet-1', x: 0, y: OUTLET_FIXED_Y_MM }
}
