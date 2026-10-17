import * as THREE from 'three'
import type { CableConnection, SceneObject, Vec3 } from '@/types/project'
import { cableDisplayPoints, hasUsableCableRoute } from '@/scene/cables'
import { estimateCableLength, sampleCurve } from '@/scene/cableRoute'

/** Index-based sampling preserves every already-validated vertex, including uneven spacing. */
class SampledCableCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private readonly points: Vec3[]) {
    super()
  }

  getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const index = Math.max(0, Math.min(1, t)) * (this.points.length - 1)
    const lo = Math.min(Math.floor(index), this.points.length - 2)
    const a = this.points[lo]
    const b = this.points[lo + 1]
    const alpha = index - lo
    return target.set(a[0] + (b[0] - a[0]) * alpha, a[1] + (b[1] - a[1]) * alpha, a[2] + (b[2] - a[2]) * alpha)
  }

  getPointAt(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    return this.getPoint(u, target)
  }

  getTangentAt(u: number, target = new THREE.Vector3()): THREE.Vector3 {
    const index = Math.min(this.points.length - 2, Math.floor(Math.max(0, Math.min(1, u)) * (this.points.length - 1)))
    for (let offset = 0; offset < this.points.length - 1; offset += 1) {
      const lo = Math.min(this.points.length - 2, index + offset)
      const a = this.points[lo]
      const b = this.points[lo + 1]
      target.set(b[0] - a[0], b[1] - a[1], b[2] - a[2])
      if (target.lengthSq() > 1e-16) return target.normalize()
      const before = Math.max(0, index - offset)
      const c = this.points[before]
      const d = this.points[before + 1]
      target.set(d[0] - c[0], d[1] - c[1], d[2] - c[2])
      if (target.lengthSq() > 1e-16) return target.normalize()
    }
    return target.set(1, 0, 0)
  }
}

export function createCableTube(points: Vec3[], radius: number, radialSegments = 6): THREE.TubeGeometry | null {
  if (points.length < 2 || !Number.isFinite(radius) || radius <= 0 || points.some((p) => p.some((n) => !Number.isFinite(n)))) return null
  return new THREE.TubeGeometry(new SampledCableCurve(points), points.length - 1, radius, Math.max(3, radialSegments), false)
}

export function cablePathSamples(cable: CableConnection, objects: SceneObject[]): Vec3[] {
  const points = cableDisplayPoints(cable, objects, 'suggested')
  return cable.route.smooth === false ? points : sampleCurve(points)
}

/** Unknown/failed paths have no complete length; backend curve integrals take precedence. */
export function cablePathLength(cable: CableConnection, objects: SceneObject[]): number | null {
  if (!hasUsableCableRoute(cable)) return null
  const verifiedLength = cable.route.pathLengthM
  if (cable.route.verification?.status === 'valid' && verifiedLength !== undefined) {
    return Number.isFinite(verifiedLength) && verifiedLength > 0 ? verifiedLength : null
  }
  const length = estimateCableLength(cableDisplayPoints(cable, objects), cable.route.smooth !== false)
  return Number.isFinite(length) && length > 0 ? length : null
}

export function totalCablePathLength(cables: CableConnection[], objects: SceneObject[]): number | null {
  let total = 0
  for (const cable of cables) {
    const length = cablePathLength(cable, objects)
    if (length === null) return null
    total += length
  }
  return total
}
