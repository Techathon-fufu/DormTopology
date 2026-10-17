import { CABLE_THICKNESS_META, type CableConnection, type LayoutPlan, type Project, type Vec3 } from '@/types/project'
import type { CablePlanningResult } from '../types'
import type { OrganizationSceneRef } from '@/types/organization'
import { resolveOrganizationPreferences } from '@/types/organization'
import { isPowerSourcePort, resolveCableThickness, resolveCableVisibility } from '@/scene/cables'
import { localDirVec, resolvePortOffset } from '@/scene/ports'
import { computeCableAvoidZones } from '@/scene/routeNodes'
import { DESK_GAP } from '@/scene/sceneValidation'
import { ApiError } from './errors'
import { fromPackingPosition, packingBaseline, toPackingPosition, toPackingScene, type PackingScene, type RoutingCable, type RoutingGraph, type SceneBox } from './packingWire'

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const vector = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v))
function fail(message: string): never { throw new ApiError(message, { kind: 'malformed' }) }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('后端走线结果格式错误')
}

/** Include obstacles and all cables: another device or route can invalidate this result. */
export function cablePlanningInputSignature(project: Project): string {
  return JSON.stringify([project.id, project.room,
    project.objects.map(({ model, ...object }) => ({ ...object, modelShape: model.shape })),
    project.cables, resolveOrganizationPreferences(project)])
}

/** Inscribed square openings conservatively preserve the material around a circular hole. */
function openDeskTop(scene: PackingScene, project: Project): void {
  const slab = scene.obstacles.find((o) => o.id === 'furniture:desk-top')
  if (!slab) return
  let parts: SceneBox[] = [slab]
  for (const hole of project.room.cableHoles) {
    const center = toPackingPosition(hole.position, project.room)
    const half = hole.diameter / (2 * Math.sqrt(2))
    if (!Number.isFinite(half) || half <= 0 || center[0] - half < slab.min[0] || center[0] + half > slab.max[0] || center[2] - half < slab.min[2] || center[2] + half > slab.max[2]) {
      throw new ApiError('出线孔必须完整位于桌面内，且直径须大于零', { kind: 'input' })
    }
    const [x0, x1, z0, z1] = [center[0] - half, center[0] + half, center[2] - half, center[2] + half]
    parts = parts.flatMap((part) => {
      const a = Math.max(part.min[0], x0), b = Math.min(part.max[0], x1)
      const c = Math.max(part.min[2], z0), d = Math.min(part.max[2], z1)
      if (a >= b || c >= d) return [part]
      return [
        { min: part.min, max: [a, part.max[1], part.max[2]] as Vec3 },
        { min: [b, part.min[1], part.min[2]] as Vec3, max: part.max },
        { min: [a, part.min[1], part.min[2]] as Vec3, max: [b, part.max[1], c] as Vec3 },
        { min: [a, part.min[1], d] as Vec3, max: [b, part.max[1], part.max[2]] as Vec3 },
      ].filter((p) => p.max[0] - p.min[0] > 1e-9 && p.max[2] - p.min[2] > 1e-9).map((p) => ({ id: '', ...p }))
    })
  }
  if (project.room.cableHoles.length) scene.obstacles = scene.obstacles.flatMap((o) => o === slab ? parts.map((part, i) => ({ ...part, id: `furniture:desk-top:${i}` })) : [o])
}

/** Actual top/under channels are separate; only holes and the rear gap connect levels. */
function routingGraph(project: Project): RoutingGraph {
  const room = project.room, d = room.desk
  const graph: RoutingGraph = { nodes: [], edges: [] }
  const top: string[] = [], under: string[] = []
  const add = (id: string, position: Vec3, kind: RoutingGraph['nodes'][number]['kind']) => {
    graph.nodes.push({ id: `routing:${id}`, position: toPackingPosition(position, room), kind })
    return `routing:${id}`
  }
  const edge = (a: string, b: string, modes: Array<'slot' | 'backboard'>, clearance = 0.015, exposed = false) => {
    graph.edges.push({ id: `routing:edge:${graph.edges.length}`, from_node_id: a, to_node_id: b, modes, clearance_radius_m: clearance, exposed })
  }
  const topY = d.height + 0.012, underY = d.height - d.thickness - 0.025
  for (const x of [-d.width / 2 + 0.07, 0, d.width / 2 - 0.07]) {
    for (const z of [DESK_GAP + 0.035, DESK_GAP + d.depth - 0.07]) {
      const key = `${x}:${z}`
      top.push(add(`top:${key}`, [x, topY, z], 'corner'))
      under.push(add(`under:${key}`, [x, underY, z], 'corner'))
    }
  }
  for (const hole of room.cableHoles) {
    const a = add(`hole:${hole.id}:top`, [hole.position[0], topY, hole.position[2]], 'slot')
    const b = add(`hole:${hole.id}:under`, [hole.position[0], underY, hole.position[2]], 'slot')
    edge(a, b, ['slot'], Math.min(0.015, hole.diameter / (2 * Math.sqrt(2)) - 0.002))
    top.push(a); under.push(b)
  }
  for (const x of [-d.width / 2 + 0.07, 0, d.width / 2 - 0.07]) {
    const a = add(`rear:${x}:top`, [x, topY, DESK_GAP / 2], 'fixing_point')
    const b = add(`rear:${x}:under`, [x, underY, DESK_GAP / 2], 'fixing_point')
    edge(a, b, ['backboard'])
    // These are allowed rear channel positions, not a claim that a clip is installed.
    top.push(a); under.push(b)
  }
  for (const group of [top, under]) {
    for (let a = 0; a < group.length; a++) for (let b = a + 1; b < group.length; b++) {
      const modes: Array<'slot' | 'backboard'> = group[a].includes(':hole:') || group[b].includes(':hole:') ? ['slot']
        : group[a].includes(':rear:') || group[b].includes(':rear:') ? ['backboard'] : ['slot', 'backboard']
      edge(group[a], group[b], modes, 0.015, group === top)
    }
  }
  return graph
}

function cableType(cable: CableConnection, project: Project): RoutingCable['cable_type'] {
  const types = [cable.from, cable.to].map((end) => project.objects.find((o) => o.id === end.objectId)?.ports.find((p) => p.id === end.portId)?.type)
  if (types.every((type) => type === 'usb-a' || type === 'usb-c')) return 'usb'
  return cable.kind === 'video' ? 'hdmi' : cable.kind === 'network' ? 'network' : cable.kind === 'data' ? 'usb' : 'power'
}

export function toRoutingScene(input: { project: Project; confirmed: boolean; ref?: OrganizationSceneRef | null }): PackingScene {
  const { project } = input
  if (!input.confirmed) throw new ApiError('请先核对并确认物品尺寸、位置及接口', { kind: 'input' })
  const scene = toPackingScene({ projectId: project.id, objects: project.objects, room: project.room, preferences: resolveOrganizationPreferences(project), confirmed: input.confirmed, ref: input.ref })
  const portIds = new Set<string>()
  for (const item of scene.items) {
    const object = project.objects.find((o) => o.id === item.id)!
    for (const port of item.ports) {
      if (portIds.has(port.id)) throw new ApiError(`接口 ID 重复：${port.id}`, { kind: 'input' })
      portIds.add(port.id)
      const original = object.ports.find((p) => p.id === port.id)
      if (!original) continue
      port.confirmed = original.confirmed === true
      port.local_position = resolvePortOffset(object, original)
      port.local_direction = localDirVec(original.direction ?? 'back')
      if (original.type === 'power-ac' || original.type === 'dc') port.type = isPowerSourcePort(object, original) ? 'power_source' : 'power_sink'
    }
  }
  scene.cables = project.cables.map((cable) => {
    const ends = [cable.from, cable.to].map((endpoint) => {
      const item = scene.items.find((i) => i.id === endpoint.objectId)
      const port = item?.ports.find((p) => p.id === endpoint.portId)
      if (!port) throw new ApiError(`线缆 ${cable.id} 的设备或接口已删除，请重新指定端点`, { kind: 'input' })
      if (!port.confirmed) throw new ApiError(`线缆 ${cable.id} 的接口尚未确认`, { kind: 'input' })
      return port.id
    })
    if (ends[0] === ends[1]) throw new ApiError(`线缆 ${cable.id} 的起止接口必须不同`, { kind: 'input' })
    const actualLength = cable.actualLengthM ?? null
    if (actualLength !== null && (typeof actualLength !== 'number' || !Number.isFinite(actualLength) || actualLength <= 0)) throw new ApiError(`线缆 ${cable.id} 的已知实际线长无效`, { kind: 'input' })
    const slack = cable.reserveLengthM ?? 0
    if (!Number.isFinite(slack) || slack < 0) throw new ApiError(`线缆 ${cable.id} 的预留长度无效`, { kind: 'input' })
    const thickness = resolveCableThickness(cable), meta = CABLE_THICKNESS_META[thickness]
    return { id: cable.id, start_port_id: ends[0], end_port_id: ends[1], cable_type: cableType(cable, project), thickness,
      length_m: actualLength, diameter_m: meta.diameterM, min_bend_radius_m: meta.minBendRadiusM,
      slack_m: slack, mode: resolveCableVisibility(cable, project.objects).visibility === 'hidden' ? 'backboard' : 'slot' }
  })
  openDeskTop(scene, project)
  scene.routing_graph = routingGraph(project)
  if (scene.routing_graph.edges.some((edge) => edge.clearance_radius_m <= 0)) throw new ApiError('出线孔过小，无法配置线缆净空', { kind: 'input' })
  scene.reserved_zones = computeCableAvoidZones(project.room, resolveOrganizationPreferences(project)).map((zone) => ({
    id: `routing:${zone.id}`, min: toPackingPosition([zone.rect.x0, zone.y0, zone.rect.z0], project.room), max: toPackingPosition([zone.rect.x1, zone.y1, zone.rect.z1], project.room),
  }))
  scene.exposure_zones = [{ id: 'routing:exposure-desktop', min: [0, project.room.desk.height, 0], max: [project.room.desk.width, project.room.height, project.room.desk.depth] }]
  return scene
}

export function routingBaseline(baseline: LayoutPlan, project: Project, ref?: OrganizationSceneRef | null): PackingScene {
  // Automatic frontend snapshots are not measured cable baselines. Their wire lengths stay unknown.
  return packingBaseline(baseline, { projectId: project.id, objects: project.objects, room: project.room, preferences: resolveOrganizationPreferences(project), confirmed: true, ref })
}

const REASONS: Record<string, string> = {
  invalid_input: '输入不完整', no_path: '允许通道内无可行路径', incompatible_ports: '接口类型不兼容', port_occupied: '接口已占用',
  length_exceeded: '实际线长不足（含预留）', endpoint_blocked: '接口引出段受阻', collision: '线缆与障碍相交', unsupported_mode: '缺少该策略的通道', unsupported_span: '无支撑跨距超出限制',
}

export function mapRoutingResult(raw: unknown, ctx: { scene: PackingScene; project: Project }): CablePlanningResult {
  const data = record(raw), scene = ctx.scene
  if (data.schema_version !== '1.0' || data.scene_id !== scene.scene_id || data.scene_revision !== scene.scene_revision) fail('走线结果场景或版本不匹配，请重新规划')
  if (!Array.isArray(data.cables) || !Array.isArray(data.issues)) fail('后端走线缺少线路或问题列表')
  const issues = data.issues.map((value) => {
    const issue = record(value)
    if ((issue.entity_id !== null && typeof issue.entity_id !== 'string') || typeof issue.code !== 'string' || typeof issue.message !== 'string') fail('后端走线问题格式错误')
    return issue
  })
  const pending = new Map(scene.cables.map((cable) => [cable.id, cable]))
  const position = (id: string): Vec3 => {
    const item = scene.items.find((i) => i.ports.some((p) => p.id === id))!
    const port = item.ports.find((p) => p.id === id)!, [x, y, z] = port.local_position
    return [item.position[0] + Math.cos(item.rotation_y_rad) * x + Math.sin(item.rotation_y_rad) * z, item.position[1] + y, item.position[2] - Math.sin(item.rotation_y_rad) * x + Math.cos(item.rotation_y_rad) * z]
  }
  const same = (a: Vec3, b: Vec3) => a.every((v, i) => Math.abs(v - b[i]) < 1e-6)
  let plannedCount = 0, conflictCount = 0
  const cables = data.cables.map((value): CableConnection => {
    const route = record(value), input = typeof route.id === 'string' ? pending.get(route.id) : undefined
    if (!input) fail('后端走线包含未知或重复的线缆')
    pending.delete(input.id)
    const original = ctx.project.cables.find((cable) => cable.id === input.id)!
    for (const key of ['start_port_id', 'end_port_id', 'cable_type', 'thickness', 'mode', 'diameter_m'] as const) if (route[key] !== input[key]) fail('后端走线修改了端点、策略或线缆规格')
    if (!Array.isArray(route.path_points) || !Array.isArray(route.curve_segments)) fail('后端走线几何不完整')
    const points = route.path_points.map((p) => vector(p) ? p : fail('后端路径含非有限坐标'))
    const segments = route.curve_segments.map((value) => {
      const segment = record(value)
      if (!Array.isArray(segment.control_points) || segment.control_points.length !== 4 || !segment.control_points.every(vector)) fail('后端曲线必须有四个有效控制点')
      return segment.control_points as Vec3[]
    })
    if (route.status !== 'valid' && route.status !== 'failed') fail('后端单线状态无效')
    const valid = route.status === 'valid'
    if (valid) {
      if (route.reason_code !== null || points.length < 2 || !segments.length || typeof route.path_length_m !== 'number' || !Number.isFinite(route.path_length_m) || route.path_length_m <= 0 || (input.length_m !== null && route.path_length_m + input.slack_m > input.length_m + 1e-7)) fail('后端有效路径的长度、预留或成功状态不合规')
      if (!same(points[0], position(input.start_port_id)) || !same(points[points.length - 1], position(input.end_port_id)) || !same(segments[0][0], points[0]) || !same(segments[segments.length - 1][3], points[points.length - 1])) fail('后端曲线没有连接真实接口')
      segments.slice(1).forEach((segment, index) => { if (!same(segment[0], segments[index][3])) fail('后端连续曲线断开') })
      const sampledLength = points.slice(1).reduce((sum, p, index) => sum + Math.hypot(...p.map((v, i) => v - points[index][i])), 0)
      if (sampledLength > route.path_length_m + 0.001) fail('后端路径采样长度超过声明的曲线长度')
      if (issues.some((issue) => issue.entity_id === input.id)) fail('后端有效路径仍包含失败原因')
      plannedCount++
    } else {
      if (points.length || segments.length || route.path_length_m !== null || typeof route.reason_code !== 'string' || !REASONS[route.reason_code]) fail('后端失败路径必须清空几何、长度并给出原因')
      conflictCount++
    }
    let supportStatus: 'verified' | 'not_evaluated' = 'not_evaluated'
    if (route.support_check !== undefined) {
      const support = record(route.support_check)
      if (support.status !== 'not_evaluated' || support.max_unsupported_span_m !== null || !Array.isArray(support.support_ids) || support.support_ids.length) fail('未提交已安装支撑，不能报告支撑验证通过')
      supportStatus = support.status
    }
    const reasonCode = valid ? undefined : route.reason_code as string
    return { ...original, originalRoute: copy(original.originalRoute ?? original.route),
      route: { channels: input.mode === 'slot' ? ['deskEdge', 'deskUnderside'] : ['backboard', 'deskUnderside'],
        points: points.map((p) => fromPackingPosition(p, ctx.project.room)), smooth: false, strategy: input.mode === 'slot' ? 'cableHole' : 'backboard',
        ...(valid ? { pathLengthM: route.path_length_m as number } : {}),
        verification: { sceneId: scene.scene_id, sceneRevision: scene.scene_revision, status: route.status, reasonCode, supportStatus, maxUnsupportedSpanM: null } },
      status: valid ? 'planned' : 'conflict', planSource: 'algorithm', accessories: [],
      note: valid ? `真实算法已验证几何、接口和弯曲半径；${input.length_m === null ? '已计算所需线长，现有线材长度未校验' : '现有线材长度已校验'}；安装支撑尚未复核` : `真实算法：${REASONS[reasonCode!]}${issues.find((issue) => issue.entity_id === input.id)?.message ? `；${issues.find((issue) => issue.entity_id === input.id)!.message}` : ''}`,
      updatedAt: Date.now(),
    }
  })
  if (pending.size) fail('后端结果未覆盖当前场景全部线缆')
  const expectedStatus = conflictCount === 0 ? 'success' : plannedCount > 0 ? 'partial' : 'infeasible'
  if (data.status !== expectedStatus) fail('后端整体状态与单线结果不一致')
  return { cables, plannedCount, conflictCount, algorithmVerified: true,
    sceneRef: { sceneId: scene.scene_id, sceneRevision: scene.scene_revision, baselineId: scene.baseline_id },
    notes: ['已对当前场景全部线缆共同复查接口占用与线缆碰撞。', '尚未配置并确认已安装的扎带或集线槽；支撑与施工可行性未验证。', '原始线缆未提供实测路径，原始暴露线长保持未知。'] }
}
