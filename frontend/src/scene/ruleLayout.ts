import type { RoomConfig, SceneObject, Vec3 } from '@/types/project'
import {
  DESK_BEAM_DEPTH,
  DESK_BEAM_INSET,
  DESK_BEAM_Z,
  deskBeamTopY,
  isContainedWithin,
  objectsOverlapAt,
  placementIssues,
} from '@/scene/sceneValidation'
import { uid } from '@/lib/utils'
import {
  computeOrganizationZones,
  type OrganizationZones,
  type RectOnPlane,
  type ZoneRect,
} from '@/scene/organizationZones'
import {
  ZONE_LABELS,
  type OrganizationPlan,
  type OrganizationPreferences,
  type PlanAssignment,
  type PlanBatch,
  type UnplacedItem,
  type ZoneKind,
} from '@/types/organization'

/**
 * 规则式演示布局（本地真实计算，非模拟服务）。
 *
 * 依次执行的可解释规则：
 *   1. 优先保留键鼠操作空间：打字活动区不给其它物品使用（高件避让书架搁板投影时可跨其后缘）
 *   2. 常用物品放在容易取用的位置（桌面常用区前排与两侧）
 *   3. 书本优先归入书架收纳区
 *   4. 小件物品优先放入尺寸适配的收纳容器内部（按盒内剩余宽度顺序尝试）
 *   5. 排插优先放在桌面下方横梁，其次已配置且高度可容纳的桌下隐藏区
 *   6. 全部落位按物品包围盒检查分区分界、房间边界与明显相交（尺寸不合 / 空间不足 → 列入未放置并给出原因）
 *
 * 这是「规则式演示方案」而非真实搬运 / 碰撞规划：结果用于展示整理思路，动画不代表真实搬运路径。
 */

type Role =
  | 'keyboard'
  | 'mouse'
  | 'monitor'
  | 'lamp'
  | 'laptop'
  | 'cup'
  | 'book'
  | 'container'
  | 'powerStrip'
  | 'general'

type PhaseKey = 'typing' | 'storage' | 'small' | 'desk' | 'under'

interface Phase {
  key: PhaseKey
  label: string
  durationMs: number
}

const PHASES: Phase[] = [
  { key: 'typing', label: '键鼠操作区归位', durationMs: 900 },
  { key: 'storage', label: '书本与收纳容器归位', durationMs: 1000 },
  { key: 'small', label: '小件物品入盒', durationMs: 800 },
  { key: 'desk', label: '桌面常用物品归位', durationMs: 1000 },
  { key: 'under', label: '桌下隐藏物品归位', durationMs: 900 },
]

interface PlacedPose {
  object: SceneObject
  position: Vec3
  rotationY: number
  zone: ZoneKind
}

interface Ctx {
  room: RoomConfig
  zones: OrganizationZones
  placed: PlacedPose[]
  /** 各放置带的一次性游标（米）：左→右为「下一个空闲 x 起点」，右→左为「下一个空闲 x 终点」 */
  cursors: Map<string, number>
  assignments: PlanAssignment[]
  byPhase: Map<PhaseKey, PlanAssignment[]>
}

interface PlacementAllow {
  /** 允许占用打字活动区（键鼠自身 / 避让书架的高件） */
  typing?: boolean
  /** 允许占用水杯活动区（水杯自身） */
  cup?: boolean
}

function classify(o: SceneObject): Role {
  const shape = o.model.shape
  const name = o.name
  if (shape === 'keyboard' || name.includes('键盘')) return 'keyboard'
  if (shape === 'mouse' || name.includes('鼠标')) return 'mouse'
  if (shape === 'monitor' || name.includes('显示器') || name.includes('屏幕')) return 'monitor'
  if (shape === 'laptop' || name.includes('笔记本')) return 'laptop'
  if (shape === 'lamp' || name.includes('台灯') || name.includes('灯')) return 'lamp'
  if (shape === 'cup' || name.includes('杯')) return 'cup'
  if (shape === 'books' || name.includes('书')) return 'book'
  if (shape === 'storageBox' || o.category === 'storage') return 'container'
  if (
    shape === 'powerStrip' ||
    name.includes('排插') ||
    name.includes('插排') ||
    (o.needsPower && o.dimensions.height <= 0.06 && o.dimensions.width >= 0.15)
  ) {
    return 'powerStrip'
  }
  return 'general'
}

/** 小件物品：最长边 ≤ 160mm（可尝试放入收纳容器内部） */
function isSmallItem(o: SceneObject, role: Role): boolean {
  if (role !== 'general') return false
  return Math.max(o.dimensions.width, o.dimensions.height, o.dimensions.depth) <= 0.16
}

function footprintOverlapsRect(x: number, z: number, w: number, d: number, r: ZoneRect): boolean {
  return (
    x - w / 2 < r.x1 - 0.001 &&
    x + w / 2 > r.x0 + 0.001 &&
    z - d / 2 < r.z1 - 0.001 &&
    z + d / 2 > r.z0 + 0.001
  )
}

function zoneAt(zones: OrganizationZones, position: Vec3): ZoneKind {
  if (zones.shelf && Math.abs(position[1] - zones.shelf.y) < 0.06) return 'shelf'
  if (Math.abs(position[1] - zones.deskSurface.y) < 0.06) return 'desk'
  return 'underDesk'
}

/** 候选落位是否可行：活动区避让 + 房间边界 + 与已落位物品无相交 / 无悬空 */
function canPlace(
  ctx: Ctx,
  object: SceneObject,
  position: Vec3,
  rotationY: number,
  allow: PlacementAllow = {},
): boolean {
  const dims = object.dimensions
  const onDesk = Math.abs(position[1] - ctx.zones.deskSurface.y) < 0.03
  if (onDesk) {
    if (!allow.typing && footprintOverlapsRect(position[0], position[2], dims.width, dims.depth, ctx.zones.typing.rect)) {
      return false
    }
    if (!allow.cup && footprintOverlapsRect(position[0], position[2], dims.width, dims.depth, ctx.zones.cup.rect)) {
      return false
    }
  }
  const candidate: SceneObject = { ...object, transform: { position, rotationY } }
  const obstacles = ctx.placed.map((p) => ({
    ...p.object,
    transform: { position: p.position, rotationY: p.rotationY },
  }))
  const issues = placementIssues(candidate, position, obstacles, ctx.room)
  return !issues.some((i) => i.type === 'outOfBounds' || i.type === 'overlap' || i.type === 'floating')
}

interface BandOptions {
  from?: 'left' | 'right'
  z?: 'mid' | 'back' | number
  allow?: PlacementAllow
  rotationY?: number
  zone: ZoneKind
  reason: string
  /** 高件避让书架搁板投影：z 前移到搁板前沿之外 */
  clearOfShelf?: boolean
}

/** 在放置带上沿 x 扫描一个可放置位（10mm 步进；越不过的阻挡区自动跳过） */
function placeInBand(
  ctx: Ctx,
  obj: SceneObject,
  band: RectOnPlane,
  cursorKey: string,
  opts: BandOptions,
): PlanAssignment | null {
  const w = obj.dimensions.width
  const d = obj.dimensions.depth
  const r = band.rect
  if (w > r.x1 - r.x0 + 1e-6) return null
  if (d > r.z1 - r.z0 + 1e-6 && typeof opts.z !== 'number') return null

  let z: number
  if (typeof opts.z === 'number') z = opts.z
  else if (opts.z === 'back') z = Math.min(r.z0 + d / 2 + 0.03, r.z1 - d / 2)
  else z = (r.z0 + r.z1) / 2
  if (opts.clearOfShelf && ctx.zones.shelf) {
    z = Math.max(z, ctx.zones.shelf.rect.z1 + 0.012 + d / 2)
  }
  // 不超出桌面范围（高件 exception 也限制在桌面内）
  const deskZ1 = ctx.zones.deskSurface.rect.z1 - 0.01
  if (typeof opts.z === 'number' || opts.clearOfShelf) {
    z = Math.min(z, deskZ1 - d / 2)
  }

  const rotationY = opts.rotationY ?? 0
  const step = 0.01
  if ((opts.from ?? 'left') === 'right') {
    let cursor = ctx.cursors.get(cursorKey) ?? r.x1
    while (cursor - w >= r.x0 - 1e-6) {
      const position: Vec3 = [cursor - w / 2, band.y, z]
      if (canPlace(ctx, obj, position, rotationY, opts.allow)) {
        ctx.cursors.set(cursorKey, cursor - w - 0.02)
        return { objectId: obj.id, position, rotationY, zone: opts.zone, reason: opts.reason }
      }
      cursor -= step
    }
    return null
  }
  let cursor = ctx.cursors.get(cursorKey) ?? r.x0
  while (cursor + w <= r.x1 + 1e-6) {
    const position: Vec3 = [cursor + w / 2, band.y, z]
    if (canPlace(ctx, obj, position, rotationY, opts.allow)) {
      ctx.cursors.set(cursorKey, cursor + w + 0.02)
      return { objectId: obj.id, position, rotationY, zone: opts.zone, reason: opts.reason }
    }
    cursor += step
  }
  return null
}

/** 尝试按偏好分区放置收纳容器 / 书本（shelf → desk → underDesk 回退链） */
function tryStorageZone(
  ctx: Ctx,
  obj: SceneObject,
  zone: ZoneKind,
  reasonBase: string,
): PlanAssignment | null {
  const z = ctx.zones
  if (zone === 'shelf' && z.shelf && obj.dimensions.height + 0.02 <= z.shelf.clearance) {
    const a = placeInBand(ctx, obj, z.shelf, 'shelf:right', {
      from: 'right',
      zone: 'shelf',
      reason: `${reasonBase}：书架收纳区（右侧大件位）`,
    })
    if (a) return a
  }
  if (zone === 'desk') {
    const tall = z.shelf ? obj.dimensions.height > z.shelf.y - z.deskSurface.y - 0.01 : false
    const a = placeInBand(ctx, obj, z.deskBackBand, 'desk:back', {
      zone: 'desk',
      reason: `${reasonBase}：桌面常用区后带`,
      allow: tall ? { typing: true, cup: false } : undefined,
      clearOfShelf: tall,
    })
    if (a) return a
    const b = placeInBand(ctx, obj, z.deskRightBand, 'desk:right', {
      zone: 'desk',
      reason: `${reasonBase}：桌面常用区右侧`,
    })
    if (b) return b
  }
  if (zone === 'underDesk' && obj.dimensions.height <= z.underDesk.clearance) {
    const a = placeInBand(ctx, obj, z.underDesk, 'under:left', {
      z: 'back',
      zone: 'underDesk',
      reason: `${reasonBase}：桌下隐藏区（离地靠后墙）`,
    })
    if (a) return a
  }
  return null
}

/** 小件放入收纳容器内部（盒内按剩余宽度扫描） */
function placeInsideContainer(
  ctx: Ctx,
  obj: SceneObject,
  container: PlacedPose,
): PlanAssignment | null {
  const cw = container.object.dimensions.width
  const cd = container.object.dimensions.depth
  const ch = container.object.dimensions.height
  if (obj.dimensions.height + 0.01 > ch) return null
  const wall = 0.014
  const innerW = cw - wall * 2
  const innerD = cd - wall * 2
  if (obj.dimensions.width > innerW || obj.dimensions.depth > innerD) return null

  const key = `container:${container.object.id}`
  const startX = container.position[0] - cw / 2 + wall
  let cursor = ctx.cursors.get(key) ?? startX
  const y = container.position[1] + 0.002
  const z = container.position[2]

  while (cursor + obj.dimensions.width <= startX + innerW + 1e-6) {
    const position: Vec3 = [cursor + obj.dimensions.width / 2, y, z]
    if (canPlace(ctx, obj, position, 0)) {
      ctx.cursors.set(key, cursor + obj.dimensions.width + 0.012)
      const remainMm = Math.max(
        0,
        Math.round((innerW - (cursor - startX) - obj.dimensions.width) * 1000),
      )
      return {
        objectId: obj.id,
        position,
        rotationY: 0,
        zone: container.zone,
        reason: `小件优先入盒：放入「${container.object.name}」内部（盒内剩余宽度约 ${remainMm} mm）`,
      }
    }
    cursor += 0.01
  }
  return null
}

/** 桌面可用面积估算：桌面矩形 − 平放在桌面上（未被容器收纳）的物品包围盒与桌面矩形的相交面积 */
export function estimateDeskFreeArea(
  room: RoomConfig,
  poses: Array<{ object: SceneObject; position: Vec3 }>,
): number {
  const desk = room.desk
  const dx0 = -desk.width / 2
  const dx1 = desk.width / 2
  const dz0 = 0.05
  const dz1 = 0.05 + desk.depth
  let occupied = 0
  for (const { object, position } of poses) {
    if (!object.visible) continue
    if (Math.abs(position[1] - desk.height) > 0.03) continue
    const contained = poses.some(
      (p) =>
        p.object.id !== object.id &&
        p.object.visible &&
        isContainedWithin(object, position, p.object, p.position),
    )
    if (contained) continue // 收纳在容器内的小件按容器面积一并估算，避免重复计入
    const w = object.dimensions.width
    const d = object.dimensions.depth
    const x0 = Math.max(dx0, position[0] - w / 2)
    const x1 = Math.min(dx1, position[0] + w / 2)
    const z0 = Math.max(dz0, position[2] - d / 2)
    const z1 = Math.min(dz1, position[2] + d / 2)
    if (x1 > x0 && z1 > z0) occupied += (x1 - x0) * (z1 - z0)
  }
  return Math.max(0, desk.width * desk.depth - occupied)
}

const round2 = (v: number) => Math.round(v * 100) / 100

export function computeRuleBasedPlan(input: {
  projectId: string
  objects: SceneObject[]
  room: RoomConfig
  preferences: OrganizationPreferences
}): OrganizationPlan {
  const { projectId, objects, room, preferences } = input
  const zones = computeOrganizationZones(room, preferences)
  const ctx: Ctx = {
    room,
    zones,
    placed: [],
    cursors: new Map(),
    assignments: [],
    byPhase: new Map(),
  }

  const visible = objects.filter((o) => o.visible)
  const movables = visible.filter((o) => !o.fixed && !o.locked)
  const keepers = visible.filter((o) => o.fixed || o.locked)

  // 固定 / 锁定物品：保持原位，作为障碍物参与包围盒检查
  for (const k of keepers) {
    ctx.placed.push({
      object: k,
      position: [...k.transform.position],
      rotationY: k.transform.rotationY,
      zone: zoneAt(zones, k.transform.position),
    })
  }

  const roles = new Map(movables.map((o) => [o.id, classify(o)]))
  const handled = new Set<string>()
  const unplaced: UnplacedItem[] = []

  const place = (phase: PhaseKey, obj: SceneObject, a: PlanAssignment | null): boolean => {
    if (!a) return false
    handled.add(obj.id)
    ctx.assignments.push(a)
    const list = ctx.byPhase.get(phase) ?? []
    list.push(a)
    ctx.byPhase.set(phase, list)
    ctx.placed.push({ object: obj, position: a.position, rotationY: a.rotationY, zone: a.zone })
    return true
  }

  const reject = (obj: SceneObject, reason: string) => {
    handled.add(obj.id)
    unplaced.push({ objectId: obj.id, name: obj.name, reason })
  }

  const byRole = (role: Role) => movables.filter((o) => !handled.has(o.id) && roles.get(o.id) === role)

  // ── 阶段 1：键鼠操作区（规则 1） ────────────────────────────────
  const t = zones.typing.rect
  for (const kb of byRole('keyboard')) {
    const cx = (t.x0 + t.x1) / 2
    const pos: Vec3 = [cx, zones.deskSurface.y, t.z1 - kb.dimensions.depth / 2 - 0.012]
    const direct: PlanAssignment = {
      objectId: kb.id,
      position: pos,
      rotationY: 0,
      zone: 'desk',
      reason: '键鼠操作区：键盘居中放在打字活动区前排',
    }
    if (canPlace(ctx, kb, pos, 0, { typing: true }) && place('typing', kb, direct)) continue
    const fallback = placeInBand(ctx, kb, zones.deskLeftBand, 'desk:left', {
      zone: 'desk',
      reason: '键鼠操作区：键盘退至桌面左侧（打字活动区被占用）',
    })
    if (!place('typing', kb, fallback)) {
      reject(kb, '桌面常用区没有可容纳键盘的空位（打字活动区被占用）')
    }
  }

  const kbPose = ctx.placed.find((p) => roles.get(p.object.id) === 'keyboard') ?? null
  for (const m of byRole('mouse')) {
    const mw = m.dimensions.width
    const baseX = kbPose ? kbPose.position[0] : (t.x0 + t.x1) / 2
    const baseW = kbPose ? kbPose.object.dimensions.width : 0.35
    const z = t.z1 - m.dimensions.depth / 2 - 0.012
    const candidates = [
      baseX + baseW / 2 + 0.025 + mw / 2,
      baseX - baseW / 2 - 0.025 - mw / 2,
    ].filter((x) => x - mw / 2 >= t.x0 - 1e-6 && x + mw / 2 <= t.x1 + 1e-6)
    let done = false
    for (const x of candidates) {
      const pos: Vec3 = [x, zones.deskSurface.y, z]
      if (!canPlace(ctx, m, pos, 0, { typing: true })) continue
      done = place('typing', m, {
        objectId: m.id,
        position: pos,
        rotationY: 0,
        zone: 'desk',
        reason: '键鼠操作区：鼠标紧邻键盘（右手位优先）',
      })
      if (done) break
    }
    if (done) continue
    const fallback = placeInBand(ctx, m, zones.deskRightBand, 'desk:right', {
      zone: 'desk',
      reason: '键鼠操作区：鼠标退至桌面右侧',
    })
    if (!place('typing', m, fallback)) reject(m, '打字活动区与桌面两侧均无鼠标位')
  }

  // ── 阶段 2：书本与收纳容器（规则 2 / 3 + 偏好收纳分区） ──────────
  for (const c of byRole('container')) {
    const preferred = preferences.preferredStorageZone
    const order: ZoneKind[] = [
      preferred,
      ...(['shelf', 'desk', 'underDesk'] as ZoneKind[]).filter((z) => z !== preferred),
    ]
    let a: PlanAssignment | null = null
    for (const zone of order) {
      a = tryStorageZone(ctx, c, zone, `收纳容器（偏好：${ZONE_LABELS[preferred]}）`)
      if (a) break
    }
    if (!place('storage', c, a)) {
      reject(c, '书架收纳区、桌面后带与桌下隐藏区均无足够空间安放收纳容器')
    }
  }

  for (const b of byRole('book')) {
    let a: PlanAssignment | null = null
    if (zones.shelf && b.dimensions.height + 0.02 <= zones.shelf.clearance) {
      a = placeInBand(ctx, b, zones.shelf, 'shelf:left', {
        zone: 'shelf',
        reason: '书本优先归入书架收纳区（左侧竖放位）',
      })
    }
    if (!a) {
      a = placeInBand(ctx, b, zones.deskBackBand, 'desk:back', {
        zone: 'desk',
        reason: zones.shelf ? '书架空间不足：书本暂放桌面后带' : '未启用书架：书本放在桌面后带',
      })
    }
    if (!a) {
      a = placeInBand(ctx, b, zones.deskRightBand, 'desk:right', {
        zone: 'desk',
        reason: '书架与桌面后带已满：书本放在桌面右侧',
      })
    }
    if (!place('storage', b, a)) reject(b, '书架收纳区与桌面均无足够空间放置书本')
  }

  // ── 阶段 3：小件入盒（规则 4） ──────────────────────────────────
  const smalls = movables.filter((o) => !handled.has(o.id) && isSmallItem(o, roles.get(o.id)!))
  for (const s of smalls) {
    const containers = ctx.placed
      .filter((p) => p.object.visible && classify(p.object) === 'container')
      // 最适配（盒内截面最小）的容器优先
      .sort(
        (a, b) =>
          a.object.dimensions.width * a.object.dimensions.depth -
          b.object.dimensions.width * b.object.dimensions.depth,
      )
    let done = false
    for (const c of containers) {
      if (place('small', s, placeInsideContainer(ctx, s, c))) {
        done = true
        break
      }
    }
    if (done) continue
    let a = placeInBand(ctx, s, zones.deskBackBand, 'desk:back', {
      zone: 'desk',
      reason: '未找到尺寸适配的收纳容器：小件暂放桌面后带',
    })
    if (!a) {
      a = placeInBand(ctx, s, zones.deskRightBand, 'desk:right', {
        zone: 'desk',
        reason: '未找到尺寸适配的收纳容器：小件暂放桌面右侧',
      })
    }
    if (!place('small', s, a)) reject(s, '没有尺寸适配且有余量的收纳容器，桌面也无空位')
  }

  // ── 阶段 4：桌面常用物品（规则 2 + 分类归位） ───────────────────
  const tryDeskGeneral = (obj: SceneObject, role: Role): PlanAssignment | null => {
    const tall = zones.shelf ? obj.dimensions.height > zones.shelf.y - zones.deskSurface.y - 0.01 : false
    const tallAllow: PlacementAllow | undefined = tall ? { typing: true, cup: false } : undefined

    if (role === 'monitor' || role === 'lamp') {
      // 显示器 / 台灯：桌面后带；居中种子（显示器）与高件避让书架搁板投影
      if (!ctx.cursors.has('desk:back')) {
        const r = zones.deskBackBand.rect
        ctx.cursors.set('desk:back', Math.max(r.x0, (r.x0 + r.x1) / 2 - obj.dimensions.width / 2))
      }
      const reason =
        role === 'monitor'
          ? '显示器：桌面常用区后带（视线高度，避让键鼠）'
          : '台灯：桌面常用区后带（照明覆盖键鼠区）'
      let a = placeInBand(ctx, obj, zones.deskBackBand, 'desk:back', {
        zone: 'desk',
        reason,
        allow: tallAllow,
        clearOfShelf: tall,
      })
      if (!a) {
        // 第二遍：从后带最左端重新扫描，利用大件（显示器 / 笔记本）两侧的剩余空隙
        a = placeInBand(ctx, obj, zones.deskBackBand, 'desk:back#2', {
          zone: 'desk',
          reason: `${reason}（后带左侧剩余空位）`,
          allow: tallAllow,
          clearOfShelf: tall,
        })
      }
      if (!a) {
        a = placeInBand(ctx, obj, zones.deskRightBand, 'desk:right', {
          zone: 'desk',
          reason: `${reason}（后带已满，退至右侧）`,
        })
      }
      if (!a) {
        a = placeInBand(ctx, obj, zones.deskLeftBand, 'desk:left', {
          zone: 'desk',
          reason: `${reason}（后带已满，退至左侧）`,
        })
      }
      return a
    }

    if (role === 'laptop') {
      let a = placeInBand(ctx, obj, zones.deskLeftBand, 'desk:left', {
        zone: 'desk',
        reason: '常用物品：笔记本电脑放在桌面左侧前排（易取）',
      })
      if (!a) {
        a = placeInBand(ctx, obj, zones.deskBackBand, 'desk:back', {
          zone: 'desk',
          reason: '常用物品：桌面两侧放不下，笔记本电脑放在后带',
        })
      }
      if (!a) {
        a = placeInBand(ctx, obj, zones.deskRightBand, 'desk:right', {
          zone: 'desk',
          reason: '常用物品：笔记本电脑放在桌面右侧',
        })
      }
      return a
    }

    if (role === 'cup') {
      const cupRect = zones.cup.rect
      const pos: Vec3 = [(cupRect.x0 + cupRect.x1) / 2, zones.deskSurface.y, (cupRect.z0 + cupRect.z1) / 2]
      if (canPlace(ctx, obj, pos, 0, { cup: true })) {
        return {
          objectId: obj.id,
          position: pos,
          rotationY: 0,
          zone: 'desk',
          reason: '水杯活动区：按偏好位置放置（远离键鼠与线缆）',
        }
      }
      return placeInBand(ctx, obj, zones.deskRightBand, 'desk:right', {
        zone: 'desk',
        reason: '水杯活动区被占：水杯暂放桌面右侧',
      })
    }

    // general：常用物品优先前排；带电器材优先后带；其余就近
    const frequent = Boolean(obj.frequent)
    const powered = obj.needsPower || obj.category === 'electrical'
    const firstFront = placeInBand(ctx, obj, zones.deskLeftBand, 'desk:left', {
      zone: 'desk',
      reason: frequent ? '常用物品：桌面常用区左侧前排（易取）' : '桌面常用区：左侧前排空位',
    })
    const secondFront = placeInBand(ctx, obj, zones.deskRightBand, 'desk:right', {
      zone: 'desk',
      reason: frequent ? '常用物品：桌面常用区右侧前排（易取）' : '桌面常用区：右侧前排空位',
    })
    const back = placeInBand(ctx, obj, zones.deskBackBand, 'desk:back', {
      zone: 'desk',
      reason: powered ? '电气设备：桌面常用区后带（靠近出线孔与插座）' : '桌面常用区后带空位',
      allow: tallAllow,
      clearOfShelf: tall,
    })
    if (frequent) return firstFront ?? secondFront ?? back
    if (powered) return back ?? firstFront ?? secondFront
    return firstFront ?? secondFront ?? back
  }

  const deskOrder: Role[] = ['laptop', 'monitor', 'lamp', 'cup']
  for (const role of deskOrder) {
    for (const obj of byRole(role)) {
      const a = tryDeskGeneral(obj, role)
      if (!place('desk', obj, a)) {
        const reason =
          obj.frequent
            ? '常用物品：桌面常用区没有足够空位（可调整打字活动区或减少桌面物品）'
            : '桌面常用区没有足够空位（可调整打字活动区或减少桌面物品）'
        reject(obj, reason)
      }
    }
  }

  const rest = byRole('general').sort((a, b) => {
    const fa = Number(Boolean(a.frequent))
    const fb = Number(Boolean(b.frequent))
    if (fa !== fb) return fb - fa
    const ea = Number(a.needsPower || a.category === 'electrical')
    const eb = Number(b.needsPower || b.category === 'electrical')
    if (ea !== eb) return eb - ea
    return b.dimensions.width - a.dimensions.width
  })
  for (const obj of rest) {
    const a = tryDeskGeneral(obj, 'general')
    if (a) {
      place('desk', obj, a)
      continue
    }
    // 兜底：桌下隐藏区（高度允许时）
    let fallback: PlanAssignment | null = null
    if (obj.dimensions.height <= zones.underDesk.clearance) {
      fallback = placeInBand(ctx, obj, zones.underDesk, 'under:left', {
        z: 'back',
        zone: 'underDesk',
        reason: '桌面无空位：收纳进桌下隐藏区（靠后墙）',
      })
    }
    if (!place('desk', obj, fallback)) {
      reject(obj, '桌面常用区与桌下隐藏区均无足够空间（可减少物品或调整分区）')
    }
  }

  // ── 阶段 5：排插进桌下（规则 5：优先桌面下方横梁，其次桌下隐藏区） ──────
  for (const st of byRole('powerStrip')) {
    let a: PlanAssignment | null = null
    // 桌下横梁：排插「优先放在桌面下方横梁」（高度 / 深度合适时，沿横梁从中心向左避让）
    const beamClearance = room.desk.height - room.desk.thickness - deskBeamTopY(room)
    if (
      st.dimensions.depth <= DESK_BEAM_DEPTH + 0.005 &&
      st.dimensions.height + 0.005 <= beamClearance &&
      st.dimensions.width <= room.desk.width - DESK_BEAM_INSET * 2
    ) {
      const beamBand: RectOnPlane = {
        rect: {
          x0: -room.desk.width / 2 + DESK_BEAM_INSET + 0.02,
          x1: room.desk.width / 2 - DESK_BEAM_INSET - 0.02,
          z0: DESK_BEAM_Z - DESK_BEAM_DEPTH / 2,
          z1: DESK_BEAM_Z + DESK_BEAM_DEPTH / 2,
        },
        y: deskBeamTopY(room),
      }
      a = placeInBand(ctx, st, beamBand, 'under:beam', {
        z: DESK_BEAM_Z,
        zone: 'underDesk',
        reason: '排插优先放在桌面下方横梁（走线 / 插拔方便）',
      })
    }
    if (!a && st.dimensions.height <= zones.underDesk.clearance) {
      a = placeInBand(ctx, st, zones.underDesk, 'under:left', {
        z: 'back',
        zone: 'underDesk',
        reason: '桌下隐藏区（离地靠后墙，便于插拔）',
      })
    }
    if (!a) {
      a = placeInBand(ctx, st, zones.deskBackBand, 'desk:back', {
        zone: 'desk',
        reason: '桌下横梁与隐藏区不可用：排插暂放桌面后带',
      })
    }
    if (!place('under', st, a)) {
      reject(st, '桌下横梁 / 隐藏区高度或空间不足，且桌面后带没有空位')
    }
  }

  // ── 动画批次（按物品组分批） ────────────────────────────────────
  const batches: PlanBatch[] = []
  for (const phase of PHASES) {
    const list = ctx.byPhase.get(phase.key) ?? []
    const movedIds = list
      .filter((a) => {
        const o = objects.find((x) => x.id === a.objectId)
        if (!o) return false
        const [x0, y0, z0] = o.transform.position
        const dist = Math.hypot(a.position[0] - x0, a.position[1] - y0, a.position[2] - z0)
        return dist > 0.01 || Math.abs(a.rotationY - o.transform.rotationY) > 0.05
      })
      .map((a) => a.objectId)
    if (movedIds.length > 0) {
      batches.push({
        id: `batch-${phase.key}`,
        label: phase.label,
        objectIds: movedIds,
        durationMs: phase.durationMs,
      })
    }
  }

  // ── 指标（本地计算，界面必须携带口径说明） ──────────────────────
  const poseById = new Map(
    ctx.assignments.map((a) => [a.objectId, { position: a.position, rotationY: a.rotationY }]),
  )
  const beforePoses = visible.map((o) => ({ object: o, position: o.transform.position }))
  const afterPoses = visible.map((o) => ({
    object: o,
    position: poseById.get(o.id)?.position ?? o.transform.position,
  }))
  const finalScene = visible.map((o) => {
    const pose = poseById.get(o.id)
    return pose
      ? { ...o, transform: { position: pose.position, rotationY: pose.rotationY } }
      : o
  })
  let outOfBoundsCount = 0
  for (const o of finalScene) {
    const issues = placementIssues(o, o.transform.position, finalScene, room)
    if (issues.some((i) => i.type === 'outOfBounds')) outOfBoundsCount += 1
  }
  let overlapCount = 0
  for (let i = 0; i < finalScene.length; i += 1) {
    for (let j = i + 1; j < finalScene.length; j += 1) {
      const a = finalScene[i]
      const b = finalScene[j]
      if (objectsOverlapAt(a, a.transform.position, b, b.transform.position)) overlapCount += 1
    }
  }

  const shelfOn = Boolean(zones.shelf)
  const typingWmm = Math.round((zones.typing.rect.x1 - zones.typing.rect.x0) * 1000)
  const typingDmm = Math.round((zones.typing.rect.z1 - zones.typing.rect.z0) * 1000)
  const frequentCount = movables.filter((o) => o.frequent).length
  const rules = [
    `键鼠优先：打字活动区（约 ${typingWmm} × ${typingDmm} mm）保留给键盘 / 鼠标，其它物品默认避让`,
    `常用物品：标记「常用」的 ${frequentCount} 件物品优先放在桌面常用区前排与两侧的易取位置`,
    shelfOn ? '书本优先：书本（叠放）优先归入书架收纳区左侧' : '书本优先：未启用书架，书本退而放在桌面后带',
    '小件入盒：小件物品（最长边 ≤ 160mm）优先放入尺寸适配的收纳容器内部',
    '排插归位：排插优先放入已配置且高度足够的桌下隐藏区，靠后墙放置便于插拔',
    '包围盒检查：全部落位按物品包围盒（宽 × 高 × 深）检查分区分界、房间边界与明显相交；高件（显示器等）避让书架搁板投影',
  ]

  const metrics = {
    deskFreeAreaBefore: round2(estimateDeskFreeArea(room, beforePoses)),
    deskFreeAreaAfter: round2(estimateDeskFreeArea(room, afterPoses)),
    placedCount: ctx.assignments.length,
    movableCount: movables.length,
    unplacedCount: unplaced.length,
    overlapCount,
    outOfBoundsCount,
    method:
      '口径：桌面可用面积 ≈ 桌面矩形面积 − 平放在桌面（底面距桌面 ≤ 30mm）且未被容器收纳的物品包围盒（宽 × 深）与桌面矩形的相交面积之和，四舍五入到 0.01 m²（不随物品旋转变化）；不含书架与桌下区域。已归位物品数 = 本次方案完成落位的可移动物品数（固定 / 锁定物品保持原位，不计入）。未解决问题 = 未放置物品数 + 目标布局中仍相交的物品对数 + 越界物品数。',
  }

  const placedCount = ctx.assignments.length
  const summary = `规则式演示方案：已归位 ${placedCount}/${movables.length} 件，未放置 ${unplaced.length} 件，动画 ${batches.length} 组（固定 / 锁定物品保持原位）`

  return {
    id: uid('plan'),
    projectId,
    kind: 'rule-demo',
    createdAt: Date.now(),
    preferences,
    assignments: ctx.assignments,
    batches,
    unplaced,
    rules,
    metrics,
    summary,
  }
}
