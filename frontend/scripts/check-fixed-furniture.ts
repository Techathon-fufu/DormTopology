import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Group, Box3, Raycaster, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createDemoProject } from '../src/data/demoProject'
import { FIXED_MODEL_URLS, fixedFurnitureBoxes, furnitureSurfaces, validFurnitureHole } from '../src/scene/fixedFurniture'
import { DORM_DESK_MODEL_CONFIG, mountDeskModel } from '../src/scene/deskModel'
import { placementIssues, supportsContaining, raycastSupports } from '../src/scene/sceneValidation'
import { toPackingScene, mapPackingOrganizationResult, toPackingPosition } from '../src/api/core/packingWire'
import { toRoutingScene, mapRoutingResult } from '../src/api/core/routingWire'
import { endpointOf } from '../src/scene/cables'
import { computeOrganizationZones } from '../src/scene/organizationZones'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { SceneObject } from '../src/types/project'

const demo = createDemoProject(), room = demo.room
const group = new Group()
for (const path of FIXED_MODEL_URLS) {
  const bytes = readFileSync(`public/${path}`)
  group.add((await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene)
}
const mounted = mountDeskModel(group, DORM_DESK_MODEL_CONFIG, room)
assert.ok(Math.abs(mounted.metrics.deskTopY - .75) < 1e-6)
for (const p of fixedFurnitureBoxes) {
  const name = p.name.includes(':') ? p.name.split(':')[1] : p.name
  let node = group.getObjectByName(`${name}_Mesh`) ?? group.getObjectByName(name)
  if (p.name.startsWith('drawer_')) node = group.children[FIXED_MODEL_URLS.findIndex((u) => u.includes(p.name.split(':')[0]))].getObjectByName(name)
  assert.ok(node, p.name)
  const box = new Box3().setFromObject(node)
  assert.ok([...p.min, ...p.max].every((v, i) => Math.abs(v - [...box.min.toArray(), ...box.max.toArray()][i]) < 1e-5), `${p.name}: one common render/collision transform`)
}
assert.ok(!supportsContaining(room, 0, .75).some((s) => s.kind === 'desk'), 'L gap has no desk support')
assert.ok(supportsContaining(room, 0, .2).some((s) => s.kind === 'desk'))
assert.equal(raycastSupports(new Raycaster(new Vector3(0, 1.2, .75), new Vector3(0, -1, 0)).ray, room)?.kind, 'floor')
assert.ok(supportsContaining(room, .4, .15).some((s) => s.kind === 'shelf' && s.y === 1.46))
assert.ok(!supportsContaining(room, 0, .15).some((s) => Math.abs(s.y - 1.139) < .001))
assert.ok(!validFurnitureHole(room, [0, .75, .75], .05))
assert.ok(validFurnitureHole(room, room.cableHoles[0].position, .05))
const small: SceneObject = { ...demo.objects[0], id: 'probe', ports: [], model: { ...demo.objects[0].model, shape: 'genericBox' }, dimensions: { width: .04, height: .04, depth: .04 }, transform: { position: [.78, .549, .65], rotationY: 0 } }
assert.deepEqual(placementIssues(small, small.transform.position, [small], room), [], 'drawer interior has physical support and an empty cavity')
assert.ok(placementIssues(small, [-.7, .2, .3], [small], room).some((i) => i.type === 'roomCollision'), 'wardrobe is an obstacle')
assert.ok(placementIssues(small, [.64, .56, .65], [small], room).some((i) => i.type === 'roomCollision'), 'drawer shell is solid')
const preferences = resolveOrganizationPreferences(demo)
const input = { projectId: demo.id, room, objects: demo.objects, preferences, confirmed: true }
const scene = { ...toPackingScene(input), baseline_id: 'fixed-furniture-regression' }
if (process.argv.includes('--export')) { process.stdout.write(JSON.stringify(scene)); process.exit(0) }
assert.equal(scene.regions.filter((r) => r.id.startsWith('support-shelf')).length, 5)
assert.equal(scene.regions.filter((r) => r.id.startsWith('support-drawer')).length, 3)
assert.ok(!scene.obstacles.some((o) => o.id.includes('desk-beam')))
const routing = toRoutingScene({ project: { ...demo, cables: [] }, confirmed: true })
const hole = room.cableHoles[0].position
const slabs = routing.obstacles.filter((o) => o.id.includes('Desk_Top_'))
const hp = toPackingPosition(hole, room)
assert.ok(!slabs.some((o) => hp[0] > o.min[0] && hp[0] < o.max[0] && hp[2] > o.min[2] && hp[2] < o.max[2]), 'routing sees the same real opening')
const python = spawnSync('python3', ['-B', '-c', 'import json,sys; from backend.app.domain.packing import plan_packing,validate_layout; from backend.examples.packing_demo import preview_scene; s=json.load(sys.stdin); r=plan_packing(s); print(json.dumps({"result":r,"check":validate_layout(preview_scene(s,r))}))'], { cwd: resolve('..'), input: JSON.stringify(scene), encoding: 'utf8', timeout: 120_000 })
assert.equal(python.status, 0, python.stderr)
const { result, check } = JSON.parse(python.stdout)
if (result.status !== 'success') console.log(JSON.stringify({ status: result.status, issues: result.issues, geometry: check, targets: result.items }))
assert.equal(result.status, 'success')
assert.equal(check.geometry_valid, true)
const mapped = mapPackingOrganizationResult(result, { ...input, scene, jobId: 'furniture-check' })
assert.equal(mapped.serviceMeta?.applicable, true, JSON.stringify(mapped.serviceMeta?.issues))
const zones = computeOrganizationZones(room, preferences)
const monitor = mapped.assignments.find((a) => a.objectId === 'demo-monitor')!
const printer = mapped.assignments.find((a) => a.objectId === 'demo-printer')!
assert.ok(Math.abs(monitor.position[0] - zones.workstation!.slotCenterX) < .002)
assert.ok(printer.position[0] < -.04, 'printer leaves the right return for daily items')
assert.equal(monitor.rotationY, 0)
assert.equal(printer.rotationY, 0)
assert.ok(mapped.assignments.filter((a) => a.position[1] === 0).every((a) => a.objectId === 'demo-computer-tower'))
assert.equal(furnitureSurfaces(room).filter((s) => s.kind === 'drawer').length, 3)
if (!process.argv.includes('--routing-export')) console.log('Fixed furniture: shared transforms, L support, true shelves/drawers, opening, cabinet collisions and full real layout passed.')
const peers = [-.35, .35].map((x, i): SceneObject => ({ ...small, id: `peer-${i}`,
  dimensions: { width: .08, height: .4, depth: .08 }, transform: { position: [x, .75, .19], rotationY: 0 },
  ports: [{ id: `peer-port-${i}`, type: 'hdmi', powered: false, offset: [0, .28, -.04], direction: 'back', confirmed: true }],
}))
const routeProject = { ...demo, objects: peers, cables: [{ id: 'fixed-wire', projectId: demo.id, kind: 'video' as const, visibility: 'hidden' as const, thickness: 'thin' as const,
  from: endpointOf(peers[0], peers[0].ports[0]), to: endpointOf(peers[1], peers[1].ports[0]),
  route: { channels: [], points: [] }, reserveLengthM: .05, status: 'existing' as const, accessories: [],
}] }
const routeScene = { ...toRoutingScene({ project: routeProject, confirmed: true }), baseline_id: scene.baseline_id }
if (process.argv.includes('--routing-export')) { process.stdout.write(JSON.stringify(routeScene)); process.exit(0) }
const routed = spawnSync('python3', ['-B', '-c', 'import json,sys; from backend.app.domain.routing import plan_routing; print(json.dumps(plan_routing(json.load(sys.stdin))))'], { cwd: resolve('..'), input: JSON.stringify(routeScene), encoding: 'utf8', timeout: 120_000 })
assert.equal(routed.status, 0, routed.stderr)
const routeResult = JSON.parse(routed.stdout)
assert.equal(routeResult.status, 'success', JSON.stringify(routeResult.issues))
assert.equal(routeScene.cables[0].length_m, null)
assert.equal(mapRoutingResult(routeResult, { scene: routeScene, project: routeProject }).plannedCount, 1)
console.log('New furniture real routing passed with unknown available length and the shared obstacle geometry.')
