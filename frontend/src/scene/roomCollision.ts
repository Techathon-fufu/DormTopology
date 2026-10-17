import type { RoomConfig, Vec3 } from '@/types/project'

/**
 * 场地固定实体的碰撞体积（桌面板 / 桌腿 / 搁板 / 书架侧板 / 立柱 / 桌下横梁）。
 *
 * 与 ParametricDesk 的渲染几何同源：同一组 RoomConfig 参数、同一组布局公式，避免
 * 「看得见的是 A、算碰撞的是 B」。GLB 桌体加载失败时渲染回退到参数化几何，本模块
 * 即该回退几何的碰撞表达；加载成功时 GLB 与参数化几何按同一 RoomConfig 标定锚点。
 *
 * 坐标：米，世界原点=后墙地面中心（x 以桌面中心为 0，y 向上，z 向 +z 展开）。
 * 每个 box 用轴对齐的最小/最大角点表示（min/max），不做旋转。
 *
 * 注意：本模块刻意不 import sceneValidation —— sceneValidation 反向依赖本模块，
 * 循环导入会让下方常量在初始化期处于 TDZ，产生 NaN 尺寸。几何常量在此就地声明，
 * 与 ParametricDesk / sceneValidation 保持同值（由回归脚本断言一致性）。
 */

export interface RoomSolid {
  id: string
  /** 语义分类：用于问题文案与按需豁免 */
  kind: 'deskTop' | 'deskLeg' | 'beam' | 'shelfBoard' | 'shelfDivider' | 'post'
  label: string
  min: Vec3
  max: Vec3
}

/** 桌腿截面边长（米，与 ParametricDesk 一致） */
const DESK_LEG_SECTION = 0.04
/** 桌腿距桌边内收（米） */
const DESK_LEG_INSET = 0.05
/** 立柱高度（米，与 ParametricDesk / RoomShell 一致） */
const POST_HEIGHT = 1.68
/** 书架搁板厚度（米，与 ParametricDesk / sceneValidation.SHELF_THICKNESS 一致） */
const SHELF_BOARD_THICKNESS = 0.018
/** 书架侧板厚度（米） */
const SHELF_DIVIDER_THICKNESS = 0.016
/** 书架搁板宽度内收（米，单侧） */
const SHELF_BOARD_INSET = 0.1
/** 书架侧板中心距桌边内收（米） */
const SHELF_DIVIDER_INSET = 0.12
/** 桌面后沿与后墙留缝（米，与 sceneValidation.DESK_GAP 一致） */
const DESK_GAP = 0.05
/** 桌下横梁截面高度（米，与 sceneValidation.DESK_BEAM_SECTION 一致） */
const DESK_BEAM_SECTION = 0.03
/** 桌下横梁截面深度（米，与 sceneValidation.DESK_BEAM_DEPTH 一致） */
const DESK_BEAM_DEPTH = 0.06
/** 桌下横梁中心距后墙距离（米，与 sceneValidation.DESK_BEAM_Z 一致） */
const DESK_BEAM_Z = DESK_GAP + 0.05
/** 桌下横梁两端距桌边内收（米，与 sceneValidation.DESK_BEAM_INSET 一致） */
const DESK_BEAM_INSET = 0.05
/** 桌下横梁上表面高度（米，与 sceneValidation.deskBeamTopY 一致） */
const BEAM_TOP_OFFSET = 0.05
function deskBeamTopY(room: RoomConfig): number {
  return room.desk.height - room.desk.thickness - BEAM_TOP_OFFSET
}

function box(min: Vec3, max: Vec3): { min: Vec3; max: Vec3 } {
  return { min, max }
}

/** 由「中心 + 尺寸」构造轴对齐盒（尺寸为各轴全长） */
function centeredBox(center: Vec3, size: Vec3): { min: Vec3; max: Vec3 } {
  return box(
    [center[0] - size[0] / 2, center[1] - size[1] / 2, center[2] - size[2] / 2],
    [center[0] + size[0] / 2, center[1] + size[1] / 2, center[2] + size[2] / 2],
  )
}

/**
 * 场地全部固定碰撞实体。
 *
 * 只包含「物品会撞上」的实体：桌面、桌腿、桌下横梁、书架搁板与侧板、四根立柱。
 * 不包含床架、梯子、墙面、插座与出线孔（这些在首版是装饰或允许贴合，见注释）。
 */
export function roomSolids(room: RoomConfig): RoomSolid[] {
  const solids: RoomSolid[] = []
  const desk = room.desk
  const deskCZ = desk.depth / 2 + DESK_GAP

  // 桌面：顶面高度 desk.height，向下 desk.thickness
  solids.push({
    id: 'desk-top',
    kind: 'deskTop',
    label: '桌面板',
    ...centeredBox([0, desk.height - desk.thickness / 2, deskCZ], [desk.width, desk.thickness, desk.depth]),
  })

  // 四根桌腿：截面 0.04，距桌边内收 0.05，从地面到桌板下沿
  const legSizeY = desk.height - desk.thickness
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ] as const) {
    const cx = sx * (desk.width / 2 - DESK_LEG_INSET)
    const cz = deskCZ + sz * (desk.depth / 2 - DESK_LEG_INSET)
    solids.push({
      id: `desk-leg-${sx}${sz}`,
      kind: 'deskLeg',
      label: '桌腿',
      ...centeredBox([cx, legSizeY / 2, cz], [DESK_LEG_SECTION, legSizeY, DESK_LEG_SECTION]),
    })
  }

  // 桌下横梁：与 sceneValidation 的 beam 支撑面同参数
  solids.push({
    id: 'desk-beam',
    kind: 'beam',
    label: '桌下横梁',
    ...centeredBox(
      [0, deskBeamTopY(room) - DESK_BEAM_SECTION / 2, DESK_BEAM_Z],
      [desk.width - DESK_BEAM_INSET * 2, DESK_BEAM_SECTION, DESK_BEAM_DEPTH],
    ),
  })

  // 书架：搁板 + 两侧侧板（与 ParametricDesk 一致，仅启用时存在）
  if (room.shelf.enabled) {
    const shelfY = desk.height + room.shelf.heightAboveDesk
    const shelfCZ = DESK_GAP + room.shelf.depth / 2
    solids.push({
      id: 'shelf-board',
      kind: 'shelfBoard',
      label: '书架搁板',
      ...centeredBox(
        [0, shelfY, shelfCZ],
        [desk.width - SHELF_BOARD_INSET * 2, SHELF_BOARD_THICKNESS, room.shelf.depth],
      ),
    })
    for (const sx of [-1, 1] as const) {
      solids.push({
        id: `shelf-divider-${sx}`,
        kind: 'shelfDivider',
        label: '书架侧板',
        ...centeredBox(
          [sx * (desk.width / 2 - SHELF_DIVIDER_INSET), desk.height + room.shelf.heightAboveDesk / 2, shelfCZ],
          [SHELF_DIVIDER_THICKNESS, room.shelf.heightAboveDesk, room.shelf.depth],
        ),
      })
    }
  }

  // 四根立柱：截面 post.section，高 POST_HEIGHT，位于 post.position（底面中心）
  for (const post of room.posts) {
    solids.push({
      id: post.id,
      kind: 'post',
      label: '立柱',
      ...centeredBox(
        [post.position[0], POST_HEIGHT / 2, post.position[2]],
        [post.section, POST_HEIGHT, post.section],
      ),
    })
  }

  return solids
}

/** Room config fingerprint: only fields that change the fixed furniture solids. */
function roomKey(room: RoomConfig): string {
  return JSON.stringify([
    room.desk.width,
    room.desk.depth,
    room.desk.thickness,
    room.desk.height,
    room.shelf.enabled,
    room.shelf.heightAboveDesk,
    room.shelf.depth,
    room.posts.map((post) => [post.id, post.position, post.section]),
  ])
}

const solidCache = new Map<string, RoomSolid[]>()

/**
 * `roomSolids` with a small memo, for the per-pointer-move drag loop.
 *
 * Placement validation runs on every drag step; rebuilding the convex solids there is
 * pure waste. The cache is keyed on the furniture-relevant config only, so an unrelated
 * project edit cannot silently reuse stale geometry.
 */
export function cachedRoomSolids(room: RoomConfig): RoomSolid[] {
  const key = roomKey(room)
  const cached = solidCache.get(key)
  if (cached) return cached
  const solids = roomSolids(room)
  if (solidCache.size >= 64) solidCache.clear()
  solidCache.set(key, solids)
  return solids
}
