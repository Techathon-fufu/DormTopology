import type {
  CableConnection,
  LayoutPlan,
  PlanSourceInfo,
  Project,
  RoomConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import { CABLE_VISIBILITY_META } from '@/types/project'
import type { OrganizationPreferences, ZoneKind } from '@/types/organization'
import { ZONE_LABELS } from '@/types/organization'
import { cableDisplayPoints, hasUsableCableRoute, resolveCableThickness, resolveCableVisibility } from '@/scene/cables'
import { checkCableRoute } from '@/scene/cableRoute'
import { totalCablePathLength } from '@/scene/cableGeometry'
import { computeCableAvoidZones } from '@/scene/routeNodes'
import { validateScene } from '@/scene/sceneValidation'
import { estimateDeskFreeArea } from '@/scene/ruleLayout'

/**
 * 候选方案度量与差异（纯函数，供候选方案面板与对比页复用）。
 *
 * 口径（界面需同时展示）：
 * - 物品数量：快照中可见物品数；旧版本方案按指派数计。
 * - 已连接线缆数量：快照中的线缆条数；旧版本方案无该数据（显示「—」）。
 * - 桌面可用面积：桌面矩形 − 平放桌面物品包围盒与桌面矩形的相交面积（与整理方案同口径）；
 *   旧版本方案借用当前物品尺寸 + 快照位姿估算，属估算值。
 * - 走线总长度：真实曲线积分优先，演示路径按展示采样估算；任意线路不可用则总长未知。
 * - 未解决问题：摆放校验问题条数（越界 / 相交 / 悬空）+ 已规划线缆的几何检查问题条数。
 * - 全部指标由方案快照 / 当前场景实时计算，不使用写死的演示数字。
 */

export type PlanFidelity = 'full' | 'legacy'

export interface PlanZoneCount {
  zone: ZoneKind
  label: string
  count: number
}

export interface PlanCableSummary {
  total: number
  visibleCount: number
  hiddenCount: number
  thickCount: number
  thinCount: number
  strategyCableHole: number
  strategyBackboard: number
  /** 未规划（无路径控制点）的线缆数 */
  unplannedCount: number
}

export interface PlanPowerStripSummary {
  objectId: string
  name: string
  socketCount: number
  socketSpacingMm: number
  maxLoadW: number
}

export interface PlanMetrics {
  fidelity: PlanFidelity
  objectCount: number
  cableCount: number | null
  deskFreeAreaM2: number | null
  cableLengthM: number | null
  issueCount: number | null
  placementIssueCount: number | null
  cableIssueCount: number | null
  source: PlanSourceInfo | null
  cableSummary: PlanCableSummary | null
  powerStrips: PlanPowerStripSummary[]
  zoneCounts: PlanZoneCount[]
  /** 逐物品分区（objectId → 分区），供对比视口按分区着色 */
  objectZones: Record<string, ZoneKind>
  /** 哪些指标为估算值（界面显示「估算值」徽标） */
  estimated: { deskFreeArea: boolean; cableLength: boolean; issues: boolean }
}

const ZONE_ORDER: ZoneKind[] = ['desk', 'shelf', 'underDesk']

/** 物品分区估算（按支撑高度）：up to desk ±50mm = 桌面常用区；高于桌面 = 书架收纳区；其余 = 桌下 / 地面 */
export function resolveObjectZone(object: SceneObject, room: RoomConfig): ZoneKind {
  const desk = room.desk
  const y = object.transform.position[1]
  if (y < desk.height - 0.05) return 'underDesk'
  if (y <= desk.height + 0.05) return 'desk'
  return 'shelf'
}

function zoneCountsFor(
  objects: SceneObject[],
  room: RoomConfig,
): { zoneCounts: PlanZoneCount[]; objectZones: Record<string, ZoneKind> } {
  const objectZones: Record<string, ZoneKind> = {}
  const counts: Record<ZoneKind, number> = { desk: 0, shelf: 0, underDesk: 0 }
  for (const object of objects) {
    if (!object.visible) continue
    const zone = resolveObjectZone(object, room)
    objectZones[object.id] = zone
    counts[zone] += 1
  }
  return {
    objectZones,
    zoneCounts: ZONE_ORDER.map((zone) => ({ zone, label: ZONE_LABELS[zone], count: counts[zone] })),
  }
}

function summarizeCables(cables: CableConnection[], objects: SceneObject[], room: RoomConfig): PlanCableSummary {
  const summary: PlanCableSummary = {
    total: cables.length,
    visibleCount: 0,
    hiddenCount: 0,
    thickCount: 0,
    thinCount: 0,
    strategyCableHole: 0,
    strategyBackboard: 0,
    unplannedCount: 0,
  }
  for (const cable of cables) {
    const visibility = resolveCableVisibility(cable, objects, room).visibility
    if (visibility === 'hidden') summary.hiddenCount += 1
    else summary.visibleCount += 1
    if (resolveCableThickness(cable) === 'thick') summary.thickCount += 1
    else summary.thinCount += 1
    const strategy = cable.route.strategy ?? CABLE_VISIBILITY_META[visibility].strategy
    if (strategy === 'backboard') summary.strategyBackboard += 1
    else summary.strategyCableHole += 1
    if (!hasUsableCableRoute(cable)) summary.unplannedCount += 1
  }
  return summary
}

/**
 * 计算单个方案的度量。全量方案按快照计算；旧版本方案（无快照）按「指派 + 当前物品尺寸」估算，
 * 无法计算的指标返回 null（界面显示「—」）。
 */
export function computePlanMetrics(
  plan: LayoutPlan,
  opts: {
    projectRoom: RoomConfig
    projectObjects?: SceneObject[]
    preferences: OrganizationPreferences
  },
): PlanMetrics {
  const empty: PlanMetrics = {
    fidelity: plan.scene ? 'full' : 'legacy',
    objectCount: 0,
    cableCount: null,
    deskFreeAreaM2: null,
    cableLengthM: null,
    issueCount: null,
    placementIssueCount: null,
    cableIssueCount: null,
    source: plan.source ?? null,
    cableSummary: null,
    powerStrips: [],
    zoneCounts: [],
    objectZones: {},
    estimated: { deskFreeArea: true, cableLength: false, issues: true },
  }

  if (plan.scene) {
    const room = plan.scene.room
    const objects = plan.scene.objects
    const cables = plan.scene.cables
    const { zoneCounts, objectZones } = zoneCountsFor(objects, room)

    const issuesById = validateScene(objects, room)
    let placementIssueCount = 0
    for (const issues of issuesById.values()) placementIssueCount += issues.length

    const avoidZones = computeCableAvoidZones(room, opts.preferences)
    let cableIssueCount = 0
    const cableLengthM = totalCablePathLength(cables, objects)
    for (const cable of cables) {
      if (!hasUsableCableRoute(cable)) {
        cableIssueCount += 1
        continue
      }
      if (cable.planSource === 'algorithm' && cable.route.verification?.status === 'valid') continue
      const points = cableDisplayPoints(cable, objects, 'suggested')
      const result = checkCableRoute({
        points,
        smooth: cable.route.smooth,
        from: cable.from,
        to: cable.to,
        objects,
        room,
        avoidZones,
        cables,
        cable,
        selfCableId: cable.id,
      })
      cableIssueCount += result.issues.length
    }

    const powerStrips: PlanPowerStripSummary[] = objects
      .filter((o) => o.visible && o.powerStrip)
      .map((o) => ({
        objectId: o.id,
        name: o.name,
        socketCount: o.powerStrip!.socketCount,
        socketSpacingMm: Math.round(o.powerStrip!.socketSpacing * 1000),
        maxLoadW: o.powerStrip!.maxLoadW,
      }))

    return {
      ...empty,
      objectCount: objects.filter((o) => o.visible).length,
      cableCount: cables.length,
      deskFreeAreaM2: round2(
        estimateDeskFreeArea(
          room,
          objects.filter((o) => o.visible).map((o) => ({ object: o, position: o.transform.position })),
        ),
      ),
      cableLengthM: cableLengthM === null ? null : round2(cableLengthM),
      issueCount: placementIssueCount + cableIssueCount,
      placementIssueCount,
      cableIssueCount,
      cableSummary: summarizeCables(cables, objects, room),
      powerStrips,
      zoneCounts,
      objectZones,
      estimated: { deskFreeArea: true, cableLength: cableLengthM !== null && cables.some((c) => c.route.pathLengthM === undefined), issues: false },
    }
  }

  // 旧版本方案（0.8.0 之前保存）：仅有物品指派，线缆 / 问题无法回溯
  const poses: Array<{ object: SceneObject; position: Vec3 }> = []
  const objectZones: Record<string, ZoneKind> = {}
  if (opts.projectObjects) {
    const byId = new Map(opts.projectObjects.map((o) => [o.id, o]))
    for (const assignment of plan.assignments) {
      const object = byId.get(assignment.objectId)
      if (!object || !object.visible) continue
      poses.push({ object, position: assignment.position })
      objectZones[object.id] = resolveObjectZone(
        { ...object, transform: { ...object.transform, position: assignment.position } },
        opts.projectRoom,
      )
    }
  }
  const counts: Record<ZoneKind, number> = { desk: 0, shelf: 0, underDesk: 0 }
  for (const zone of Object.values(objectZones)) counts[zone] += 1

  return {
    ...empty,
    objectCount: plan.assignments.length,
    deskFreeAreaM2:
      poses.length > 0 ? round2(estimateDeskFreeArea(opts.projectRoom, poses)) : null,
    estimated: { deskFreeArea: true, cableLength: false, issues: true },
    zoneCounts: ZONE_ORDER.map((zone) => ({ zone, label: ZONE_LABELS[zone], count: counts[zone] })),
    objectZones,
  }
}

// ───────────────────────────── 对比场景解析与差异 ─────────────────────────────

export interface ResolvedPlanScene {
  planId: string
  objects: SceneObject[]
  cables: CableConnection[]
  /** 基准房间（快照房间；旧版本方案回退当前项目房间） */
  room: RoomConfig
  /** true = 旧版本方案：按「当前物品 + 快照位姿」估算，线缆不可用 */
  fallback: boolean
}

/** 解析方案的可视场景：全量快照直接用；旧版本方案合成（线缆置空，界面如实标注） */
export function resolvePlanScene(plan: LayoutPlan, project: Project): ResolvedPlanScene {
  if (plan.scene) {
    return {
      planId: plan.id,
      objects: plan.scene.objects,
      cables: plan.scene.cables,
      room: plan.scene.room,
      fallback: false,
    }
  }
  const byId = new Map(project.objects.map((o) => [o.id, o]))
  const objects: SceneObject[] = []
  for (const assignment of plan.assignments) {
    const object = byId.get(assignment.objectId)
    if (!object) continue
    objects.push({
      ...object,
      transform: { ...object.transform, position: [...assignment.position] as Vec3, rotationY: assignment.rotationY },
    })
  }
  return { planId: plan.id, objects, cables: [], room: project.room, fallback: true }
}

export interface PlanDiffEntry {
  /** 与至少一个其它方案存在差异的物品 / 线缆 */
  objectIds: Set<string>
  cableIds: Set<string>
}

export interface PlanDiff {
  byPlan: Record<string, PlanDiffEntry>
  hasDifferences: boolean
}

const r3 = (v: number) => Math.round(v * 1000) / 1000

const poseKey = (object: SceneObject): string =>
  `${r3(object.transform.position[0])},${r3(object.transform.position[1])},${r3(
    object.transform.position[2],
  )},${r3(object.transform.rotationY)}`

const cableKey = (cable: CableConnection, objects: SceneObject[]): string => {
  const visibility = resolveCableVisibility(cable, objects).visibility
  const thickness = resolveCableThickness(cable)
  const strategy = cable.route.strategy ?? CABLE_VISIBILITY_META[visibility].strategy
  const points = cable.route.points.map((p) => `${r3(p[0])},${r3(p[1])},${r3(p[2])}`).join(';')
  return `${visibility}|${thickness}|${strategy}|${points}`
}

/**
 * 方案差异：同一物品（或线缆）在不同方案中的位姿 / 路径不同、或仅在部分方案中存在时，
 * 记为差异（用于高亮「与其它方案不同的对象」）。
 */
export function computePlanDiff(scenes: ResolvedPlanScene[]): PlanDiff {
  const byPlan: Record<string, PlanDiffEntry> = {}
  for (const scene of scenes) byPlan[scene.planId] = { objectIds: new Set(), cableIds: new Set() }

  const markObjectDiff = (id: string, values: Array<string | null>) => {
    if (new Set(values).size <= 1) return
    values.forEach((value, index) => {
      if (value !== null) byPlan[scenes[index].planId].objectIds.add(id)
    })
  }
  const markCableDiff = (id: string, values: Array<string | null>) => {
    if (new Set(values).size <= 1) return
    values.forEach((value, index) => {
      if (value !== null) byPlan[scenes[index].planId].cableIds.add(id)
    })
  }

  const objectMaps = scenes.map(
    (scene) => new Map(scene.objects.filter((o) => o.visible).map((o) => [o.id, o])),
  )
  const cableMaps = scenes.map((scene) => new Map(scene.cables.map((c) => [c.id, c])))

  const allObjectIds = new Set<string>()
  for (const map of objectMaps) for (const id of map.keys()) allObjectIds.add(id)
  for (const id of allObjectIds) {
    markObjectDiff(id, objectMaps.map((map) => (map.get(id) ? poseKey(map.get(id)!) : null)))
  }

  const allCableIds = new Set<string>()
  for (const map of cableMaps) for (const id of map.keys()) allCableIds.add(id)
  for (const id of allCableIds) {
    markCableDiff(
      id,
      cableMaps.map((map, index) => (map.get(id) ? cableKey(map.get(id)!, scenes[index].objects) : null)),
    )
  }

  return { byPlan, hasDifferences: Object.values(byPlan).some((e) => e.objectIds.size > 0 || e.cableIds.size > 0) }
}

// ───────────────────────────── 列表筛选 / 排序 / 格式化 ─────────────────────────────

export type PlanSortKey = 'updated' | 'created' | 'name' | 'issues'

/** 对比页最多并排的方案数 */
export const MAX_COMPARE_PLANS = 3

export const PLAN_SORT_OPTIONS: Array<{ value: PlanSortKey; label: string }> = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '创建时间' },
  { value: 'name', label: '名称' },
  { value: 'issues', label: '未解决问题（少→多）' },
]

export const planUpdatedAt = (plan: LayoutPlan): number => plan.updatedAt ?? plan.createdAt

export function filterSortPlans(
  plans: LayoutPlan[],
  query: string,
  sort: PlanSortKey,
  metricsById: Record<string, PlanMetrics | undefined>,
): LayoutPlan[] {
  const keyword = query.trim().toLowerCase()
  const filtered = keyword
    ? plans.filter((plan) => plan.name.toLowerCase().includes(keyword))
    : plans.slice()
  return filtered.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh-CN')
    if (sort === 'created') return b.createdAt - a.createdAt
    if (sort === 'issues') {
      const ai = metricsById[a.id]?.issueCount
      const bi = metricsById[b.id]?.issueCount
      if (ai === null || ai === undefined) return bi === null || bi === undefined ? 0 : 1
      if (bi === null || bi === undefined) return -1
      return ai - bi
    }
    return planUpdatedAt(b) - planUpdatedAt(a)
  })
}

/** 方案时间展示（MM-DD HH:mm） */
export function formatPlanTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}
