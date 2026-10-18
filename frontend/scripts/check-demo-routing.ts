import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { createDemoProject } from '../src/data/demoProject'
import { fromPackingPosition, mapPackingOrganizationResult, toPackingScene } from '../src/api/core/packingWire'
import { mapRoutingResult, toRoutingScene } from '../src/api/core/routingWire'
import { endpointOf, validateCableConnection } from '../src/scene/cables'
import { objectRoomHits, segmentHitsObject } from '../src/scene/collisionGeometry'
import { portWorldDirection } from '../src/scene/ports'
import { computeOrganizationZones } from '../src/scene/organizationZones'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { Project, Vec3 } from '../src/types/project'

function domain(code: string, scene: unknown): any {
  const result = spawnSync(process.env.PYTHON ?? 'python3', ['-B', '-c', `import json,sys; ${code}`], {
    cwd: resolve(process.cwd(), '..'), input: JSON.stringify(scene), encoding: 'utf8', timeout: 120_000,
  })
  assert.equal(result.status, 0, result.stderr || result.error?.message)
  return JSON.parse(result.stdout)
}

// These are the actual visible demo objects and ports; confirmation is the user action only.
const demo = createDemoProject()
demo.objects = demo.objects.map((o) => ({ ...o, ports: o.ports.map((p) => ({ ...p, confirmed: true })) }))
assert.equal(demo.objects.length, 17)
assert.equal(demo.cables.length, 7, 'six device connections plus the adapter AC input; mains is not included')
for (const cable of demo.cables) {
  const check = validateCableConnection(demo, cable.from, cable.to, { excludeCableId: cable.id, kind: cable.kind })
  assert.equal(check.ok, true, `${cable.id}: ${'reason' in check ? check.reason : ''}`)
  for (const endpoint of [cable.from, cable.to]) {
    const object = demo.objects.find((o) => o.id === endpoint.objectId)!
    const port = object.ports.find((p) => p.id === endpoint.portId)!
    const point = endpointOf(object, port).position, direction = portWorldDirection(object, port)
    const inward = point.map((v, i) => v - direction[i] * .005) as Vec3
    assert.ok(segmentHitsObject(point, inward, object), `${port.id}: the connector must lie within 5 mm of its actual primitive surface`)
  }
}
if (process.argv.includes('--ports-only')) {
  console.log('Default demo connections and all connector surface positions passed.')
  process.exit(0)
}
const preferences = resolveOrganizationPreferences(demo)
const input = { projectId: demo.id, objects: demo.objects, room: demo.room, preferences, confirmed: true }
const packingScene = { ...toPackingScene(input), baseline_id: 'demo-routing-regression' }
assert.equal(packingScene.reserved_zones.length, demo.room.cableHoles.length + 2, 'packing protects hole, hands and seated operation zones')
const packing = domain('from backend.app.domain.packing import plan_packing,validate_layout; from backend.examples.packing_demo import preview_scene; s=json.load(sys.stdin); r=plan_packing(s); print(json.dumps({"result":r,"before":validate_layout(s),"after":validate_layout(preview_scene(s,r))}))', packingScene)
assert.equal(packing.result.status, 'success', JSON.stringify(packing.result.issues))
assert.equal(packing.after.geometry_valid, true, JSON.stringify(packing.after))
const organization = mapPackingOrganizationResult(packing.result, { ...input, scene: packingScene, jobId: 'demo-routing-regression' })
assert.equal(organization.serviceMeta?.applicable, true, JSON.stringify(organization.serviceMeta?.issues))
const organized: Project = { ...demo, objects: demo.objects.map((object) => {
  const assignment = organization.assignments.find((a) => a.objectId === object.id)
  assert.ok(assignment, object.id)
  return { ...object, transform: { position: assignment.position, rotationY: assignment.rotationY } }
}) }
const zones = computeOrganizationZones(organized.room, preferences)
const monitor = organized.objects.find((o) => o.id === 'demo-monitor')!
const printer = organized.objects.find((o) => o.id === 'demo-printer')!
assert.ok(Math.abs(monitor.transform.position[0] - zones.workstation!.slotCenterX) < .002)
assert.equal(monitor.transform.rotationY, 0)
assert.equal(printer.transform.rotationY, 0)
assert.ok(printer.transform.position[0] < -.04, 'printer stays on the left, leaving the return for daily items')
assert.equal(organized.objects.find((o) => o.id === 'demo-power-adapter')!.transform.position[1], organized.room.desk.height,
  'the active power adapter stays accessible on the desk rather than in a closed drawer')
assert.ok(organized.objects.filter((o) => o.transform.position[1] === 0).every((o) => o.id === 'demo-computer-tower'))
const holeClearance = packingScene.reserved_zones.map((zone) => ({ id: zone.id, label: 'cable hole clearance',
  min: fromPackingPosition(zone.min, organized.room), max: fromPackingPosition(zone.max, organized.room) }))
assert.ok(organized.objects.every((object) => objectRoomHits(object, object.transform.position, holeClearance).length === 0),
  'all organized real collision parts must leave the cable hole top clearance free')
const originalScene = { ...toRoutingScene({ project: demo, confirmed: true }), baseline_id: packingScene.baseline_id }
const organizedScene = { ...toRoutingScene({ project: organized, confirmed: true }), baseline_id: packingScene.baseline_id }
assert.deepEqual(originalScene.reserved_zones, [], 'layout hole protection must not prohibit cable paths')
assert.ok(organizedScene.items.every((o) => o.ports.every((p) => p.capacity === 1)))
assert.ok(organizedScene.cables.every((c) => c.length_m === null))
assert.ok(organizedScene.cables.every((c) => c.min_bend_radius_m === 0 && c.diameter_m > 0),
  'product routing ignores bend-radius limits while preserving cable volume')
assert.deepEqual(organizedScene.reserved_zones, [], 'layout avoid zones must not prohibit cable paths')
if (process.argv.includes('--export-original')) {
  process.stdout.write(JSON.stringify(originalScene)); process.exit(0)
}
if (process.argv.includes('--export-organized')) {
  process.stdout.write(JSON.stringify(organizedScene)); process.exit(0)
}
const blockedLeadouts: Array<{ cable: string; port: string; blocker: string }> = []
for (const cable of organized.cables) for (const endpoint of [cable.from, cable.to]) {
  const object = organized.objects.find((o) => o.id === endpoint.objectId)!
  const port = object.ports.find((p) => p.id === endpoint.portId)!
  const start = endpointOf(object, port).position, direction = portWorldDirection(object, port)
  const end = start.map((v, i) => v + direction[i] * .025) as Vec3
  for (const other of organized.objects) if (other.id !== object.id && segmentHitsObject(start, end, other, .005)) {
    blockedLeadouts.push({ cable: cable.id, port: port.id, blocker: other.id })
  }
}
const run = (scene: unknown) => domain('from backend.app.domain.routing import plan_routing; print(json.dumps(plan_routing(json.load(sys.stdin))))', scene)
if (process.argv.includes('--write-demo')) {
  const result = run(organizedScene)
  const mapped = mapRoutingResult(result, { scene: organizedScene, project: organized })
  assert.equal(result.status, 'success', JSON.stringify(result.issues))
  assert.equal(mapped.plannedCount, 7)
  assert.equal(organizedScene.routing_graph.path_style, 'orthogonal')
  for (const cable of organized.cables.filter(c => ['power', 'video', 'network'].includes(c.kind))) {
    assert.equal(result.cables.find((c: any) => c.id === cable.id).mode, 'backboard')
  }
  const output = resolve('public/routing-demo/fixed-desk.json')
  mkdirSync(resolve('public/routing-demo'), { recursive: true })
  writeFileSync(output, JSON.stringify({ project: organized, scene: organizedScene, result }, null, 2) + '\n')
  console.log(`Generated ${output}: ${mapped.plannedCount}/7 verified routes on the main desk model.`)
  process.exit(0)
}
const original = run(originalScene)
const routed = run(organizedScene)
const details = (result: any) => ({ status: result.status, cables: result.cables.map((c: any) => ({ id: c.id,
  status: c.status, reason: c.reason_code, length: c.path_length_m })), issues: result.issues })
if (process.argv.includes('--diagnose')) {
  console.log(JSON.stringify({ originalLayout: packing.before, organizedLayout: packing.after,
    blockedLeadouts, originalRouting: details(original), organizedRouting: details(routed) }, null, 2))
  process.exit(0)
}
// The unorganized scene can contain real collisions; failed routes must remain empty and explicit.
mapRoutingResult(original, { scene: originalScene, project: demo })
assert.deepEqual(blockedLeadouts, [], 'organized connected ports require 25 mm lead-outs with 5 mm clearance')
const mapped = mapRoutingResult(routed, { scene: organizedScene, project: organized })
assert.equal(routed.status, 'success', JSON.stringify(details(routed)))
assert.equal(mapped.plannedCount, demo.cables.length)
assert.equal(mapped.conflictCount, 0)
assert.ok(mapped.cables.every((c) => c.route.verification?.status === 'valid' && c.route.points.length >= 2))
console.log(`Real default demo passed: 17 actual objects, ${demo.cables.length} compatible independent connections, valid applied layout and all organized routes verified. Original layout geometry_valid=${packing.before.geometry_valid}; original routing=${original.status}.`)
