import type {
  CableChannel,
  CableConnection,
  Project,
  RoomConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import { CABLE_CHANNEL_LABELS, CABLE_KIND_META, CATEGORY_LABELS } from '@/types/project'
import { resolveOrganizationPreferences } from '@/types/organization'
import { cableDisplayPoints, endpointLabel, hasUsableCableRoute, resolveEndpointPosition } from '@/scene/cables'
import { checkCableRoute } from '@/scene/cableRoute'
import { cablePathLength, cablePathSamples, totalCablePathLength } from '@/scene/cableGeometry'
import { computeCableAvoidZones, deskUnderY } from '@/scene/routeNodes'
import { DESK_GAP, nearestSupport, validateScene } from '@/scene/sceneValidation'
import { validCableMounts } from '@/scene/cableManagement'
import { formatMeters, radToDeg } from '@/lib/units'

/**
 * 方案交付页（执行指南）内容生成。
 *
 * 诚实标注：
 * - 所有步骤 / 数值均从「当前项目数据」实时推导，不写死演示步骤；
 * - 真实曲线长度采用后端验证积分；演示路径和配件数量仍为本地估算；
 * - 后端失败、过期及未规划线路进入问题清单，不生成可执行接线步骤；
 *   有效演示路径另外做本地几何检查，真实路径保留后端验证结论与支撑状态。
 */

// ───────────────────────────── 通用结构 ─────────────────────────────

export interface StepTarget {
  type: 'object' | 'cable'
  id: string
}

export interface GuideStep {
  id: string
  title: string
  detail: string
  /** 点击步骤 / 定位按钮时可在三维视图中高亮的对象 */
  target?: StepTarget
  tags?: string[]
}

export type GuideAccessoryKind = 'clip' | 'hook' | 'velcro' | 'sleeve' | 'tray'

export interface GuideAccessory {
  id: GuideAccessoryKind
  label: string
  /** 建议总数 */
  count: number
  /** 其中来自已配置配件或走线规划标注的数量 */
  fromPlan: number
  /** 其中本地规则估算的数量 */
  estimated: number
  reason: string
}

export interface GuideIssue {
  id: string
  severity: 'warning' | 'info'
  kind: 'placement' | 'cable' | 'length' | 'power' | 'other'
  message: string
  target?: StepTarget
}

export interface GuideStats {
  objectCount: number
  visibleObjectCount: number
  cableCount: number
  plannedCableCount: number
  /** 完整路径长度合计；任意线路无有效路径时未知。 */
  totalLengthM: number | null
  /** 含用户填写预留的长度合计（米） */
  requiredLengthM: number | null
  warningCount: number
  infoCount: number
}

export interface GuideBundle {
  /** 方案指纹（见 guideStampOf） */
  stamp: string
  placement: GuideStep[]
  connections: GuideStep[]
  gathers: GuideStep[]
  accessories: GuideAccessory[]
  issues: GuideIssue[]
  stats: GuideStats
}

export const ACCESSORY_GUIDE_LABELS: Record<GuideAccessoryKind, string> = {
  clip: '理线卡扣（自粘 / 桌沿夹持）',
  hook: '立柱理线挂钩',
  velcro: '魔术贴扎带',
  sleeve: '理线套管',
  tray: '桌底理线槽',
}

const mm = (m: number): number => Math.round(m * 1000)

// ───────────────────────────── 物品摆放步骤 ─────────────────────────────

function supportRankOf(project: Project, object: SceneObject): number {
  const [x, y, z] = object.transform.position
  const support = nearestSupport(project.room, x, z, y)
  if (!support) return 3
  if (support.kind === 'desk') return 0
  if (support.kind === 'shelf') return 1
  if (support.kind === 'floor') return 2
  return 3
}

function placementDetail(project: Project, object: SceneObject): string {
  const [x, y, z] = object.transform.position
  const support = nearestSupport(project.room, x, z, y)
  const target = support ? support.label : '自由位置'
  const parts: string[] = []
  parts.push(
    object.locked
      ? `保持原位（已锁定）：${target}，底面 x ≈ ${mm(x)} mm、z ≈ ${mm(z)} mm`
      : `放到${target}：底面 x ≈ ${mm(x)} mm、z ≈ ${mm(z)} mm`,
  )
  if (Math.abs(object.transform.rotationY) > 0.01) {
    parts.push(`朝向旋转 ${Math.round(radToDeg(object.transform.rotationY))}°`)
  }
  if (object.frequent && !object.locked) parts.push('常用物品，放在伸手可及处')
  if (object.needsPower) parts.push('就位后按「线缆连接次序」接线')
  return `${parts.join('；')}。`
}

/**
 * 摆放步骤：按「支撑面（桌面 → 书架 → 地面）→ 占地大小」排序，
 * 位置描述与尺寸均来自对象当前数据（锁定物品保持原位）。
 */
export function buildPlacementSteps(project: Project): GuideStep[] {
  const visible = project.objects.filter((o) => o.visible)
  if (visible.length === 0) return []

  const ordered = [...visible].sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1
    const ra = supportRankOf(project, a)
    const rb = supportRankOf(project, b)
    if (ra !== rb) return ra - rb
    const aa = a.dimensions.width * a.dimensions.depth
    const ab = b.dimensions.width * b.dimensions.depth
    if (Math.abs(aa - ab) > 1e-9) return ab - aa
    return a.name.localeCompare(b.name, 'zh-Hans-CN')
  })

  const steps: GuideStep[] = []

  const deskItems = ordered.filter((o) => !o.locked && supportRankOf(project, o) === 0)
  if (deskItems.length >= 2) {
    const names = deskItems
      .slice(0, 4)
      .map((o) => o.name)
      .join('、')
    steps.push({
      id: 'prep:clear-desk',
      title: '清空桌面操作区',
      detail: `先把桌面上的「${names}${deskItems.length > 4 ? ` 等 ${deskItems.length} 件` : ''}」暂放到床面或地面，为按新方案逐一归位腾出空间。`,
    })
  }

  for (const object of ordered) {
    steps.push({
      id: `place:${object.id}`,
      title: object.locked ? `「${object.name}」保持原位（已锁定）` : `归位「${object.name}」`,
      detail: placementDetail(project, object),
      target: { type: 'object', id: object.id },
      tags: [CATEGORY_LABELS[object.category]],
    })
  }

  return steps
}

// ───────────────────────────── 线缆连接次序 ─────────────────────────────

function cableBrief(cable: CableConnection, objects: SceneObject[]): string {
  const from = endpointLabel(objects, cable.from)
  const to = endpointLabel(objects, cable.to)
  return `${from.objectName} → ${to.objectName}`
}

function channelsTextOf(cable: CableConnection): string {
  const channels = cable.route.channels.filter((ch) => ch !== 'free')
  if (channels.length === 0) return '尚未规划路径（当前为两点直连）'
  return channels.map((ch) => CABLE_CHANNEL_LABELS[ch]).join(' → ')
}

function cableDetail(project: Project, cable: CableConnection): string {
  const { objects } = project
  const from = endpointLabel(objects, cable.from)
  const to = endpointLabel(objects, cable.to)
  const est = cablePathLength(cable, objects)
  if (est === null) return '当前连接没有可执行的有效路径，请回工作台完成规划并解决失败原因后再接线。'
  const reserve = cable.reserveLengthM ?? 0
  const required = est + reserve

  const parts: string[] = []
  parts.push(`从「${from.objectName} · ${from.portLabel}」接到「${to.objectName} · ${to.portLabel}」`)
  parts.push(`通道：${channelsTextOf(cable)}`)
  parts.push(
    reserve > 0
      ? `${cable.route.pathLengthM === undefined ? '长度估算' : '已验证路径长度'} ${formatMeters(est)}，加预留共 ${formatMeters(required)}`
      : `${cable.route.pathLengthM === undefined ? '长度估算' : '已验证路径长度'} ${formatMeters(est)}`,
  )
  if (cable.actualLengthM !== undefined && cable.actualLengthM !== null) {
    if (cable.actualLengthM + 1e-6 < required) {
      parts.push(
        `手头线长 ${formatMeters(cable.actualLengthM)}，不足（差约 ${formatMeters(required - cable.actualLengthM)}），建议换线或调短路径`,
      )
    } else {
      parts.push(`手头线长 ${formatMeters(cable.actualLengthM)}，长度足够`)
    }
  } else {
    parts.push(`备线长度至少 ${formatMeters(required)}`)
  }
  if (cable.accessories.length > 0) {
    parts.push(
      `规划标注配件：${cable.accessories.map((a) => `${ACCESSORY_GUIDE_LABELS[a.type]} ×${a.count}`).join('、')}`,
    )
  }
  if (cable.status === 'stale') parts.push('方案修改后待重新计算，请回工作台点「更新走线」')
  if (cable.status === 'conflict') parts.push('当前路径存在障碍，先解决「未解决的问题」再接线')
  return `${parts.join('；')}。`
}

/**
 * 连接步骤：按「接入端高度」从高到低排序（桌面设备接线在前，地面上排插收尾），
 * 端点、通道、长度与状态均来自当前线缆数据。
 */
export function buildCableConnectionSteps(project: Project): GuideStep[] {
  const { objects, cables } = project
  const sorted = cables.filter(hasUsableCableRoute).sort((a, b) => {
    const ya = Math.max(
      resolveEndpointPosition(objects, a.from)[1],
      resolveEndpointPosition(objects, a.to)[1],
    )
    const yb = Math.max(
      resolveEndpointPosition(objects, b.from)[1],
      resolveEndpointPosition(objects, b.to)[1],
    )
    if (Math.abs(ya - yb) > 1e-4) return yb - ya
    return a.id.localeCompare(b.id)
  })

  return sorted.map((cable) => {
    const channels = cable.route.channels.filter((ch) => ch !== 'free')
    return {
      id: `connect:${cable.id}`,
      title: `${CABLE_KIND_META[cable.kind].label}：${cableBrief(cable, objects)}`,
      detail: cableDetail(project, cable),
      target: { type: 'cable', id: cable.id },
      tags: channels.length > 0 ? channels.map((ch) => CABLE_CHANNEL_LABELS[ch]) : ['待规划'],
    }
  })
}

// ───────────────────────────── 收拢固定次序 ─────────────────────────────

const GATHER_PHASES: Array<{ channel: CableChannel; title: string; hint: string }> = [
  { channel: 'deskEdge', title: '沿桌沿固定', hint: '线缆贴桌沿后缘顺直走，别绕到打字手位' },
  { channel: 'deskUnderside', title: '沿桌底走线面固定', hint: '贴桌板背面，与桌腿保持平行' },
  { channel: 'backboard', title: '整理背板后的线路', hint: '沿当前有效路径整理，确认背板间隙与实际固定点' },
  { channel: 'post', title: '绑扎到桌腿 / 床架立柱', hint: '垂直段分段绑扎，避免下垂晃荡' },
  { channel: 'floor', title: '收拢地面段', hint: '沿墙脚 / 桌底走，给凳子留出活动余量' },
]

/**
 * 收拢步骤：先提示未规划线缆，随后按「桌沿 → 桌底 → 立柱 → 地面」的物理次序分组，
 * 每组列出实际经过该通道的线缆。
 */
export function buildCableGatherSteps(project: Project): GuideStep[] {
  const steps: GuideStep[] = []
  const { objects, cables } = project
  const planned = cables.filter(hasUsableCableRoute)
  const unplanned = cables.filter((c) => !planned.includes(c))

  if (unplanned.length > 0) {
    steps.push({
      id: 'gather:plan-first',
      title: `先完成走线规划（${unplanned.length} 条尚无有效路径）`,
      detail: `${unplanned
        .slice(0, 4)
        .map((c) => cableBrief(c, objects))
        .join('、')}${unplanned.length > 4 ? ` 等 ${unplanned.length} 条` : ''}尚未通过规划或已过期。请回到工作台重新规划并解决失败原因后，再固定这些线路。`,
      target: { type: 'cable', id: unplanned[0].id },
      tags: ['待规划'],
    })
  }

  for (const phase of GATHER_PHASES) {
    const list = planned.filter((c) => c.route.channels.includes(phase.channel))
    if (list.length === 0) continue
    steps.push({
      id: `gather:${phase.channel}`,
      title: `${phase.title}（${list.length} 条）`,
      detail: `${list
        .slice(0, 4)
        .map((c) => cableBrief(c, objects))
        .join('、')}${list.length > 4 ? ` 等 ${list.length} 条` : ''}：${phase.hint}；固定点间距与数量见下方「配件清单」估算。`,
      target: { type: 'cable', id: list[0].id },
      tags: [CABLE_CHANNEL_LABELS[phase.channel]],
    })
  }

  return steps
}

// ───────────────────────────── 配件建议（计算值） ─────────────────────────────

interface RouteRuns {
  /** 贴桌面走线段长度（米） */
  desk: number
  /** 桌底走线面段长度 */
  under: number
  /** 垂直下落段长度 */
  vertical: number
  /** 地面段长度 */
  floor: number
}

/** 按平滑采样点把路径分类为 桌面 / 桌底 / 垂直 / 地面 段（本地几何规则） */
function routeRuns(samples: Vec3[], room: RoomConfig): RouteRuns {
  const desk = room.desk
  const g = DESK_GAP
  const deskZ0 = g - 0.03
  const deskZ1 = g + desk.depth + 0.03
  const inDeskXZ = (p: Vec3) =>
    Math.abs(p[0]) <= desk.width / 2 + 0.05 && p[2] >= deskZ0 && p[2] <= deskZ1
  const underY = deskUnderY(room)

  const runs: RouteRuns = { desk: 0, under: 0, vertical: 0, floor: 0 }
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]
    const b = samples[i]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])
    if (len < 1e-6) continue
    const midY = (a[1] + b[1]) / 2
    const dy = Math.abs(b[1] - a[1])
    if (inDeskXZ(a) && inDeskXZ(b) && Math.abs(midY - desk.height) <= 0.03) {
      runs.desk += len
    } else if (dy > 0.6 * len && len > 0.008) {
      runs.vertical += len
    } else if (inDeskXZ(a) && inDeskXZ(b) && midY <= desk.height - desk.thickness && midY >= underY - 0.1) {
      runs.under += len
    } else if (midY <= 0.08) {
      runs.floor += len
    }
  }
  return runs
}

/**
 * 配件清单：走线规划中显式标注的数量（fromPlan）+ 本地规则估算（estimated）。
 * 估算规则（文档化，便于复核）：
 * - 卡扣：跨桌沿每条 1 处；桌面 / 桌底走线段每约 0.3 m 一处
 * - 挂钩：垂直段每约 0.5 m 一处；经过立柱 / 桌腿的线缆每条至少 1 处
 * - 扎带：已规划线缆每处通道切换 1 根、地面长段（> 0.2 m）另加 1 根；未规划线缆各备 1 根
 * - 理线槽：规划标注优先；否则线缆 ≥ 3 条时建议 1 条
 */
export function buildAccessories(project: Project): GuideAccessory[] {
  const cables = project.cables.filter(hasUsableCableRoute)
  const { objects } = project
  const mounts = validCableMounts(project.room)
  if (cables.length === 0 && mounts.length === 0) return []

  let clipPlan = 0
  let clipEst = 0
  let velcroPlan = 0
  let velcroEst = 0
  let sleevePlan = 0
  let trayPlan = 0
  let hookEst = 0
  let deskRun = 0
  let underRun = 0
  let verticalRun = 0
  let floorRun = 0
  let edgeCross = 0
  let postCross = 0

  for (const cable of cables) {
    const runs = routeRuns(cablePathSamples(cable, objects), project.room)
    deskRun += runs.desk
    underRun += runs.under
    verticalRun += runs.vertical
    floorRun += runs.floor

    const channels = cable.route.channels
    const planned = hasUsableCableRoute(cable)
    if (channels.includes('deskEdge')) edgeCross += 1
    if (channels.includes('post')) postCross += 1

    const explicitCount = (type: GuideAccessoryKind): number | undefined =>
      cable.accessories.find((a) => a.type === type)?.count

    const clipPlanned = explicitCount('clip')
    if (clipPlanned !== undefined) {
      clipPlan += clipPlanned
    } else if (planned) {
      clipEst +=
        (channels.includes('deskEdge') ? 1 : 0) +
        (runs.desk > 0.05 ? Math.max(1, Math.ceil(runs.desk / 0.3)) : 0) +
        (runs.under > 0.05 ? Math.max(1, Math.ceil(runs.under / 0.35)) : 0)
    }

    const velcroPlanned = explicitCount('velcro')
    if (velcroPlanned !== undefined) {
      velcroPlan += velcroPlanned
    } else {
      const nonFree = channels.filter((ch) => ch !== 'free')
      velcroEst += planned
        ? Math.max(1, nonFree.length - 1) + (runs.floor > 0.2 ? 1 : 0)
        : 1
    }

    sleevePlan += explicitCount('sleeve') ?? 0
    trayPlan += explicitCount('tray') ?? 0

    hookEst += Math.max(
      runs.vertical > 0.1 ? Math.max(1, Math.round(runs.vertical / 0.5)) : 0,
      channels.includes('post') ? 1 : 0,
    )
  }

  const rows: GuideAccessory[] = []

  const clipCount = clipPlan + clipEst
  if (clipCount > 0) {
    rows.push({
      id: 'clip',
      label: ACCESSORY_GUIDE_LABELS.clip,
      count: clipCount,
      fromPlan: clipPlan,
      estimated: clipEst,
      reason: `按当前已规划路径估算：桌面 / 桌底走线段合计约 ${formatMeters(deskRun + underRun)}（每约 0.3 m 一处），${edgeCross} 条跨桌沿各需 1 处过渡固定${clipPlan > 0 ? `；另有走线规划中标注 ${clipPlan} 个` : ''}。`,
    })
  }

  if (hookEst > 0) {
    rows.push({
      id: 'hook',
      label: ACCESSORY_GUIDE_LABELS.hook,
      count: hookEst,
      fromPlan: 0,
      estimated: hookEst,
      reason: `垂直下落段合计约 ${formatMeters(verticalRun)}、经过立柱 / 桌腿的线缆 ${postCross} 条（按每约 0.5 m 一处、每条至少 1 处估算）。`,
    })
  }

  const velcroCount = velcroPlan + velcroEst
  if (velcroCount > 0) {
    rows.push({
      id: 'velcro',
      label: ACCESSORY_GUIDE_LABELS.velcro,
      count: velcroCount,
      fromPlan: velcroPlan,
      estimated: velcroEst,
      reason: `按通道切换与收束点估算：已规划线缆每处通道切换约 1 根、地面长段（约 ${formatMeters(floorRun)}）另加收拢；未规划线缆先各备 1 根${velcroPlan > 0 ? `；含走线规划中标注 ${velcroPlan} 根` : ''}。`,
    })
  }

  if (sleevePlan > 0) {
    rows.push({
      id: 'sleeve',
      label: ACCESSORY_GUIDE_LABELS.sleeve,
      count: sleevePlan,
      fromPlan: sleevePlan,
      estimated: 0,
      reason: '来自走线规划中标注的理线套管数量。',
    })
  }

  const trayTotal = trayPlan > 0 ? trayPlan : cables.length >= 3 ? 1 : 0
  if (trayTotal > 0) {
    rows.push({
      id: 'tray',
      label: ACCESSORY_GUIDE_LABELS.tray,
      count: trayTotal,
      fromPlan: trayPlan,
      estimated: trayTotal - trayPlan,
      reason:
        trayPlan > 0
          ? '来自走线规划中标注的理线槽数量。'
          : `当前共有 ${cables.length} 条线缆（≥ 3 条），建议在桌底加装理线槽统一收纳（本地规则估算）。`,
    })
  }

  // Shared hardware is counted by mount ID, independently of the number of member cables.
  for (const kind of ['clip', 'velcro', 'tray'] as const) {
    const configured = mounts.filter((mount) => kind === 'clip' ? mount.preset === 'rear-clips' || mount.kind === 'surface'
      : kind === 'velcro' ? mount.kind === 'cable_tie' && mount.preset !== 'rear-clips' : mount.kind === 'cable_tray')
    if (!configured.length) continue
    const installed = configured.filter((mount) => mount.installed).length
    const configuredReason = `已配置 ${configured.length} 处：已确认安装 ${installed} 处，待安装建议 ${configured.length - installed} 处。${configured.map((mount) => mount.label).join('、')}。`
    const existing = rows.find((row) => row.id === kind)
    const row: GuideAccessory = {
      id: kind, label: ACCESSORY_GUIDE_LABELS[kind], count: configured.length,
      fromPlan: configured.length, estimated: 0, reason: configuredReason,
    }
    if (existing) Object.assign(existing, row)
    else rows.push(row)
  }
  return rows
}

// ───────────────────────────── 未解决的问题 ─────────────────────────────

/**
 * 问题清单：摆放校验（越界 / 相交 / 悬空）+ 走线检查（边界 / 相交 / 端点）
 * + 线长核对 + 供电未接线。全部来自本地几何检查，接入真实算法后以服务端复查为准。
 */
export function collectGuideIssues(project: Project): GuideIssue[] {
  const issues: GuideIssue[] = []
  const objectById = new Map(project.objects.map((o) => [o.id, o]))

  // 1) 摆放问题
  const placement = validateScene(project.objects, project.room)
  for (const [objectId, list] of placement) {
    const name = objectById.get(objectId)?.name ?? '（物品已删除）'
    for (const issue of list) {
      issues.push({
        id: `placement:${objectId}:${issue.type}:${issues.length}`,
        severity: 'warning',
        kind: 'placement',
        message: `「${name}」：${issue.message}`,
        target: { type: 'object', id: objectId },
      })
    }
  }

  // 2) 走线检查 + 线长核对
  const avoidZones = computeCableAvoidZones(project.room, resolveOrganizationPreferences(project))
  for (const cable of project.cables) {
    const names = cableBrief(cable, project.objects)

    if (!hasUsableCableRoute(cable)) {
      issues.push({
        id: `unresolved:${cable.id}`,
        severity: cable.status === 'conflict' ? 'warning' : 'info',
        kind: 'cable',
        message: `「${names}」没有当前有效路径：${cable.note ?? (cable.status === 'stale' ? '场景已变更，需要重新计算' : '尚未完成走线规划')}。请回工作台重新规划；当前长度未知，不能作为接线和固定依据。`,
        target: { type: 'cable', id: cable.id },
      })
      continue
    }

    const points = cableDisplayPoints(cable, project.objects, 'suggested')
    const pathLength = cablePathLength(cable, project.objects)
    if (pathLength === null) continue
    const check = cable.planSource === 'algorithm' && cable.route.verification?.status === 'valid'
      ? { lengthM: pathLength, issues: [] } : checkCableRoute({
      points,
      smooth: cable.route.smooth,
      from: cable.from,
      to: cable.to,
      objects: project.objects,
      room: project.room,
      avoidZones,
      cables: project.cables,
      cable,
      selfCableId: cable.id,
    })
    for (const [i, issue] of check.issues.slice(0, 4).entries()) {
      issues.push({
        id: `cable:${cable.id}:${i}`,
        severity: 'warning',
        kind: 'cable',
        message: `「${names}」：${issue.message}（位置约 x ${mm(issue.position[0])} / y ${mm(issue.position[1])} / z ${mm(issue.position[2])} mm）`,
        target: { type: 'cable', id: cable.id },
      })
    }
    if (check.issues.length > 4) {
      issues.push({
        id: `cable:${cable.id}:more`,
        severity: 'info',
        kind: 'cable',
        message: `「${names}」还有 ${check.issues.length - 4} 处路径问题未逐一列出，建议回工作台整体复查。`,
        target: { type: 'cable', id: cable.id },
      })
    }

    const reserve = cable.reserveLengthM ?? 0
    const required = pathLength + reserve
    if (cable.actualLengthM !== undefined && cable.actualLengthM !== null && cable.actualLengthM + 1e-6 < required) {
      issues.push({
        id: `length:${cable.id}`,
        severity: 'warning',
        kind: 'length',
        message: `「${names}」线长不足：手头 ${formatMeters(cable.actualLengthM)}，需约 ${formatMeters(required)}（差约 ${formatMeters(required - cable.actualLengthM)}）。建议换更长线缆，或在工作中调整路径缩短走线。`,
        target: { type: 'cable', id: cable.id },
      })
    }
    if (cable.route.verification?.supportStatus === 'not_evaluated') {
      issues.push({ id: `support:${cable.id}`, severity: 'info', kind: 'cable',
        message: `「${names}」尚未评估贴面与固定支撑，接线前需确认扎带、线夹或集线槽的实际安装条件。`,
        target: { type: 'cable', id: cable.id } })
    }
  }

  // 3) 供电需求未接线
  for (const object of project.objects) {
    if (!object.visible || !object.needsPower) continue
    const connected = project.cables.some(
      (c) => hasUsableCableRoute(c) && (c.kind === 'power' || c.kind === 'charging')
        && (c.from.objectId === object.id || c.to.objectId === object.id),
    )
    if (connected) continue
    issues.push({
      id: `power:${object.id}`,
      severity: 'warning',
      kind: 'power',
      message:
        object.ports.length === 0
          ? `「${object.name}」有供电需求但还没有接口信息：回工作台补齐默认接口后再接线。`
          : `「${object.name}」有供电需求但尚未建立连接：到工作台「规划走线」为其接线。`,
      target: { type: 'object', id: object.id },
    })
  }

  return issues
}

// ───────────────────────────── 方案指纹与汇总 ─────────────────────────────

function round3(v: number): number {
  return Math.round(v * 1000) / 1000
}

/**
 * 方案指纹：对与指南内容相关的项目数据做稳定序列化后取哈希。
 * 工作台修改方案后指纹变化，交付页据此提示「重新生成」。
 */
export function guideStampOf(project: Project): string {
  const payload = JSON.stringify({
    v: 1,
    room: project.room,
    organization: project.organization ?? null,
    objects: [...project.objects]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((o) => ({
        id: o.id,
        name: o.name,
        category: o.category,
        visible: o.visible,
        locked: o.locked,
        frequent: o.frequent,
        needsPower: o.needsPower,
        dimensions: o.dimensions,
        transform: o.transform,
        shape: o.model.shape ?? null,
        ports: o.ports.map((p) => ({
          id: p.id,
          type: p.type,
          powered: p.powered,
          confirmed: p.confirmed,
          offset: p.offset,
          direction: p.direction,
        })),
      })),
    cables: [...project.cables]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((c) => ({
        id: c.id,
        kind: c.kind,
        thickness: c.thickness,
        visibility: c.visibility,
        from: c.from,
        to: c.to,
        status: c.status,
        actualLengthM: c.actualLengthM ?? null,
        reserveLengthM: c.reserveLengthM ?? null,
        accessories: c.accessories,
        channels: c.route.channels,
        points: c.route.points.map((p) => p.map(round3) as Vec3),
        nodeIds: c.route.nodeIds ?? null,
        smooth: c.route.smooth,
        pathLengthM: c.route.pathLengthM,
        verification: c.route.verification,
      })),
  })
  let h = 5381
  for (let i = 0; i < payload.length; i += 1) {
    h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0
  }
  return `${payload.length.toString(36)}-${h.toString(36)}`
}

/** 一次生成交付页所需的全部内容（步骤 / 配件 / 问题 / 统计 / 指纹） */
export function buildGuideBundle(project: Project): GuideBundle {
  const issues = collectGuideIssues(project)
  const warningCount = issues.filter((i) => i.severity === 'warning').length
  const infoCount = issues.length - warningCount

  const placement = buildPlacementSteps(project)
  if (warningCount > 0) {
    placement.push({
      id: 'placement:review',
      title: `复核摆放与走线（${warningCount} 处待解决）`,
      detail:
        '按上方步骤归位、按走线次序接线后，逐项核对页面底部「未解决的问题」；全部处理即可交付。',
    })
  }

  const totalLengthM = totalCablePathLength(project.cables, project.objects)
  const requiredLengthM = totalLengthM === null ? null
    : totalLengthM + project.cables.reduce((sum, cable) => sum + (cable.reserveLengthM ?? 0), 0)
  const plannedCableCount = project.cables.filter(hasUsableCableRoute).length

  return {
    stamp: guideStampOf(project),
    placement,
    connections: buildCableConnectionSteps(project),
    gathers: buildCableGatherSteps(project),
    accessories: buildAccessories(project),
    issues,
    stats: {
      objectCount: project.objects.length,
      visibleObjectCount: project.objects.filter((o) => o.visible).length,
      cableCount: project.cables.length,
      plannedCableCount,
      totalLengthM,
      requiredLengthM,
      warningCount,
      infoCount,
    },
  }
}
