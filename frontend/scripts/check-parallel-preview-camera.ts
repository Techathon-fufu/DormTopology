import assert from 'node:assert/strict'
import { createStandardRoom } from '../src/data/demoProject'
import type { RoomConfig, Vec3 } from '../src/types/project'
import {
  clampPreviewCameraPosition,
  createPreviewCameraBounds,
  PREVIEW_CAMERA_FOV,
  previewAzimuthRange,
  previewCameraPlacement,
  previewCameraViolations,
  previewFitDistance,
  previewFrameCoverage,
  previewKeepOutRadius,
  type PreviewCameraBounds,
} from '../src/scene/previewCameraBounds'

/**
 * Constraint regression for the isolated space-configuration preview camera.
 * Pure math: no WebGL, no browser. Run through esbuild + node (see HANDOFF).
 */

const DEG = Math.PI / 180
const ASPECTS = [0.9, 1.2, 1.6]
const DIRECTIONS: Array<[string, Vec3]> = [
  ['persp', [0.05 - 0.07, 1.45 - 0.96, 2.8 - 0.35]],
  ['front', [0, 1.05 - 0.95, 3.0 - 0.4]],
  ['top', [0, 2.7 - 0.75, 0.46 - 0.45]],
  ['left', [-1.05 - 0.55, 1.35 - 0.6, 1.95 - 0.7]],
  ['right', [2.6, 1.3 - 0.9, 0.7 - 0.45]],
  ['desk', [0.75, 1.9 - 0.85, 2.0 - 0.45]],
]

const parametricRoom = (): RoomConfig => ({
  template: 'custom',
  length: 2.4,
  width: 1.8,
  height: 2.6,
  desk: { width: 1.2, depth: 0.6, thickness: 0.025, height: 0.75 },
  shelf: { enabled: true, levels: 2, heightAboveDesk: 0.5, depth: 0.22 },
  posts: [
    { id: 'post-1', position: [-0.95, 0, 0.02], section: 0.06 },
    { id: 'post-2', position: [0.95, 0, 0.02], section: 0.06 },
    { id: 'post-3', position: [-0.95, 0, 0.88], section: 0.06 },
    { id: 'post-4', position: [0.95, 0, 0.88], section: 0.06 },
  ],
  cableHoles: [{ id: 'hole-1', position: [0.3, 0.75, 0.3], diameter: 0.05 }],
  outlets: [{ id: 'outlet-1', position: [0, 0.35, 0.01], label: 'wall outlet', slots: 2 }],
})

const report: Record<string, unknown>[] = []

function assertPlacement(bounds: PreviewCameraBounds, direction: Vec3, aspect: number, label: string) {
  const viewport = { aspect, fovDeg: PREVIEW_CAMERA_FOV }
  const placement = previewCameraPlacement(bounds, direction, viewport)
  const violations = previewCameraViolations(placement.position, bounds)
  assert.deepEqual(violations, [], `${label}: placement must satisfy every constraint`)
  const coverage = previewFrameCoverage(bounds, placement.position, viewport)
  assert.ok(coverage.complete, `${label}: furniture overview must stay in frame (${JSON.stringify(coverage)})`)
  assert.ok(coverage.maxNdcX <= 1 && coverage.maxNdcY <= 1, `${label}: no furniture corner may leave the canvas`)
  assert.ok(placement.distance >= bounds.minDistance - 1e-6, `${label}: distance above the lower bound`)
  assert.ok(placement.distance <= bounds.maxDistance + 1e-6, `${label}: distance below the upper bound`)
  return { placement, coverage }
}

for (const [roomLabel, room] of [['fixed-dormdesk', createStandardRoom()], ['parametric', parametricRoom()]] as const) {
  const bounds = createPreviewCameraBounds(room, { fovDeg: PREVIEW_CAMERA_FOV })

  // Room-derived limits: back wall at z = 0, left wall at x = -L/2, floor at y = 0.
  assert.ok(bounds.wallZ > 0 && bounds.wallZ < 0.3, `${roomLabel}: back-wall clearance`)
  assert.ok(Math.abs(bounds.wallX - (-room.length / 2 + bounds.clearance)) < 1e-6, `${roomLabel}: left-wall clearance`)
  assert.ok(Math.abs(bounds.floorY - bounds.clearance) < 1e-6, `${roomLabel}: floor clearance`)
  assert.ok(bounds.keepOut.length > 0, `${roomLabel}: furniture volumes are known`)

  // The orbit target sits in free space (it is the pivot of every allowed view).
  bounds.keepOut.forEach((_, index) => {
    assert.ok(
      !previewCameraViolations(bounds.target, bounds).includes(`inside-furniture:${index}`),
      `${roomLabel}: orbit target is not buried inside furniture volume ${index}`,
    )
  })

  const presets: Record<string, unknown> = {}
  for (const aspect of ASPECTS) {
    for (const [name, direction] of DIRECTIONS) {
      assertPlacement(bounds, direction, aspect, `${roomLabel}/${name}/aspect-${aspect}`)
    }
    const persp = assertPlacement(bounds, DIRECTIONS[0][1], aspect, `${roomLabel}/persp/record`)
    presets[`aspect-${aspect}`] = {
      distance: persp.placement.distance,
      position: persp.placement.position.map((value) => +value.toFixed(3)),
      coverage: persp.coverage,
    }
  }

  // Continuous horizontal orbit: user drags through the whole allowed range at several radii.
  let orbitSamples = 0
  let rawViolations = 0
  for (const aspect of ASPECTS) {
    const viewport = { aspect, fovDeg: PREVIEW_CAMERA_FOV }
    for (const polarStep of [0, 0.25, 0.5, 0.75, 1]) {
      const polar = bounds.minPolarAngle + (bounds.maxPolarAngle - bounds.minPolarAngle) * polarStep
      const base = previewCameraPlacement(bounds, DIRECTIONS[0][1], viewport)
      const radius = base.distance
      const range = previewAzimuthRange(bounds, polar, radius)
      const horizontal = Math.abs(radius * Math.sin(polar))

      // Raw (unconstrained) azimuth full circle would put the camera behind a wall: the
      // limits have to be derived from the real wall planes, not from a single fixed angle.
      for (let step = 0; step < 72; step += 1) {
        const raw = polar
        const theta = -Math.PI + (step / 72) * Math.PI * 2
        const position: Vec3 = [
          bounds.target[0] + horizontal * Math.sin(theta),
          bounds.target[1] + radius * Math.cos(raw),
          bounds.target[2] + horizontal * Math.cos(theta),
        ]
        if (previewCameraViolations(position, bounds).length > 0) rawViolations += 1

        const thetaClamped = Math.min(range.max, Math.max(range.min, theta))
        const constrained: Vec3 = [
          bounds.target[0] + horizontal * Math.sin(thetaClamped),
          bounds.target[1] + radius * Math.cos(raw),
          bounds.target[2] + horizontal * Math.cos(thetaClamped),
        ]
        const clamped = clampPreviewCameraPosition(constrained, bounds, { minDistance: bounds.minDistance })
        assert.deepEqual(previewCameraViolations(clamped, bounds), [], `${roomLabel}: orbit at polar ${polar.toFixed(2)} must stay legal`)
        orbitSamples += 1
      }
      assert.ok(range.min <= range.max, `${roomLabel}: azimuth range is well formed`)
      // The back-wall limit must actually bind: the camera can never reach the half space behind z = 0.
      const far = Math.max(Math.abs(range.min), Math.abs(range.max))
      assert.ok(far < Math.PI - 1e-6, `${roomLabel}: horizontal orbit stays in the open side of the room`)
    }
  }
  assert.ok(rawViolations > 0, `${roomLabel}: the unconstrained orbit really does leave the room (negative control)`)

  // Zoom sweep, including depths that would otherwise bury the camera in the desk or under the floor.
  let zoomSamples = 0
  for (const [name, direction] of DIRECTIONS) {
    for (const distance of [0.1, 0.4, 0.9, 1.6, 3, 6, 12]) {
      const unit = direction.map((value) => value) as Vec3
      const length = Math.hypot(unit[0], unit[1], unit[2])
      const target: Vec3 = [
        bounds.target[0] + (unit[0] / length) * distance,
        bounds.target[1] + (unit[1] / length) * distance,
        bounds.target[2] + (unit[2] / length) * distance,
      ]
      const clamped = clampPreviewCameraPosition(target, bounds)
      assert.deepEqual(previewCameraViolations(clamped, bounds), [], `${roomLabel}/${name}: zoom ${distance}m must stay legal`)
      const finalRadius = Math.hypot(
        clamped[0] - bounds.target[0],
        clamped[1] - bounds.target[1],
        clamped[2] - bounds.target[2],
      )
      assert.ok(finalRadius <= bounds.maxDistance + 1e-6, `${roomLabel}/${name}: zoom-out stays within the distance cap`)
      zoomSamples += 1
    }
  }

  // Zoom-in must land exactly on the configured minimum distance when the wall net does not
  // interfere (front view); wall confinement may legitimately shorten the offset elsewhere.
  {
    const heading = DIRECTIONS[0][1]
    const length = Math.hypot(heading[0], heading[1], heading[2])
    const near: Vec3 = [
      bounds.target[0] + (heading[0] / length) * 0.2,
      bounds.target[1] + (heading[1] / length) * 0.2,
      bounds.target[2] + (heading[2] / length) * 0.2,
    ]
    const clamped = clampPreviewCameraPosition(near, bounds)
    const radius = Math.hypot(
      clamped[0] - bounds.target[0],
      clamped[1] - bounds.target[1],
      clamped[2] - bounds.target[2],
    )
    assert.ok(Math.abs(radius - Math.max(bounds.minDistance, previewKeepOutRadius(bounds, heading))) < 1e-6,
      `${roomLabel}: zoom-in stops at max(minDistance, furniture exit)`)
    assert.deepEqual(previewCameraViolations(clamped, bounds), [], `${roomLabel}: zoom-in stays legal`)
  }

  // Adversarial starting points: behind the back wall, behind the left wall, under the floor, inside the wardrobe.
  const adversarial: Array<[string, Vec3]> = [
    ['behind-back-wall', [0, 1.2, -1.5]],
    ['behind-left-wall', [-3.5, 1.2, 1]],
    ['under-floor', [0.2, -0.8, 1.1]],
    ['inside-wardrobe', [-0.7, 1.1, 0.3]],
    ['above-ceiling', [0, 6, 0.6]],
  ]
  for (const [name, position] of adversarial) {
    const clamped = clampPreviewCameraPosition(position, bounds)
    assert.deepEqual(previewCameraViolations(clamped, bounds), [], `${roomLabel}/${name}: clamped back into the legal region`)
  }

  // Negative control: the violation detector is not vacuous.
  assert.ok(previewCameraViolations([0, 1.2, -1.5], bounds).includes('behind-back-wall'))
  assert.ok(previewCameraViolations([-3.5, 1.2, 1], bounds).includes('behind-left-wall'))
  assert.ok(previewCameraViolations([0.2, -0.8, 1.1], bounds).includes('under-floor'))

  report.push({
    room: roomLabel,
    target: bounds.target,
    walls: { x: +bounds.wallX.toFixed(3), z: +bounds.wallZ.toFixed(3), floorY: bounds.floorY },
    keepOutVolumes: bounds.keepOut.length,
    fitDistancePersp: +previewFitDistance(bounds, DIRECTIONS[0][1], { aspect: 1.2, fovDeg: PREVIEW_CAMERA_FOV }).toFixed(3),
    presets,
    orbitSamples,
    zoomSamples,
    rawOrbitViolations: rawViolations,
  })
}

console.log(JSON.stringify(report, null, 2))
