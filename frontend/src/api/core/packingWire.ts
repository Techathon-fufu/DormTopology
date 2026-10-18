import { desktopBinding, desktopPlacementIssue, desktopMovementRange, mouseSupportPad } from '@/scene/desktopBindings'
import { resolvePortLocalDirection } from '@/features/connections/portGeometry'
import type { LayoutPlan, RoomConfig, SceneObject, Vec3 } from '@/types/project'
import type { OrganizationIssue, OrganizationPlan, OrganizationPreferences, OrganizationSceneRef, PlanAssignment, ZoneKind } from '@/types/organization'
import { collisionsOverlap, exportCollision, worldCollision, type CompoundCollision } from '@/scene/collisionGeometry'
import { DEFAULT_MIN_ITEM_GAP_M, organizationClearanceIssues, organizationReservedZones } from '@/scene/organizationClearance'
import { roomSolids } from '@/scene/roomCollision'
import { furnitureSurfaces, hasFixedFurniture } from '@/scene/fixedFurniture'
import { BED_UNDERSIDE_Y, computeOrganizationZones, type ZoneRect } from '@/scene/organizationZones'
import { allowsFloorPlacement, isDailyMiscellaneous, isStudyItem, monitorViewRegion, printerSideRegions, subtractRect } from '@/scene/organizationPolicy'
import { DESK_GAP, placementIssues } from '@/scene/sceneValidation'
import { resolvePortOffset } from '@/scene/ports'
import { estimateDeskFreeArea } from '@/scene/ruleLayout'
import { uid } from '@/lib/utils'
import { assertAssetUrl } from '@/scene/assetPolicy'
import { ApiError } from './errors'
import type { RoutingSupport, TrayCandidate } from '@/algorithm-lab/contract'

interface PackingRegion {
  id: string
  surface_y_m: number
  bounds_xz_m: [number, number, number, number]
  clearance_height_m: number
}

export interface PackingItem {
  id: string
  name: string
  category: string
  size_m: Vec3
  position: Vec3
  rotation_y_rad: number
  dimensions_source: 'user' | 'template' | 'estimated'
  dimensions_confirmed: boolean
  fixed: boolean
  usage_frequency: 'high' | 'medium'
  placement_priority: number
  allowed_region_ids: string[]
  preferred_region_ids: string[]
  allowed_rotations_y_rad: number[]
  collision: CompoundCollision
  ports: Array<{ id: string; type: string; local_position: Vec3; local_direction: Vec3; capacity: number; confirmed: boolean }>
  image_url: string | null
  model_url: string | null
  generation: { task_id: null; status: 'not_requested'; source: 'placeholder' | 'live' | 'cache'; error: null }
  surface_mount?: { obstacle_id: string; face: 'z_max' }
  socket_count?: number
}

export interface SceneBox {
  id: string
  min: Vec3
  max: Vec3
}

export interface RoutingGraph {
  spatial_cost_policy?: import('@/scene/routingPolicy').SpatialCostPolicy
  path_style?: 'smooth' | 'orthogonal'
  nodes: Array<{ id: string; position: Vec3; kind: 'corner' | 'slot' | 'fixing_point' | 'endpoint' }>
  edges: Array<{ id: string; from_node_id: string; to_node_id: string; modes: Array<'slot' | 'backboard'>; clearance_radius_m: number; exposed: boolean }>
  support_policy?: { max_unsupported_span_m: number }
  supports?: RoutingSupport[]
  tray_candidates?: TrayCandidate[]
}

export interface RoutingCable {
  id: string
  start_port_id: string
  end_port_id: string
  cable_type: 'power' | 'usb' | 'network' | 'hdmi'
  thickness: 'thick' | 'thin'
  length_m: number | null
  diameter_m: number
  min_bend_radius_m: number
  slack_m: number
  mode: 'slot' | 'backboard'
  baseline_path_points?: Vec3[]
}

export interface PackingScene {
  schema_version: '1.0'
  scene_id: string
  scene_revision: number
  baseline_id: string | null
  template_id: string
  desk: { width_m: number; depth_m: number; top_height_m: number }
  wall: { z_m: number; bounds_xy_m: [number, number, number, number] }
  items: PackingItem[]
  regions: PackingRegion[]
  obstacles: SceneBox[]
  reserved_zones: SceneBox[]
  exposure_zones: SceneBox[]
  routing_graph: RoutingGraph
  cables: RoutingCable[]
  constraints?: { min_item_gap_m: number }
}

export function toPackingPosition(position: Vec3, room: RoomConfig): Vec3 {
  return [position[0] + (hasFixedFurniture(room) ? .45 : room.desk.width / 2), position[1], position[2] - (hasFixedFurniture(room) ? .042 : DESK_GAP)]
}

export function fromPackingPosition(position: Vec3, room: RoomConfig): Vec3 {
  return [position[0] - (hasFixedFurniture(room) ? .45 : room.desk.width / 2), position[1], position[2] + (hasFixedFurniture(room) ? .042 : DESK_GAP)]
}

function category(object: SceneObject): string {
  if (object.powerStrip || object.model.shape === 'powerStrip') return 'power_strip'
  return object.model.shape ?? object.category
}

function packingHoleZones(room: RoomConfig): SceneBox[] {
  try {
    return organizationReservedZones(room).map((zone) => ({ id: zone.id, min: toPackingPosition(zone.min, room), max: toPackingPosition(zone.max, room) }))
  } catch (error) { throw new ApiError(error instanceof Error ? error.message : '出线孔配置无效', { kind: 'input' }) }
}

/** Product coordinates and local collision/port geometry share one translation. */
export function toPackingScene(input: {
  projectId: string; objects: SceneObject[]; room: RoomConfig; preferences: OrganizationPreferences
  confirmed: boolean; ref?: OrganizationSceneRef | null
}): PackingScene {
  const { room, preferences } = input
  const reservedZones = packingHoleZones(room)
  const zones = computeOrganizationZones(room, preferences)
  const workstation = zones.workstation
  const solids = roomSolids(room)
  const regions: PackingRegion[] = []
  const addRegion = (id: string, rect: ZoneRect, y: number, clearance: number) => {
    if (rect.x1 <= rect.x0 || rect.z1 <= rect.z0 || clearance <= 0) return
    const a = toPackingPosition([rect.x0, y, rect.z0], room)
    const b = toPackingPosition([rect.x1, y, rect.z1], room)
    regions.push({ id, surface_y_m: y, bounds_xz_m: [a[0], b[0], a[2], b[2]], clearance_height_m: clearance })
  }
  // Support regions describe existing planes, even when a storage goal excludes them.
  const ceiling = hasFixedFurniture(room) ? 1.88 : BED_UNDERSIDE_Y
  if (hasFixedFurniture(room)) furnitureSurfaces(room).forEach((s) => addRegion(s.id, s.rect, s.y, s.clearance))
  else addRegion('support-desk', { x0: -room.desk.width / 2, x1: room.desk.width / 2, z0: DESK_GAP, z1: DESK_GAP + room.desk.depth }, room.desk.height, ceiling - room.desk.height)
  addRegion('support-floor', { x0: -room.length / 2, x1: room.length / 2, z0: 0, z1: room.width }, 0, room.height)
  for (const solid of solids.filter((s) => s.kind === 'shelfBoard' || s.kind === 'beam')) {
    addRegion(solid.kind === 'beam' ? 'support-beam' : 'support-shelf', {
      x0: solid.min[0], x1: solid.max[0], z0: solid.min[2], z1: solid.max[2],
    }, solid.max[1], solid.kind === 'beam' ? room.desk.height - room.desk.thickness - solid.max[1] : BED_UNDERSIDE_Y - solid.max[1])
  }
  if (workstation) {
    // The adjoining coplanar desk boards support items across their seam.
    addRegion('support-desk-joined', { x0: -.45, x1: 1, z0: .085, z1: .61 }, room.desk.height, ceiling - room.desk.height)
    for (const name of ['laptop', 'keyboard', 'mouse', 'miscellaneous'] as const) {
      const area = workstation[name]
      addRegion(name, area.rect, area.y, ceiling - area.y)
    }
  } else {
    addRegion('typing', zones.typing.rect, zones.typing.y, ceiling - zones.typing.y)
    addRegion('cup', zones.cup.rect, zones.cup.y, ceiling - zones.cup.y)
  }
  const exclusions = workstation ? [workstation.monitor, workstation.laptop, workstation.keyboard, workstation.mouse, workstation.miscellaneous, workstation.operation] : [zones.typing, zones.cup]
  const safe = exclusions.reduce((areas, cut) => areas.flatMap((r) => subtractRect(r, cut.rect, hasFixedFurniture(room))), (zones.deskSurfaces ?? [zones.deskSurface]).map((s) => s.rect))
  safe.forEach((r, i) => addRegion(`desk-clear-${i}`, r, room.desk.height, ceiling - room.desk.height))
  addRegion('under-desk', zones.underDesk.rect, 0, zones.underDesk.clearance)
  const ids = (prefix: string) => regions.filter((r) => r.id.startsWith(prefix)).map((r) => r.id)
  const studyId = workstation?.study.id
  const shelfIds = ids('support-shelf').filter((id) => id !== studyId)
  const storageIds = [...shelfIds, ...ids('support-drawer'), ...ids('support-cabinet')]
  const clearIds = ids('desk-clear-')
  printerSideRegions(zones, input.objects.filter((o) => o.model.shape === 'monitor')).forEach((side, index) => {
    addRegion(`printer-side-${index}`, side.rect, side.y, ceiling - side.y)
  })
  const printerIds = ids('printer-side-')
  for (const object of input.objects.filter((o) => o.model.shape === 'monitor')) {
    const view = monitorViewRegion(object, zones)
    if (view) addRegion(`monitor-view-${object.id}`, view.rect, view.y, ceiling - view.y)
  }
  if (workstation) {
    for (const pad of input.objects.filter((o) => o.visible && o.model.prefabId === 'mousepad')) {
      const issue = desktopPlacementIssue(pad, room, input.objects)
      if (issue) throw new ApiError(issue, { kind: 'input' })
    }
    for (const mouse of input.objects.filter((o) => o.visible && o.model.prefabId === 'mouse')) {
      const pad = mouseSupportPad(mouse, input.objects)
      if (!pad) continue
      const b = worldCollision(pad).bounds
      addRegion(`mouse-on-${pad.id}`, { x0: b.min[0], x1: b.max[0], z0: b.min[2], z1: b.max[2] }, b.max[1], ceiling - b.max[1])
    }
    const keyboard = input.objects.find((o) => o.model.prefabId === 'keyboard')
    if (keyboard) {
      const range = desktopMovementRange(keyboard, room, input.objects)!
      const local = worldCollision({ ...keyboard, transform: { position: [0, 0, 0], rotationY: 0 } }).bounds
      const region = regions.find((r) => r.id === 'keyboard')!
      region.bounds_xz_m[0] = toPackingPosition([range.x0 + local.min[0] - 1e-7, 0, 0], room)[0]
      region.bounds_xz_m[1] = toPackingPosition([range.x1 + local.max[0] + 1e-7, 0, 0], room)[0]
    }
  }
  const items = input.objects.map((object): PackingItem => {
    const shape = object.model.shape
    if (workstation && object.model.prefabId === 'mousepad') {
      const area = workstation.mouse.rect
      const width = area.x1 - area.x0, depth = area.z1 - area.z0
      const fits = [0, Math.PI / 2].some((rotationY) => {
        const bounds = worldCollision({ ...object, transform: { position: [0, 0, 0], rotationY } }).bounds
        return bounds.max[0] - bounds.min[0] <= width + 1e-7 && bounds.max[2] - bounds.min[2] <= depth + 1e-7
      })
      if (!fits) throw new ApiError(`${object.name}超出鼠标区 ${Math.round(width * 100)}×${Math.round(depth * 100)} cm；请核对实际尺寸，若尺寸正确，当前分区无法容纳该鼠标垫`, { kind: 'input' })
    }
    let allowed: string[]
    let preferred: string[] = []
    if (workstation && (shape === 'keyboard' || shape === 'mouse' || object.model.prefabId === 'mousepad')) allowed = [shape === 'keyboard' ? 'keyboard' : 'mouse']
    else if (workstation && isDailyMiscellaneous(object)) allowed = ['miscellaneous']
    else if (workstation && isStudyItem(object)) {
      allowed = object.model.prefabId ? [studyId!] : [studyId!, ...shelfIds]
      preferred = [studyId!]
    }
    else if (shape === 'keyboard' || shape === 'mouse') allowed = ['typing']
    else if (shape === 'cup' || shape === 'thermos') allowed = ['cup', ...clearIds]
    else if (shape === 'monitor') {
      const viewId = `monitor-view-${object.id}`
      if (workstation && !regions.some((r) => r.id === viewId) && !object.fixed && !object.locked) throw new ApiError(`${object.name}：显示器尺寸超出长槽正中主视区，请核对尺寸`, { kind: 'input' })
      allowed = workstation ? [viewId] : [viewId, ...clearIds]
      preferred = [viewId]
    } else if (shape === 'printer') {
      if (!printerIds.length && !object.fixed && !object.locked) throw new ApiError(`${object.name}：桌面没有可用的侧部设备区，请调整键鼠区或显示器位置`, { kind: 'input' })
      allowed = printerIds
    }
    else if (workstation && shape === 'laptop') allowed = ['laptop']
    else if (shape === 'laptop' || shape === 'lamp' || shape === 'powerAdapter') allowed = clearIds
    else if (object.powerStrip || shape === 'powerStrip') {
      allowed = [...(hasFixedFurniture(room) ? [] : ['support-beam']), ...clearIds]
      preferred = hasFixedFurniture(room) ? clearIds : ['support-beam']
    } else if (shape === 'computerTower') {
      allowed = ['under-desk', ...clearIds]
      preferred = ['under-desk']
    } else if (shape === 'book' || shape === 'books') {
      allowed = [...shelfIds, ...clearIds]
      preferred = preferences.preferredStorageZone === 'desk' || object.frequent ? clearIds : shelfIds
    } else if (object.category === 'storage' || shape === 'storageBox') {
      allowed = [...storageIds, ...clearIds, ...(allowsFloorPlacement(object, preferences) ? ['under-desk'] : [])]
      preferred = object.frequent || preferences.preferredStorageZone === 'desk' ? clearIds
        : preferences.preferredStorageZone === 'underDesk' && allowsFloorPlacement(object, preferences) ? ['under-desk'] : storageIds
    } else allowed = [...clearIds, ...(!object.frequent ? storageIds : [])]
    const mounted = object.powerStrip?.mount === 'backboard'
    const pad = workstation ? mouseSupportPad(object, input.objects) : undefined
    if (pad) allowed = [`mouse-on-${pad.id}`]
    if (mounted) { allowed = []; preferred = [] }
    const allowedRegions = allowed.filter((id) => regions.some((r) => r.id === id))
    const source = object.recognition?.dimensionSource === 'user' || object.source === 'manual'
      ? 'user' : object.source === 'demo' ? 'template' : 'estimated'
    const ports = object.ports.filter((p) => p.type !== 'audio' && p.type !== 'wireless').map((p) => ({
      id: p.id,
      type: p.type === 'power-ac' || p.type === 'dc' ? (p.powered && !object.powerStrip ? 'power_sink' : 'power_source')
        : p.type === 'hdmi' ? 'hdmi' : p.type === 'rj45' ? 'network' : 'usb',
      local_position: resolvePortOffset(object, p), local_direction: resolvePortLocalDirection(p), capacity: 1, confirmed: false,
    }))
    // The strip bus is a sink; all sockets are sources regardless of display powered flags.
    if (object.powerStrip) {
      ports.forEach((p) => { p.type = /bus|input|inlet/.test(p.id) ? 'power_sink' : 'power_source' })
      // The product has socket ports only. This unconfirmed inlet is never used for routing.
      if (!ports.some((p) => p.type === 'power_sink')) ports.push({ id: `${object.id}:bus-input`, type: 'power_sink', local_position: mounted ? [object.dimensions.width / 2, object.dimensions.height / 2, 0] : [0, object.dimensions.height / 2, -object.dimensions.depth / 2], local_direction: mounted ? [1, 0, 0] : [0, 0, -1], capacity: 1, confirmed: false })
    }
    return {
      id: object.id, name: object.name, category: category(object),
      size_m: [object.dimensions.width, object.dimensions.height, object.dimensions.depth],
      position: toPackingPosition(object.transform.position, room), rotation_y_rad: object.transform.rotationY,
      dimensions_source: source, dimensions_confirmed: input.confirmed,
      fixed: mounted || object.fixed || object.locked || !!(workstation && object.model.prefabId === 'mousepad'), usage_frequency: object.frequent ? 'high' : 'medium',
      placement_priority: shape === 'monitor' ? 100 : workstation && shape === 'laptop' ? 95 : shape === 'printer' ? 90 : workstation && shape === 'lamp' ? 80 : object.frequent ? 60 : 20,
      allowed_region_ids: allowedRegions, preferred_region_ids: preferred.filter((id) => allowedRegions.includes(id)),
      allowed_rotations_y_rad: workstation && shape === 'laptop' ? [workstation.laptop.rotationY]
        : shape === 'monitor' || shape === 'printer' || desktopBinding(object, room) || (workstation && (shape === 'keyboard' || shape === 'mouse')) ? [0] : [0, Math.PI / 2],
      collision: exportCollision(object), ports, image_url: null, model_url: object.model.assetUrl ? assertAssetUrl(object.model.assetUrl) : null,
      generation: { task_id: null, status: 'not_requested', source: object.model.assetUrl ? object.model.source === 'generated' ? 'live' : 'cache' : 'placeholder', error: null },
      ...(mounted ? { surface_mount: { obstacle_id: 'furniture:Desk_Back_Baffle', face: 'z_max' as const } } : {}),
      ...(object.powerStrip ? { socket_count: object.powerStrip.socketCount } : {}),
    }
  })
  return {
    schema_version: '1.0', scene_id: input.ref?.sceneId ?? input.projectId, scene_revision: input.ref?.sceneRevision ?? 1,
    baseline_id: input.ref?.baselineId ?? null, template_id: room.furnitureModel ?? room.template,
    desk: { width_m: room.desk.width, depth_m: room.desk.depth, top_height_m: room.desk.height },
    wall: { z_m: toPackingPosition([0, 0, 0], room)[2], bounds_xy_m: [toPackingPosition([-room.length / 2, 0, 0], room)[0], toPackingPosition([room.length / 2, 0, 0], room)[0], 0, room.height] },
    items, regions, obstacles: solids.map((s) => ({ id: `furniture:${s.id}`, min: toPackingPosition(s.min, room), max: toPackingPosition(s.max, room) })),
    reserved_zones: reservedZones, exposure_zones: [], routing_graph: { nodes: [], edges: [] }, cables: [],
    constraints: { min_item_gap_m: DEFAULT_MIN_ITEM_GAP_M },
  }
}

export function packingBaseline(baseline: LayoutPlan, input: Parameters<typeof toPackingScene>[0]): PackingScene {
  if (baseline.projectId !== input.projectId || !baseline.scene) throw new ApiError('请重新采集包含完整场景的整理前快照', { kind: 'input' })
  if (hasFixedFurniture(input.room) && !hasFixedFurniture(baseline.scene.room)) throw new ApiError('旧基线使用已停用的桌体，请基于当前固定模型重新采集整理前快照', { kind: 'input' })
  return toPackingScene({ ...input, room: baseline.scene.room, objects: baseline.scene.objects })
}

function fail(message: string): never { throw new ApiError(message, { kind: 'malformed' }) }
function vector(value: unknown): value is Vec3 { return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v)) }
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail('后端布局结果必须为对象')
}
function samePose(position: Vec3, rotation: number, object: SceneObject): boolean {
  return position.every((v, i) => Math.abs(v - object.transform.position[i]) < 1e-7) && Math.abs(rotation - object.transform.rotationY) < 1e-7
}

function sameStructure(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, i) => sameStructure(value, b[i]))
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) || Array.isArray(b)) return false
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && sameStructure(left[key], right[key]))
}

export function canonicalScene(raw: unknown, expected?: PackingScene, expectedRef?: OrganizationSceneRef): PackingScene {
  const scene = record(raw)
  if (scene.schema_version !== '1.0' || typeof scene.scene_id !== 'string' || !scene.scene_id || !Number.isInteger(scene.scene_revision) || Number(scene.scene_revision) < 1 || typeof scene.baseline_id !== 'string' || !scene.baseline_id) fail('后端未返回有效的正式场景标识、版本或原始快照')
  if (!Array.isArray(scene.items) || !Array.isArray(scene.regions) || !Array.isArray(scene.obstacles)) fail('后端正式场景结构不完整')
  if (scene.constraints !== undefined) {
    const constraints = record(scene.constraints)
    if (typeof constraints.min_item_gap_m !== 'number' || !Number.isFinite(constraints.min_item_gap_m) || constraints.min_item_gap_m < 0) fail('后端正式场景的物品最小间距无效')
  }
  if (expectedRef && (scene.scene_id !== expectedRef.sceneId || scene.scene_revision !== expectedRef.sceneRevision || scene.baseline_id !== expectedRef.baselineId)) fail('后端正式场景标识或版本与本次提交不匹配')
  if (expected) {
    for (const key of ['template_id', 'desk', 'wall', 'regions', 'obstacles', 'reserved_zones', 'exposure_zones', 'routing_graph', 'cables', 'constraints'] as const) {
      if (!sameStructure(scene[key], expected[key])) fail('后端正式场景意外修改了提交的支撑区域或碰撞几何')
    }
    const expectedIds = new Set(expected.items.map((i) => i.id))
    for (const rawItem of scene.items) {
      const item = record(rawItem)
      if (typeof item.id !== 'string' || !expectedIds.delete(item.id) || !vector(item.position) || typeof item.rotation_y_rad !== 'number' || !Number.isFinite(item.rotation_y_rad)) fail('后端正式场景物品引用或位姿错误')
      const original = expected.items.find((i) => i.id === item.id)!
      if (!vector(item.size_m) || !item.size_m.every((v, i) => Math.abs(v - original.size_m[i]) < 1e-7) || !item.position.every((v, i) => Math.abs(v - original.position[i]) < 1e-7) || Math.abs(item.rotation_y_rad - original.rotation_y_rad) > 1e-7) fail('后端正式场景意外修改了提交的物品尺寸或位姿')
      for (const key of ['name', 'category', 'fixed', 'dimensions_source', 'dimensions_confirmed', 'collision', 'ports', 'allowed_region_ids', 'preferred_region_ids', 'allowed_rotations_y_rad', 'placement_priority', 'socket_count', 'surface_mount', 'usage_frequency', 'image_url'] as const) {
        if (!sameStructure(item[key], original[key])) fail('后端正式场景意外修改了提交的物品约束')
      }
    }
    if (expectedIds.size) fail('后端正式场景缺少物品')
  }
  return raw as PackingScene
}

export function sceneRef(scene: PackingScene): OrganizationSceneRef {
  return { sceneId: scene.scene_id, sceneRevision: scene.scene_revision, baselineId: scene.baseline_id }
}

export interface PackingMapContext {
  projectId: string; objects: SceneObject[]; room: RoomConfig; preferences: OrganizationPreferences
  scene: PackingScene; jobId: string
}

export function organizationInputSignature(input: { objects: SceneObject[]; room: RoomConfig; preferences: OrganizationPreferences }): string {
  return JSON.stringify(['prefab-rear-passage-v3', input.objects, input.room, input.preferences, { min_item_gap_m: DEFAULT_MIN_ITEM_GAP_M }])
}

export function mapPackingOrganizationResult(raw: unknown, ctx: PackingMapContext): OrganizationPlan {
  const data = record(raw)
  if (data.schema_version !== '1.0' || data.scene_id !== ctx.scene.scene_id || data.scene_revision !== ctx.scene.scene_revision) fail('整理结果与正式场景或版本不匹配，请重新生成')
  if (!['success', 'partial', 'infeasible'].includes(String(data.status))) fail('后端布局状态无效')
  if (!Array.isArray(data.items) || !Array.isArray(data.issues)) fail('后端布局缺少完整物品或问题列表')
  const status = data.status as 'success' | 'partial' | 'infeasible'
  const pending = new Map(ctx.objects.map((o) => [o.id, o]))
  const assignments: PlanAssignment[] = [], unplaced: OrganizationPlan['unplaced'] = []
  const placementWarnings: string[] = []
  const issues: OrganizationIssue[] = data.issues.map((rawIssue) => {
    const issue = record(rawIssue)
    if ((issue.entity_id !== null && typeof issue.entity_id !== 'string') || typeof issue.code !== 'string' || typeof issue.message !== 'string') fail('后端布局问题格式错误')
    return issue as unknown as OrganizationIssue
  })
  const targets: SceneObject[] = []
  for (const rawItem of data.items) {
    const item = record(rawItem)
    const object = typeof item.item_id === 'string' ? pending.get(item.item_id) : undefined
    if (!object) fail('整理结果引用未知或重复物品')
    pending.delete(object.id)
    if (!vector(item.current_pos) || !vector(item.target_pos) || typeof item.target_rotation_y_rad !== 'number' || !Number.isFinite(item.target_rotation_y_rad)) fail(`${object.name}：整理结果位姿无效`)
    const position = fromPackingPosition(item.target_pos, ctx.room)
    const current = fromPackingPosition(item.current_pos, ctx.room)
    if (!current.every((v, i) => Math.abs(v - object.transform.position[i]) < 1e-7)) fail(`${object.name}：结果原始位置与当前场景不同`)
    const rotation = item.target_rotation_y_rad
    const placement = item.placement_status
    if (!['placed', 'unchanged', 'unplaced'].includes(String(placement))) fail(`${object.name}：落位状态无效`)
    if ((object.fixed || object.locked || placement !== 'placed' || status === 'infeasible') && !samePose(position, rotation, object)) fail(`${object.name}：固定、未移动或不可行结果不得修改变换`)
    if (item.target_region_id !== null && (typeof item.target_region_id !== 'string' || !ctx.scene.regions.some((r) => r.id === item.target_region_id))) fail(`${object.name}：目标支撑区域未知`)
    const original = ctx.scene.items.find((i) => i.id === object.id)!
    if (original.fixed && !samePose(position, rotation, object)) fail(`${object.name}：后端修改了本次规划保留的支撑物品`)
    if (placement === 'placed' && (!original.allowed_region_ids.includes(String(item.target_region_id)) || !original.allowed_rotations_y_rad.some((r) => Math.abs(r - rotation) < 1e-7))) fail(`${object.name}：目标区域或朝向不符合输入约束`)
    let reason = issues.filter((i) => i.entity_id === object.id).map((i) => i.message).join('；') || (typeof item.reason === 'string' ? item.reason : typeof item.reason_code === 'string' ? item.reason_code : '后端已复核的目标位置')
    const zone: ZoneKind = String(item.target_region_id).startsWith('mouse-on-') ? 'desk' : /^support-(drawer|cabinet)/.test(String(item.target_region_id)) ? 'shelf' : Math.abs(position[1] - ctx.room.desk.height) < 0.001 ? 'desk' : position[1] > ctx.room.desk.height ? 'shelf' : 'underDesk'
    const target = { ...object, visible: true, transform: { position, rotationY: rotation } }
    if (object.model.shape === 'printer' && !object.fixed && !object.locked) {
      reason = placement === 'unplaced' ? `打印机未找到合法侧部设备位，保留原位；${reason}`
        : status !== 'infeasible' ? `打印机：桌面侧部设备区，避开中央主视位；${reason}` : reason
    }
    if (object.model.shape === 'monitor' && !object.fixed && !object.locked && placement !== 'unplaced' && status !== 'infeasible') {
      const bounds = worldCollision(target).bounds
      const low = toPackingPosition(bounds.min, ctx.room), high = toPackingPosition(bounds.max, ctx.room)
      const forward = Math.abs(Math.sin(rotation)) < 1e-7 && Math.cos(rotation) > 0
      const inView = forward && ctx.scene.regions.some((region) => {
        if (!original.preferred_region_ids.includes(region.id)) return false
        const [x0, x1, z0, z1] = region.bounds_xz_m
        return Math.abs(position[1] - region.surface_y_m) < 1e-7 && low[0] >= x0 - 1e-7 && high[0] <= x1 + 1e-7 && low[2] >= z0 - 1e-7 && high[2] <= z1 + 1e-7
      })
      reason = hasFixedFurniture(ctx.room)
        ? inView ? `显示器：正对后沿出线槽中心并面向用户；${reason}`
          : `显示器未进入指定主视位，请解除固定或调整冲突物品后重新规划；${reason}`
        : inView ? `显示器：中央主视位，与键鼠区对齐并面向用户；${reason}`
          : `显示器：未采用中央主视位，${placement === 'unchanged' ? '保留原位' : '回退至其他可行桌面位置'}，请确认视线和朝向；${reason}`
      if (!inView) placementWarnings.push(`${object.name}：${reason}`)
    }
    targets.push(target)
    if (placement === 'placed') {
      const region = ctx.scene.regions.find((r) => r.id === item.target_region_id)!
      const bounds = worldCollision(target).bounds
      const low = toPackingPosition(bounds.min, ctx.room), high = toPackingPosition(bounds.max, ctx.room)
      const [x0, x1, z0, z1] = region.bounds_xz_m
      if (Math.abs(position[1] - region.surface_y_m) > 1e-7 || low[0] < x0 - 1e-7 || high[0] > x1 + 1e-7 || low[2] < z0 - 1e-7 || high[2] > z1 + 1e-7 || high[1] > region.surface_y_m + region.clearance_height_m + 1e-7) issues.push({ entity_id: object.id, code: 'target_region', message: '真实目标碰撞体未完整落在声明的支撑区域及净高内' })
    }
    if (placement === 'unplaced') unplaced.push({ objectId: object.id, name: object.name, reason })
    assignments.push({ objectId: object.id, position, rotationY: rotation, zone, reason, targetRegionId: item.target_region_id as string | null, placementStatus: placement as 'placed' | 'unchanged' | 'unplaced' })
  }
  if (pending.size) fail('整理结果未覆盖所有输入物品')
  const localIssues: OrganizationIssue[] = targets.flatMap((object) => placementIssues(object, object.transform.position, targets, ctx.room).map((issue) => ({ entity_id: object.id, code: issue.type, message: issue.message })))
  if (hasFixedFurniture(ctx.room)) for (const target of targets) {
    const constrained = ['monitor', 'laptop', 'keyboard', 'mouse'].includes(target.model.shape ?? '')
      || target.model.prefabId === 'mousepad' || isDailyMiscellaneous(target) || isStudyItem(target)
    if (!constrained) continue
    const original = ctx.scene.items.find((item) => item.id === target.id)!
    const bounds = worldCollision(target).bounds
    const low = toPackingPosition(bounds.min, ctx.room), high = toPackingPosition(bounds.max, ctx.room)
    const allowed = original.allowed_rotations_y_rad.some((angle) => Math.abs(angle - target.transform.rotationY) < 1e-7)
      && ctx.scene.regions.some((region) => {
        const [x0, x1, z0, z1] = region.bounds_xz_m
        return original.allowed_region_ids.includes(region.id) && Math.abs(target.transform.position[1] - region.surface_y_m) < 1e-7
          && low[0] >= x0 - 1e-7 && high[0] <= x1 + 1e-7 && low[2] >= z0 - 1e-7 && high[2] <= z1 + 1e-7
      })
    if (!allowed) localIssues.push({ entity_id: target.id, code: 'target_region', message: `${target.name}未进入指定分区或朝向；请核对尺寸、解除固定或移开冲突物品后重试` })
  }
  const reservedZones = ctx.scene.reserved_zones.map((zone) => ({ id: zone.id, label: zone.id === 'packing:operation' ? '手部操作留空区' : zone.id === 'packing:seated' ? '座位活动留空区' : '出线孔上方保留空间',
    min: fromPackingPosition(zone.min, ctx.room), max: fromPackingPosition(zone.max, ctx.room) }))
  const minimumGap = ctx.scene.constraints?.min_item_gap_m ?? 0
  localIssues.push(...organizationClearanceIssues(targets, ctx.room, minimumGap, reservedZones))
  // Detail messages are capped per object, so their count cannot recover pair totals.
  const bodies = targets.map((object) => worldCollision(object))
  let overlapCount = 0
  for (let i = 0; i < bodies.length; i += 1) {
    for (let j = i + 1; j < bodies.length; j += 1) {
      if (collisionsOverlap(bodies[i], bodies[j])) overlapCount += 1
    }
  }
  for (const printer of targets.filter((object) => object.model.shape === 'printer' && !object.fixed && !object.locked && assignments.find((a) => a.objectId === object.id)?.placementStatus !== 'unplaced')) {
    const bounds = worldCollision(printer).bounds
    const sharesViewColumn = !hasFixedFurniture(ctx.room) && targets.filter((object) => object.model.shape === 'monitor').some((monitor) => {
      const screen = worldCollision(monitor).bounds
      return Math.min(bounds.max[0], screen.max[0]) - Math.max(bounds.min[0], screen.min[0]) > 1e-7
    })
    if (sharesViewColumn) localIssues.push({ entity_id: printer.id, code: 'device_access', message: '打印机未位于最终显示器的侧部，需调整设备位置后重新整理' })
  }
  const applicable = status !== 'infeasible' && localIssues.length === 0 && !issues.some((i) => i.code === 'target_region' || i.code === 'item_spacing')
  issues.push(...localIssues)
  if (status === 'success' && unplaced.length > 0) fail('成功布局包含未放置物品')
  const poses = (objects: SceneObject[]) => objects.map((object) => ({ object, position: object.transform.position }))
  const warnings = [...placementWarnings, ...localIssues.map((i) => `${i.entity_id}：${i.message}`)]
  const metrics = data.metrics === undefined ? {} : record(data.metrics)
  const area = (key: string, fallback: number): number | null => {
    if (metrics[key] === undefined) return fallback
    if (metrics[key] === null) return null
    if (typeof metrics[key] !== 'number' || !Number.isFinite(metrics[key]) || metrics[key] < 0) fail('后端面积指标无效')
    return metrics[key]
  }
  return {
    id: uid('plan'), projectId: ctx.projectId, kind: 'algorithm', createdAt: Date.now(), preferences: ctx.preferences,
    assignments, batches: [], unplaced,
    rules: ['后端领域算法生成，完整结果经当前家具、支撑面及物品碰撞复查。'],
    metrics: {
      deskFreeAreaBefore: area('desk_free_before', estimateDeskFreeArea(ctx.room, poses(ctx.objects))), deskFreeAreaAfter: area('desk_free_after', estimateDeskFreeArea(ctx.room, poses(targets))),
      placedCount: assignments.filter((a) => a.placementStatus === 'placed').length, movableCount: ctx.objects.filter((o) => !o.fixed && !o.locked).length,
      unplacedCount: unplaced.length, overlapCount,
      outOfBoundsCount: localIssues.filter((i) => i.code === 'outOfBounds').length,
      method: `完整当前场景复查含固定和残留物品、真实凸体碰撞、家具实体及支撑；${metrics.desk_free_before !== undefined && metrics.desk_free_after !== undefined ? '面积来自后端连续可用面积计算，null表示未知。' : '缺失的面积由真实足迹本地估算。'}`,
    },
    summary: `真实后端布局算法（${status}）：归位 ${assignments.filter((a) => a.placementStatus === 'placed').length} 件、未放置 ${unplaced.length} 件${applicable ? '' : '；此结果不可应用'}`,
    serviceMeta: { source: 'real', status, ...sceneRef(ctx.scene), jobId: ctx.jobId, applicable, issues, inputSignature: organizationInputSignature(ctx), algorithmVersion: typeof data.algorithm_version === 'string' ? data.algorithm_version : undefined, warnings: warnings.length ? warnings : undefined },
  }
}
