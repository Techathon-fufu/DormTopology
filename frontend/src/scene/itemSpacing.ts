import type { SceneObject, Vec3 } from '@/types/project'
import { boundsOf, worldCollision, type Bounds } from './collisionGeometry'

type Point = [number, number]
interface SpacingPart { vertices_m: Vec3[]; bounds?: Bounds }
export interface SpacingCollision { parts: SpacingPart[]; bounds: Bounds }
const SPACING_EPSILON = 1e-10

const cross = (a: Point, b: Point, c: Point) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

function footprint(vertices: Vec3[]): Point[] {
  const points = vertices.map(([x, , z]): Point => [x, z]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .filter((point, i, sorted) => !i || point[0] !== sorted[i - 1][0] || point[1] !== sorted[i - 1][1])
  if (points.length < 3) return points
  const half = (ordered: Point[]) => {
    const hull: Point[] = []
    for (const point of ordered) {
      while (hull.length > 1 && cross(hull[hull.length - 2], hull[hull.length - 1], point) <= 0) hull.pop()
      hull.push(point)
    }
    return hull.slice(0, -1)
  }
  return [...half(points), ...half([...points].reverse())]
}

function pointSegmentDistance(point: Point, start: Point, end: Point): number {
  const dx = end[0] - start[0], dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq ? Math.max(0, Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / lengthSq)) : 0
  return Math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dz)
}

function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b)
  if (((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) && ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

function polygonDistance(a: Point[], b: Point[]): number {
  const contains = (polygon: Point[], point: Point) => polygon.length >= 3 && polygon.every((p, i) => cross(p, polygon[(i + 1) % polygon.length], point) >= 0)
  if (contains(a, b[0]) || contains(b, a[0])) return 0
  let distance = Infinity
  for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
    distance = Math.min(distance, segmentDistance(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length]))
  }
  return distance
}

/** Minimum XZ distance of real convex parts whose vertical ranges overlap. */
export function horizontalItemGap(a: SpacingCollision, b: SpacingCollision): number {
  let distance = Infinity
  for (const pa of a.parts) for (const pb of b.parts) {
    const ba = pa.bounds ?? boundsOf(pa.vertices_m), bb = pb.bounds ?? boundsOf(pb.vertices_m)
    if (Math.min(ba.max[1], bb.max[1]) - Math.max(ba.min[1], bb.min[1]) <= SPACING_EPSILON) continue
    distance = Math.min(distance, polygonDistance(footprint(pa.vertices_m), footprint(pb.vertices_m)))
  }
  return distance
}

export function itemSpacingViolations(objects: SceneObject[], minimumGap: number): Array<{ left: SceneObject; right: SceneObject; distance: number }> {
  if (!Number.isFinite(minimumGap) || minimumGap < 0) throw new Error('Minimum item gap must be finite and nonnegative')
  if (!minimumGap) return []
  const bodies = objects.map((object) => worldCollision(object))
  const violations: Array<{ left: SceneObject; right: SceneObject; distance: number }> = []
  for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
    const a = bodies[i].bounds, b = bodies[j].bounds
    if (Math.min(a.max[1], b.max[1]) - Math.max(a.min[1], b.min[1]) <= SPACING_EPSILON) continue
    const dx = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], 0)
    const dz = Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2], 0)
    if (Math.hypot(dx, dz) >= minimumGap - SPACING_EPSILON) continue
    // Per-part convex projections preserve compound cavities; sloping parts remain conservative.
    const distance = horizontalItemGap(bodies[i], bodies[j])
    if (distance < minimumGap - SPACING_EPSILON) violations.push({ left: objects[i], right: objects[j], distance })
  }
  return violations
}
