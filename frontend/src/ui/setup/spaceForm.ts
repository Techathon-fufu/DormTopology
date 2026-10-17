import type { RoomConfig, Vec3 } from '@/types/project'
import { createStandardRoom } from '@/data/demoProject'
import { mmToM, mToMm } from '@/lib/units'
import { uid } from '@/lib/utils'

/**
 * 空间配置表单模型（单位：毫米 mm，面向用户）。
 * 与 RoomConfig（三维内部使用米）之间必须经过本文件的 formToRoom / roomToForm 转换。
 */

/** 示例床架床板下沿高度（mm），用于书架结构冲突校验 */
export const BED_UNDERSIDE_MM = 1580
/** 桌面后沿与后墙的留缝（mm） */
export const DESK_WALL_GAP_MM = 50

/**
 * 墙面插座：距地默认高度（mm）与距地 / 距顶最小边距（mm）。
 * 高度可调范围由「墙体高度」决定：OUTLET_WALL_MARGIN_MM ～ 房间高度 − OUTLET_WALL_MARGIN_MM。
 */
export const OUTLET_DEFAULT_Y_MM = 350
/** 距地 / 距顶最小边距（mm）：插座不得移出墙体 */
export const OUTLET_WALL_MARGIN_MM = 50
/** 高度建议范围（mm，超出仅提示，不阻止保存） */
export const OUTLET_ADVICE_Y_MM = { min: 150, max: 1400 }

/** 把插座高度夹紧到墙体范围内（mm；roomH 为房间高度 mm） */
export function clampOutletY(y: number, roomH: number): number {
  const max = Math.max(OUTLET_WALL_MARGIN_MM, roomH - OUTLET_WALL_MARGIN_MM)
  return Math.round(Math.min(Math.max(y, OUTLET_WALL_MARGIN_MM), max))
}

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

export const SPACE_RANGES = {
  deskW: { label: '桌面长度', min: 600, max: 2400 },
  deskD: { label: '桌面进深', min: 400, max: 1200 },
  deskH: { label: '桌面高度', min: 500, max: 1000 },
  deskT: { label: '桌板厚度', min: 15, max: 60 },
  roomL: { label: '房间长度', min: 1500, max: 6000 },
  roomW: { label: '房间进深', min: 1000, max: 4000 },
  roomH: { label: '房间层高', min: 1800, max: 3500 },
  shelfAbove: { label: '书架离桌高度', min: 200, max: 800 },
  shelfDepth: { label: '搁板深度', min: 100, max: 400 },
  section: { label: '立柱截面', min: 20, max: 80 },
  holeDiameter: { label: '出线孔直径', min: 30, max: 120 },
} as const

export type SpaceRangeKey = keyof typeof SPACE_RANGES

export interface ValidationIssue {
  id: string
  level: 'error' | 'warning'
  message: string
}

const RANGE_FIELDS: Array<[SpaceRangeKey, keyof SpaceForm]> = [
  ['deskW', 'deskW'],
  ['deskD', 'deskD'],
  ['deskH', 'deskH'],
  ['deskT', 'deskT'],
  ['roomL', 'roomL'],
  ['roomW', 'roomW'],
  ['roomH', 'roomH'],
  ['shelfAbove', 'shelfAbove'],
  ['shelfDepth', 'shelfDepth'],
]

/** 数值范围 + 明显的结构冲突校验（错误将阻止保存） */
export function validateSpace(f: SpaceForm): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const push = (id: string, level: ValidationIssue['level'], message: string) =>
    issues.push({ id, level, message })

  for (const [key, field] of RANGE_FIELDS) {
    const range = SPACE_RANGES[key]
    const value = f[field] as number
    if (!Number.isFinite(value)) {
      push(`range-${key}`, 'error', `${range.label}不是有效数字`)
    } else if (value < range.min || value > range.max) {
      push(
        `range-${key}`,
        'error',
        `${range.label}需在 ${range.min}–${range.max} mm 之间（当前 ${value} mm）`,
      )
    }
  }

  // 桌面与房间
  if (f.deskW > f.roomL - 100) {
    push(
      'desk-room-x',
      'error',
      `桌面长度 ${f.deskW} mm 超出房间：房间长度 ${f.roomL} mm，书桌左右需各留 ≥ 50 mm 余量`,
    )
  }
  if (f.deskD > f.roomW - 200) {
    push(
      'desk-room-z',
      'error',
      `桌面进深 ${f.deskD} mm 超出房间：房间进深 ${f.roomW} mm，座位区需留 ≥ 200 mm`,
    )
  }

  // 书架结构冲突（对照示例床架）
  if (f.shelfEnabled) {
    const headroom = f.deskH + f.shelfAbove + 250
    if (headroom > BED_UNDERSIDE_MM) {
      push(
        'shelf-bed',
        'error',
        `书架与床板冲突：桌面高度 ${f.deskH} + 离桌高度 ${f.shelfAbove} + 取物空间 250 = ${headroom} mm，超过示例床架下沿 ${BED_UNDERSIDE_MM} mm`,
      )
    }
    if (f.shelfDepth > f.deskD - 100) {
      push('shelf-depth', 'warning', '搁板深度接近桌面进深，显示器与大件物品的摆放空间将受限')
    }
  }

  // 立柱
  f.posts.forEach((p, i) => {
    const half = p.section / 2
    if (p.section < SPACE_RANGES.section.min || p.section > SPACE_RANGES.section.max) {
      push(
        `post-${i}-section`,
        'error',
        `立柱 ${i + 1} 截面需在 ${SPACE_RANGES.section.min}–${SPACE_RANGES.section.max} mm 之间`,
      )
    }
    if (Math.abs(p.x) + half > f.roomL / 2) {
      push(`post-${i}-x`, 'error', `立柱 ${i + 1} 超出房间（X 方向）`)
    }
    if (p.z - half < 0 || p.z + half > f.roomW) {
      push(`post-${i}-z`, 'error', `立柱 ${i + 1} 超出房间（Z 方向）`)
    }
    const inX = Math.abs(p.x) < f.deskW / 2 + half
    const inZ = p.z > DESK_WALL_GAP_MM - half && p.z < DESK_WALL_GAP_MM + f.deskD + half
    if (inX && inZ) {
      push(
        `post-${i}-desk`,
        'error',
        `立柱 ${i + 1} 落在桌面范围内，会与桌板结构冲突（请移出桌面或改为侧边立柱）`,
      )
    }
  })
  for (let i = 0; i < f.posts.length; i += 1) {
    for (let j = i + 1; j < f.posts.length; j += 1) {
      const a = f.posts[i]
      const b = f.posts[j]
      const dist = Math.hypot(a.x - b.x, a.z - b.z)
      const minDist = (a.section + b.section) / 2 + 40
      if (dist < minDist) {
        push(
          `posts-${i}-${j}`,
          'error',
          `立柱 ${i + 1} 与立柱 ${j + 1} 距离过近（${Math.round(dist)} mm < ${Math.round(minDist)} mm），无法安装`,
        )
      }
    }
  }

  // 出线孔
  if (f.hole.diameter < SPACE_RANGES.holeDiameter.min || f.hole.diameter > SPACE_RANGES.holeDiameter.max) {
    push(
      'hole-diameter',
      'error',
      `出线孔直径需在 ${SPACE_RANGES.holeDiameter.min}–${SPACE_RANGES.holeDiameter.max} mm 之间`,
    )
  }
  if (
    Math.abs(f.hole.x) > f.deskW / 2 - 40 ||
    f.hole.z < DESK_WALL_GAP_MM + 40 ||
    f.hole.z > DESK_WALL_GAP_MM + f.deskD - 40
  ) {
    push('hole-position', 'error', '出线孔需位于桌面范围内，且距桌面边缘 ≥ 40 mm')
  }

  // 插座
  f.outlets.forEach((o, i) => {
    if (Math.abs(o.x) > f.roomL / 2 - 60) {
      push(`outlet-${i}-x`, 'error', `插座 ${i + 1} 超出墙面范围（X 方向）`)
    }
    const yMax = f.roomH - OUTLET_WALL_MARGIN_MM
    if (o.y < OUTLET_WALL_MARGIN_MM || o.y > yMax) {
      push(
        `outlet-${i}-y`,
        'error',
        `插座 ${i + 1} 超出墙体高度范围（${OUTLET_WALL_MARGIN_MM}–${yMax} mm，不得移出墙体）`,
      )
    } else if (o.y < OUTLET_ADVICE_Y_MM.min || o.y > OUTLET_ADVICE_Y_MM.max) {
      push(
        `outlet-${i}-y`,
        'warning',
        `插座 ${i + 1} 高度建议在 ${OUTLET_ADVICE_Y_MM.min}–${OUTLET_ADVICE_Y_MM.max} mm（当前 ${o.y} mm）`,
      )
    }
  })

  return issues
}

export function roomToForm(room: RoomConfig): SpaceForm {
  const hole = room.cableHoles[0]
  return {
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
      : { x: 0, z: DESK_WALL_GAP_MM + 70, diameter: 50 },
    outlets: room.outlets.map((o) => ({ id: o.id, x: mToMm(o.position[0]), y: mToMm(o.position[1]) })),
  }
}

export function formToRoom(f: SpaceForm): RoomConfig {
  return {
    template: 'loft-standard',
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
    cableHoles: [
      {
        id: 'hole-1',
        position: [mmToM(f.hole.x), mmToM(f.deskH), mmToM(f.hole.z)] as Vec3,
        diameter: mmToM(f.hole.diameter),
      },
    ],
    outlets: f.outlets.map((o, i) => ({
      id: o.id,
      position: [mmToM(o.x), mmToM(o.y), 0.01] as Vec3,
      label: `后墙插座·${i + 1}`,
      slots: 2,
    })),
    note: '空间尺寸由「空间配置」填写（表单单位 mm，三维内部使用米）；默认值为示例尺寸，请以实际测量为准',
  }
}

/** 示例空间：上床下桌标准款（1200 × 600 × 750 mm 等，均为可修改的示例值） */
export function demoSpaceForm(): SpaceForm {
  return roomToForm(createStandardRoom())
}

export function newPostForm(x = 0, z = 70, section = 40): SpacePostForm {
  return { id: uid('post'), x, z, section }
}

export function newOutletForm(x = 0, y = OUTLET_DEFAULT_Y_MM): SpaceOutletForm {
  return { id: uid('outlet'), x, y }
}

/** 快捷立柱布置：四角布置 / 靠墙两根（位置均为可再微调的估计值） */
export function presetPosts(kind: 'corners' | 'wall', f: SpaceForm): SpacePostForm[] {
  const span = Math.max(1900, f.deskW) - 40
  const x = Math.min(span / 2, f.roomL / 2 - 60)
  const zFront = 70
  const zBack = Math.min(830, f.roomW - 100)
  const section = f.posts[0]?.section ?? 40
  const posts: SpacePostForm[] = [
    newPostForm(-x, zFront, section),
    newPostForm(x, zFront, section),
  ]
  if (kind === 'corners') {
    posts.push(newPostForm(-x, zBack, section), newPostForm(x, zBack, section))
  }
  return posts
}
