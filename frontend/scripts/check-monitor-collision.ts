import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { createDemoProject } from '../src/data/demoProject'
import { exportCollision, localCollision, objectsCollide, objectToWorld, segmentHitsObject } from '../src/scene/collisionGeometry'
import { itemSpacingViolations } from '../src/scene/itemSpacing'
import { resizeIssue } from '../src/scene/placementEditing'
import { toPackingScene } from '../src/api/core/packingWire'
import { toRoutingScene } from '../src/api/core/routingWire'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { SceneObject, Vec3 } from '../src/types/project'

const project = createDemoProject()
project.objects = project.objects.map((o) => ({ ...o, ports: o.ports.map((p) => ({ ...p, confirmed: true })) }))
const source = project.objects.find((o) => o.id === 'demo-monitor')!
let cases = 0
for (const scale of [[1, 1, 1], [1.5, .75, 2], [.6, 1.3, .9]]) {
  for (const angle of [0, Math.PI / 9, Math.PI / 6, Math.PI / 2]) {
    const monitor: SceneObject = { ...source, fixed: true,
      dimensions: { width: .6 * scale[0], height: .55 * scale[1], depth: .18 * scale[2] },
      transform: { position: [0, .75, .3], rotationY: angle } }
    assert.equal(localCollision(monitor).parts.length, 8)
    const world = (point: Vec3) => objectToWorld(point.map((v, i) => v * scale[i]) as Vec3, monitor)
    const box: SceneObject = { ...monitor, id: 'probe', ports: [],
      dimensions: { width: .08 * scale[0], height: .08 * scale[1], depth: .08 * scale[2] },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'genericBox' },
      transform: { position: world([.21, 0, 0]), rotationY: angle } }
    assert.equal(objectsCollide(monitor, monitor.transform.position, box, box.transform.position), false,
      'a low item beside the base must fit under the screen, inside the old envelope')
    assert.deepEqual(itemSpacingViolations([monitor, box], .02), [], 'the real parts still leave 20mm')
    for (const point of [[0, 0, 0], [0, .1, -.02], [.2, .3, -.01]] as Vec3[]) {
      assert.equal(objectsCollide(monitor, monitor.transform.position, box, world(point)), true,
        'actual base, stand and screen material must block placement')
    }
    for (const [x, y, hit] of [[.2, .1, false], [0, .1, true], [.2, .4, true]] as const) {
      assert.equal(segmentHitsObject(world([x, y, -.1]), world([x, y, .1]), monitor, .003), hit)
    }
    // The exact scaled compound must reach both APIs, including rounded bevel vertices.
    const modified = { ...project, objects: project.objects.map((o) => o.id === source.id ? monitor : o) }
    const packing = toPackingScene({ projectId: project.id, room: project.room, objects: modified.objects,
      preferences: resolveOrganizationPreferences(project), confirmed: true })
    const routing = toRoutingScene({ project: modified, confirmed: true })
    const expected = exportCollision(monitor)
    assert.deepEqual(packing.items.find((o) => o.id === source.id)!.collision, expected)
    assert.deepEqual(routing.items.find((o) => o.id === source.id)!.collision, expected)
    const validation = spawnSync(process.env.PYTHON ?? 'python3', ['-B', '-c',
      'import json,sys; from backend.app.domain.geometry.convex import validate_compound; validate_compound(json.load(sys.stdin))'],
    { cwd: resolve(process.cwd(), '..'), input: JSON.stringify(expected), encoding: 'utf8' })
    assert.equal(validation.status, 0, validation.stderr)
    cases++
  }
}
// Exercise the actual resize guard with supported objects, not only the SAT helper.
const monitor: SceneObject = { ...source, transform: { position: [0, .75, .3], rotationY: 0 } }
const box: SceneObject = { ...monitor, id: 'resize-neighbor', ports: [],
  dimensions: { width: .08, height: .08, depth: .08 },
  model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'genericBox' },
  transform: { position: [.21, .75, .3], rotationY: 0 } }
assert.equal(resizeIssue(box, { ...box.dimensions, height: .12 }, project.room, [monitor, box]), null)
assert.ok(resizeIssue(box, { ...box.dimensions, width: .24 }, project.room, [monitor, box]))
assert.ok(resizeIssue(box, { ...box.dimensions, height: .3 }, project.room, [monitor, box]))
console.log(`Monitor passed: ${cases} scale/rotation cases, real voids, solids, spacing, rays, API export and resize guards.`)
