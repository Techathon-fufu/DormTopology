import type { RoomConfig, Vec3 } from '@/types/project'
import { fixedFurnitureBoxes, hasFixedFurniture } from './fixedFurniture'
import { DESK_GAP } from './sceneValidation'

/**
 * 空间配置预览的相机约束模型（独立于工作台 / 独立物品查看 / 最终页视角）。
 *
 * 房间只有「后墙 z≈0 + 左墙 x≈-L/2 + 地面 y=0」三面实体，正前方 / 右侧 / 顶部是开口。
 * 预览相机的硬约束全部来自这些真实边界与家具体积，而不是隐藏墙面：
 * - 位置：始终在墙内侧（z ≥ wallZ、x ≥ wallX）并高于地面（y ≥ floorY）；
 * - 体积：不进入任何家具实体（keepOut 已按 clearance 外扩）；
 * - 角度：水平角由墙内侧半空间按当前半径反解，垂直角限制在「适度俯看 ⋯ 接近水平」；
 * - 距离：下限由家具实体沿当前方向反解，上限由家具总览的取景距离给出。
 *
 * 纯函数、无 three.js 依赖，可由 node 脚本直接回归（见 scripts/check-parallel-preview-camera.ts）。
 */

export interface CameraAabb {
  min: Vec3
  max: Vec3
}

export interface PreviewCameraBounds {
  /** 轨道中心（米）：家具包围盒中心，固定不平移。 */
  target: Vec3
  /** 左墙内侧允许的最左 x（已含净距，米）。 */
  wallX: number
  /** 后墙内侧允许的最小 z（已含净距，米）。 */
  wallZ: number
  /** 地面以上允许的最低 y（已含净距，米）。 */
  floorY: number
  /** 相机不可进入的家具实体（已按 clearance 外扩）。 */
  keepOut: CameraAabb[]
  /** 取景完整性判定使用的家具包围盒角点。 */
  contentCorners: Vec3[]
  minDistance: number
  maxDistance: number
  minPolarAngle: number
  maxPolarAngle: number
  /** 预览画布的垂直视场角（度），与 Canvas 的 camera.fov 一致。 */
  fovDeg: number
  /** 相机与墙面 / 家具表面保留的净距（米）。 */
  clearance: number
}

/** 取景计算所需的画布信息。 */
export interface PreviewViewport {
  aspect: number
  fovDeg: number
}

/** 预设方向解算结果：位置在约束内，且家具总览落在视野内。 */
export interface PreviewCameraPlacement {
  position: Vec3
  distance: number
  azimuth: number
  polar: number
}

/** 取景覆盖度：家具包围盒各角点在裁剪空间中的投影范围。 */
export interface PreviewFrameCoverage {
  corners: number
  cornersInFrame: number
  maxNdcX: number
  maxNdcY: number
  complete: boolean
}

/** 相机与墙面 / 家具的最小净距（米）。 */
export const PREVIEW_CAMERA_CLEARANCE = 0.18
/** 最近观察距离的绝对下限（米）。 */
export const PREVIEW_MIN_DISTANCE = 0.9
/** 最近观察距离随家具尺寸缩放的比例（家具包围盒对角线 × 该系数）。 */
const MIN_DISTANCE_RATIO = 0.55
/** 垂直角下限（弧度，约 8°）：避免正俯视的万向锁死点。 */
export const PREVIEW_MIN_POLAR = 0.14
/** 垂直角上限（弧度，约 85°）：不会再低到穿地或贴地平视。 */
export const PREVIEW_MAX_POLAR = 1.48
/** 预览画布垂直视场角（度）。 */
export const PREVIEW_CAMERA_FOV = 42
/** 水平角舒适上限（弧度，约 80°）：墙内侧允许更多，但掠射贴墙的视角没有观察价值。 */
const PREVIEW_AZIMUTH_COMFORT = 1.396
/** Zoom-out 取景余量：允许略微拉远，但不再给无限远。 */
const FIT_SLACK = 1.15

const DEG = Math.PI / 180
const EPSILON = 1e-6

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number) => Math.round(value * 1e6) / 1e6
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const length = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const normalize = (a: Vec3): Vec3 => {
  const l = length(a)
  return l < EPSILON ? [0, 0, 1] : [a[0] / l, a[1] / l, a[2] / l]
}

/** 球坐标 → 单位方向（与 three.js Spherical 一致：polar 相对 +Y，azimuth 由 +Z 转向 +X）。 */
const sphericalDirection = (polar: number, azimuth: number): Vec3 => [
  Math.sin(polar) * Math.sin(azimuth),
  Math.cos(polar),
  Math.sin(polar) * Math.cos(azimuth),
]

const expandBox = (box: CameraAabb, margin: number): CameraAabb => ({
  min: [box.min[0] - margin, box.min[1] - margin, box.min[2] - margin],
  max: [box.max[0] + margin, box.max[1] + margin, box.max[2] + margin],
})

const unionOf = (boxes: CameraAabb[]): CameraAabb =>
  boxes.reduce<CameraAabb>(
    (acc, box) => ({
      min: [Math.min(acc.min[0], box.min[0]), Math.min(acc.min[1], box.min[1]), Math.min(acc.min[2], box.min[2])],
      max: [Math.max(acc.max[0], box.max[0]), Math.max(acc.max[1], box.max[1]), Math.max(acc.max[2], box.max[2])],
    }),
    { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] },
  )

const cornersOf = (box: CameraAabb): Vec3[] => {
  const xs = [box.min[0], box.max[0]]
  const ys = [box.min[1], box.max[1]]
  const zs = [box.min[2], box.max[2]]
  const corners: Vec3[] = []
  for (const x of xs) for (const y of ys) for (const z of zs) corners.push([round(x), round(y), round(z)])
  return corners
}

const insideBox = (point: Vec3, box: CameraAabb) =>
  point[0] > box.min[0] && point[0] < box.max[0] &&
  point[1] > box.min[1] && point[1] < box.max[1] &&
  point[2] > box.min[2] && point[2] < box.max[2]

const insideAnyBox = (point: Vec3, boxes: CameraAabb[]) => boxes.some((box) => insideBox(point, box))

/**
 * 射线与轴对齐盒的「离开」参数：射线穿过盒子时返回离开距离，未穿过返回 null。
 * 起点在盒内时同样返回离开距离（用于家具包围盒内的目标点自恢复）。
 */
export function rayBoxExit(origin: Vec3, direction: Vec3, box: CameraAabb): number | null {
  let enter = -Infinity
  let exit = Infinity
  for (let axis = 0; axis < 3; axis += 1) {
    const d = direction[axis]
    const o = origin[axis]
    if (Math.abs(d) < EPSILON) {
      if (o < box.min[axis] || o > box.max[axis]) return null
      continue
    }
    const t0 = (box.min[axis] - o) / d
    const t1 = (box.max[axis] - o) / d
    enter = Math.max(enter, Math.min(t0, t1))
    exit = Math.min(exit, Math.max(t0, t1))
  }
  if (exit < Math.max(enter, 0)) return null
  return exit
}

/**
 * 固定家具（dormdesk-v1）使用随包碰撞数据的真实包围盒；历史 / 自定义房间按 RoomConfig
 * 复算桌面、书架与床架体积（口径与 RoomShell / ParametricDesk 的简化几何一致）。
 */
function previewFurnitureVolumes(room: RoomConfig): CameraAabb[] {
  if (hasFixedFurniture(room)) {
    return fixedFurnitureBoxes.map((box) => ({
      min: [box.min[0], box.min[1], box.min[2]] as Vec3,
      max: [box.max[0], box.max[1], box.max[2]] as Vec3,
    }))
  }

  const { desk } = room
  const z0 = DESK_GAP
  const z1 = DESK_GAP + desk.depth
  const volumes: CameraAabb[] = [
    { min: [-desk.width / 2, 0, z0], max: [desk.width / 2, desk.height, z1] },
  ]
  if (room.shelf.enabled) {
    const shelfBottom = desk.height + room.shelf.heightAboveDesk
    const shelfTop = shelfBottom + room.shelf.levels * 0.2 + 0.05
    volumes.push({
      min: [-desk.width / 2, shelfBottom, z0],
      max: [desk.width / 2, shelfTop, z0 + room.shelf.depth],
    })
  }

  // 床架跨度与 RoomShell 的立柱自适应口径一致；高度取床板 / 床垫 / 护栏的简化几何范围。
  const postXs = room.posts.map((post) => Math.abs(post.position[0]))
  const postZs = room.posts.map((post) => post.position[2])
  const halfX = postXs.length > 0 ? Math.max(...postXs) : 0.95
  const usePostSpan = postZs.length >= 4 && Math.max(...postZs) - Math.min(...postZs) > 0.4
  const bedZ0 = usePostSpan ? Math.min(...postZs) : 0.02
  const bedZ1 = usePostSpan ? Math.max(...postZs) : 0.88
  volumes.push({ min: [-halfX, 1.55, bedZ0], max: [halfX, 2.02, bedZ1] })

  return volumes
}

/** 轨道中心：家具包围盒中心，垂直 / 进深方向做安全夹取。 */
function previewTarget(room: RoomConfig, envelope: CameraAabb): Vec3 {
  const x = (envelope.min[0] + envelope.max[0]) / 2
  const y = clamp((envelope.min[1] + envelope.max[1]) / 2, 0.75, Math.max(0.75, room.height - 0.75))
  const z = clamp((envelope.min[2] + envelope.max[2]) / 2, 0.25, Math.max(0.25, room.width * 0.6))
  return [round(x), round(y), round(z)]
}

export function createPreviewCameraBounds(
  room: RoomConfig,
  options: { fovDeg?: number } = {},
): PreviewCameraBounds {
  const volumes = previewFurnitureVolumes(room)
  const envelope = unionOf(volumes)
  const keepOut = volumes.map((box) => expandBox(box, PREVIEW_CAMERA_CLEARANCE))
  const diagonal = Math.hypot(room.length, room.width, room.height)
  const envelopeSpan = Math.hypot(
    envelope.max[0] - envelope.min[0],
    envelope.max[1] - envelope.min[1],
    envelope.max[2] - envelope.min[2],
  )
  // 小画布过近会失去空间参照：最近距离随家具体量放大，而不是固定 0.9m。
  const minDistance = round(clamp(envelopeSpan * MIN_DISTANCE_RATIO, PREVIEW_MIN_DISTANCE, 2.4))

  return {
    target: previewTarget(room, envelope),
    wallX: round(-room.length / 2 + PREVIEW_CAMERA_CLEARANCE),
    wallZ: PREVIEW_CAMERA_CLEARANCE,
    floorY: PREVIEW_CAMERA_CLEARANCE,
    keepOut,
    contentCorners: cornersOf(envelope),
    minDistance,
    maxDistance: round(Math.max(minDistance * 2.2, diagonal * 1.6)),
    minPolarAngle: PREVIEW_MIN_POLAR,
    maxPolarAngle: PREVIEW_MAX_POLAR,
    fovDeg: options.fovDeg ?? PREVIEW_CAMERA_FOV,
    clearance: PREVIEW_CAMERA_CLEARANCE,
  }
}

/**
 * 沿给定方向离开家具实体所需的最小半径（米）。
 * 家具包围盒已按 clearance 外扩，因此该半径同时满足「不钻进家具」与净距要求。
 */
export function previewKeepOutRadius(bounds: PreviewCameraBounds, direction: Vec3): number {
  const unit = normalize(direction)
  let radius = 0
  for (const box of bounds.keepOut) {
    const exit = rayBoxExit(bounds.target, unit, box)
    if (exit !== null) radius = Math.max(radius, exit)
  }
  return radius
}

/**
 * 当前半径下允许的水平角范围（弧度）。
 * 由「后墙内侧 z ≥ wallZ」与「左墙内侧 x ≥ wallX」两个半空间反解：
 * cosθ ≥ (wallZ - tz)/rh 与 sinθ ≥ (wallX - tx)/rh，rh 为水平半径。
 */
export function previewAzimuthRange(
  bounds: PreviewCameraBounds,
  polar: number,
  radius: number,
): { min: number; max: number } {
  const horizontal = Math.abs(radius * Math.sin(polar))
  if (horizontal < 1e-4) return { min: -Math.PI, max: Math.PI }

  // 后墙：cosθ ≥ (wallZ - tz)/rh，在 (-π, π] 上等价于 |θ| ≤ acos(...)。
  let min = -Math.PI
  let max = Math.PI
  const backWall = (bounds.wallZ - bounds.target[2]) / horizontal
  if (backWall > -1) {
    const limit = Math.acos(clamp(backWall, -1, 1))
    min = Math.max(min, -limit)
    max = Math.min(max, limit)
  }

  // 左墙：sinθ ≥ (wallX - tx)/rh，在 (-π, π] 上等价于 θ ∈ [asin(...), π - asin(...)]。
  const leftWall = (bounds.wallX - bounds.target[0]) / horizontal
  if (leftWall > -1) {
    const limit = Math.asin(clamp(leftWall, -1, 1))
    min = Math.max(min, limit)
    max = Math.min(max, Math.PI - limit)
  }

  min = Math.max(min, -PREVIEW_AZIMUTH_COMFORT)
  max = Math.min(max, PREVIEW_AZIMUTH_COMFORT)
  if (min > max) {
    const stuck = clamp((min + max) / 2, -PREVIEW_AZIMUTH_COMFORT, PREVIEW_AZIMUTH_COMFORT)
    return { min: stuck, max: stuck }
  }
  return { min, max }
}

/** 相机基向量：forward 指向轨道中心，right / up 为屏幕基（近似 OrbitControls 的 up 约定）。 */
function cameraBasis(direction: Vec3): { forward: Vec3; right: Vec3; up: Vec3 } {
  const forward = scale(normalize(direction), -1)
  const worldUp: Vec3 = Math.abs(forward[1]) > 0.995 ? [0, 0, 1] : [0, 1, 0]
  const right = normalize(cross(forward, worldUp))
  return { forward, right, up: normalize(cross(right, forward)) }
}

/**
 * 家具总览刚好入画所需的相机距离（米）。
 * 对每个内容角点求 d ≥ along + max(|x|/tanH, |y|/tanV)，取最大值后留取景余量。
 */
export function previewFitDistance(
  bounds: PreviewCameraBounds,
  direction: Vec3,
  viewport: PreviewViewport,
  padding = 1.06,
): number {
  const unit = normalize(direction)
  const { right, up } = cameraBasis(unit)
  const tanV = Math.tan((viewport.fovDeg * DEG) / 2)
  const tanH = tanV * Math.max(0.2, viewport.aspect)

  let distance = 0
  for (const corner of bounds.contentCorners) {
    const offset = sub(corner, bounds.target)
    const along = dot(offset, unit)
    const lateral = Math.max(Math.abs(dot(offset, right)) / tanH, Math.abs(dot(offset, up)) / tanV)
    distance = Math.max(distance, along + lateral)
  }
  return distance * padding
}

/** 取景覆盖度：角点是否全部落在画布内（用于「取景仍完整」验收）。 */
export function previewFrameCoverage(
  bounds: PreviewCameraBounds,
  position: Vec3,
  viewport: PreviewViewport,
): PreviewFrameCoverage {
  const direction = normalize(sub(position, bounds.target))
  const { forward, right, up } = cameraBasis(direction)
  const tanV = Math.tan((viewport.fovDeg * DEG) / 2)
  const tanH = tanV * Math.max(0.2, viewport.aspect)

  let cornersInFrame = 0
  let maxNdcX = 0
  let maxNdcY = 0
  for (const corner of bounds.contentCorners) {
    const offset = sub(corner, position)
    const depth = dot(offset, forward)
    if (depth <= EPSILON) continue
    const ndcX = dot(offset, right) / (depth * tanH)
    const ndcY = dot(offset, up) / (depth * tanV)
    maxNdcX = Math.max(maxNdcX, Math.abs(ndcX))
    maxNdcY = Math.max(maxNdcY, Math.abs(ndcY))
    if (Math.abs(ndcX) <= 1 && Math.abs(ndcY) <= 1) cornersInFrame += 1
  }

  return {
    corners: bounds.contentCorners.length,
    cornersInFrame,
    maxNdcX: round(maxNdcX),
    maxNdcY: round(maxNdcY),
    complete: cornersInFrame === bounds.contentCorners.length,
  }
}

/** 墙内侧 / 地面以上的夹取；家具逃逸与距离夹取共用同一套半空间。 */
const confineToRoom = (point: Vec3, bounds: PreviewCameraBounds): Vec3 => [
  Math.max(point[0], bounds.wallX),
  Math.max(point[1], bounds.floorY),
  Math.max(point[2], bounds.wallZ),
]

/**
 * 最后一道家具逃逸：优先一步跳出所有家具（做小的盒面移动），跳不出去时选「剩余包围盒
 * 最少」的盒面，避免相邻家具（衣柜贴床柱）之间来回摆动；被墙挡回的盒面直接跳过。
 */
function escapeFurniture(point: Vec3, bounds: PreviewCameraBounds): Vec3 {
  const step = 1e-3
  const visited = new Set<string>()
  let current = point
  for (let iteration = 0; iteration < 12; iteration += 1) {
    if (!insideAnyBox(current, bounds.keepOut)) return current
    visited.add(current.map((value) => value.toFixed(4)).join(','))

    let best: Vec3 | null = null
    let bestCost = Infinity
    let bestCount = Infinity
    for (const box of bounds.keepOut) {
      if (!insideBox(current, box)) continue
      for (let axis = 0; axis < 3; axis += 1) {
        for (const outward of [-1, 1]) {
          const face = outward < 0 ? box.min[axis] - step : box.max[axis] + step
          const probe: Vec3 = [current[0], current[1], current[2]]
          probe[axis] = face
          const confined = confineToRoom(probe, bounds)
          if (visited.has(confined.map((value) => value.toFixed(4)).join(','))) continue
          const count = bounds.keepOut.filter((candidate) => insideBox(confined, candidate)).length
          const cost = Math.abs(face - current[axis])
          if (count < bestCount || (count === bestCount && cost < bestCost)) {
            bestCount = count
            bestCost = cost
            best = confined
          }
          if (count === 0) return confined
        }
      }
    }
    if (!best) return current
    current = best
  }
  return current
}

/** 兜底机位：沿「正面 → 室内侧」扫几个方向，取第一个完全合法的位置。 */
function safeSeedPosition(bounds: PreviewCameraBounds): Vec3 {
  for (const polar of [1.2, 0.9, 1.45, 0.6]) {
    for (const azimuth of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2]) {
      const direction = sphericalDirection(polar, azimuth)
      const radius = Math.max(bounds.minDistance, previewKeepOutRadius(bounds, direction))
      const point = confineToRoom(add(bounds.target, scale(direction, radius)), bounds)
      if (!insideAnyBox(point, bounds.keepOut)) return point
    }
  }
  return bounds.target
}

/**
 * 硬约束：把相机位置夹进「墙内侧 + 地面以上 + 家具之外 + 距离区间」。
 * 家具逃逸优先沿当前视线方向增加半径（不改变取景中心），只有在家具贴墙的角落才改用
 * 最近可用盒面推出，因此不会把视角甩到另一侧。
 */
export function clampPreviewCameraPosition(
  position: Vec3,
  bounds: PreviewCameraBounds,
  limits: { minDistance?: number; maxDistance?: number } = {},
): Vec3 {
  const minDistance = limits.minDistance ?? bounds.minDistance
  const maxDistance = Math.max(minDistance, limits.maxDistance ?? bounds.maxDistance)
  const direction = normalize(sub(position, bounds.target))
  const radius = clamp(length(sub(position, bounds.target)), minDistance, maxDistance)

  const candidate = confineToRoom(add(bounds.target, scale(direction, radius)), bounds)
  if (!insideAnyBox(candidate, bounds.keepOut)) return candidate

  for (let step = 1; step <= 16; step += 1) {
    const escaped = confineToRoom(add(bounds.target, scale(direction, radius * (1 + step * 0.06))), bounds)
    if (!insideAnyBox(escaped, bounds.keepOut)) return escaped
  }
  const escaped = escapeFurniture(candidate, bounds)
  return insideAnyBox(escaped, bounds.keepOut) ? safeSeedPosition(bounds) : escaped
}

/** 违例清单（空数组 = 位置合法），供脚本 / 浏览器测试断言。 */
export function previewCameraViolations(position: Vec3, bounds: PreviewCameraBounds): string[] {
  const violations: string[] = []
  if (position[2] < bounds.wallZ - EPSILON) violations.push('behind-back-wall')
  if (position[0] < bounds.wallX - EPSILON) violations.push('behind-left-wall')
  if (position[1] < bounds.floorY - EPSILON) violations.push('under-floor')
  bounds.keepOut.forEach((box, index) => {
    if (insideBox(position, box)) violations.push(`inside-furniture:${index}`)
  })
  return violations
}

/**
 * 预设方向 → 合规机位：垂直角夹取 → 水平角按墙内侧范围收敛 → 距离取「家具总览取景」
 * 与「离开家具实体」的较大值，再夹进 [minDistance, maxDistance]。
 */
export function previewCameraPlacement(
  bounds: PreviewCameraBounds,
  direction: Vec3,
  viewport: PreviewViewport,
): PreviewCameraPlacement {
  const unit = normalize(direction)
  const polar = clamp(
    Math.acos(clamp(unit[1], -1, 1)),
    bounds.minPolarAngle,
    bounds.maxPolarAngle,
  )
  const desiredAzimuth = Math.atan2(unit[0], unit[2])

  let azimuth = desiredAzimuth
  let radius = bounds.minDistance
  for (let pass = 0; pass < 3; pass += 1) {
    const range = previewAzimuthRange(bounds, polar, radius)
    azimuth = clamp(desiredAzimuth, range.min, range.max)
    const heading = sphericalDirection(polar, azimuth)
    radius = clamp(
      Math.max(previewFitDistance(bounds, heading, viewport), previewKeepOutRadius(bounds, heading), bounds.minDistance),
      bounds.minDistance,
      bounds.maxDistance,
    )
  }

  const position = clampPreviewCameraPosition(
    add(bounds.target, scale(sphericalDirection(polar, azimuth), radius)),
    bounds,
    { minDistance: bounds.minDistance, maxDistance: bounds.maxDistance },
  )
  return { position, distance: round(radius), azimuth, polar }
}

/** 轨道控件的距离上限：取景距离 + 余量，避免拉远到失去参照。 */
export function previewMaxDistance(
  bounds: PreviewCameraBounds,
  direction: Vec3,
  viewport: PreviewViewport,
): number {
  const fit = previewFitDistance(bounds, direction, viewport)
  return clamp(fit * FIT_SLACK, bounds.minDistance + 0.1, bounds.maxDistance)
}
