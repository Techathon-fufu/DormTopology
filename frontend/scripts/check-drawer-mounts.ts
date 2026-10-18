import assert from 'node:assert/strict'
import { Ray, Vector3 } from 'three'
import { createDemoProject } from '../src/data/demoProject'
import { furnitureBoxes, furnitureSurfaces, fixedFurnitureBoxes } from '../src/scene/fixedFurniture'
import { objectDrawerId, drawerDisplayPosition } from '../src/scene/drawerContents'
import { placementIssues, raycastSupports, validateScene } from '../src/scene/sceneValidation'
import { placementAtSupport, resizeIssue } from '../src/scene/placementEditing'
import { backboardSurface, orientPowerStrip, placePowerStripOnBackboard, validBackboardMount } from '../src/scene/backboardMount'
import { computePowerStripSpecChange } from '../src/scene/powerStrip'
import { portWorldDirection } from '../src/scene/ports'
import { worldCollision } from '../src/scene/collisionGeometry'
import { toPackingScene } from '../src/api/core/packingWire'
import { resolveOrganizationPreferences } from '../src/types/organization'
import type { SceneObject, Vec3 } from '../src/types/project'
const demo = createDemoProject(), room = demo.room
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`)
const box: SceneObject = { ...demo.objects[0], id: 'drawer-probe', dimensions: { width: .08, height: .04, depth: .08 },
  model: { shape: 'genericBox', status: 'placeholder', source: 'demo', format: 'placeholder-box' }, ports: [],
  transform: { position: [.2, .75, .4], rotationY: .3 } }
const offsets = { top: -.3 }
const hit = raycastSupports(new Ray(new Vector3(.48, .70, .67), new Vector3(0, -1, 0)), room, null, offsets)!
assert.equal(hit.surfaceId, 'support-drawer-top')
const angled = raycastSupports(new Ray(new Vector3(-1.05, 1.35, 1.95), new Vector3(.7252713124826413,-.341951716880939,-.5975370671446962)), room, null, offsets)!
assert.equal(angled.surfaceId, 'support-drawer-top', 'a ray through the visible opening must snap to its moving floor even if it misses the floor rectangle')
near(angled.y, .549)
const placed = placementAtSupport(box, hit, room, [box], offsets)
assert.equal(objectDrawerId(placed, room), 'top')
near(placed.transform.position[0], .78)
near(drawerDisplayPosition(placed, room, offsets)[0], .48)
near(drawerDisplayPosition(placed, room, { top: -.15 })[0], .63)
near(drawerDisplayPosition(placed, room, {})[0], .78)
assert.equal(validateScene([placed], room, null, offsets).size, 0)
assert.equal(validateScene([placed], room).size, 0)
assert.equal(validateScene([placed], room, null, { top: -.15 }).size, 0)
// No second stationary support remains behind the opened drawer (nor a hidden closed-drawer target).
assert.equal(furnitureSurfaces(room, false, offsets).filter(s => s.id === hit.surfaceId).length, 1)
assert.equal(raycastSupports(new Ray(new Vector3(.85, .70, .67), new Vector3(0, -1, 0)), room, null, offsets)?.kind, 'floor')
assert.equal(raycastSupports(new Ray(new Vector3(.78, .70, .67), new Vector3(0, -1, 0)), room)?.kind, 'floor')
for (const original of furnitureBoxes(room)) {
  const moved = furnitureBoxes(room, offsets).find(b => b.name === original.name)!
  near(moved.min[0] - original.min[0], original.name.startsWith('drawer_top:') ? -.3 : 0)
}
const out = placementAtSupport(placed, { kind: 'desk', label: '桌面', x: .2, y: .75, z: .4 }, room, [placed], offsets)
assert.equal(objectDrawerId(out, room), undefined)
assert.deepEqual(drawerDisplayPosition(out, room, offsets), out.transform.position)
const oversized = { ...placed, dimensions: { width: .6, height: .04, depth: .08 } }
assert.ok(validateScene([oversized], room, null, offsets).get(placed.id)?.some(i => i.type === 'outOfBounds'))
assert.ok(resizeIssue(placed, { ...placed.dimensions, height: .2 }, room, [placed]))
assert.ok(!fixedFurnitureBoxes.some(p => p.name === 'Cabinet_Door'))
assert.equal(furnitureSurfaces(room).filter(s => s.id.startsWith('support-cabinet')).length, 2)
const strip = demo.objects.find(o => o.id === 'demo-power-strip')!, board = backboardSurface(room)!
assert.equal(strip.powerStrip?.mount, 'backboard')
near(strip.transform.position[0], (board.x0 + board.x1) / 2)
near(strip.transform.position[1] + strip.dimensions.height / 2, (board.y0 + board.y1) / 2)
assert.equal(validBackboardMount(strip, strip.transform.position, room), true)
assert.deepEqual(placementIssues(strip, strip.transform.position, [strip], room), [])
strip.ports.forEach(p => assert.deepEqual(portWorldDirection(strip, p), [0, 0, 1]))
const bounds = worldCollision(strip).bounds
near(bounds.min[2], board.z)
const desktop = orientPowerStrip(strip, false)
near(desktop.dimensions.height, .03)
near(desktop.dimensions.depth, .05)
desktop.ports.forEach(p => assert.deepEqual(portWorldDirection(desktop, p), [0, 1, 0]))
const mountedAgain = orientPowerStrip(desktop, true)
mountedAgain.ports.forEach((p, i) => p.offset!.forEach((v, axis) => near(v, strip.ports[i].offset![axis])))
const ray = new Ray(new Vector3(.07, .65, 1), new Vector3(0, 0, -1))
assert.equal(raycastSupports(ray, room, null, {}, box), null)
assert.equal(raycastSupports(ray, room, null, {}, desktop)?.kind, 'backboard')
const drop = placementAtSupport(desktop, raycastSupports(ray, room, null, {}, desktop)!, room, [])
assert.equal(validBackboardMount(drop, drop.transform.position, room), true)
const detached = placementAtSupport(strip, { kind: 'desk', label: '桌面', x: .2, y: .75, z: .3 }, room, [])
assert.equal(detached.powerStrip?.mount, undefined)
assert.deepEqual(placementIssues(detached, detached.transform.position, [detached], room), [])
assert.ok(resizeIssue(strip, { ...strip.dimensions, width: 2 }, room, [strip]))
assert.equal(resizeIssue(strip, { ...strip.dimensions, depth: .04 }, room, [strip]), null)
const six = computePowerStripSpecChange(strip, [], { socketCount: 6 }).object
assert.equal(six.powerStrip?.mount, 'backboard')
assert.equal(six.ports.length, 6)
six.ports.forEach(p => assert.deepEqual(portWorldDirection(six, p), [0, 0, 1]))
assert.ok(placementIssues(strip, [.07, .625, .2], [strip], room).some(i => i.type === 'floating'))
const wire = toPackingScene({ projectId: demo.id, room, objects: [strip], preferences: resolveOrganizationPreferences(demo), confirmed: true })
assert.deepEqual(wire.items[0].surface_mount, { obstacle_id: 'furniture:Desk_Back_Baffle', face: 'z_max' })
assert.deepEqual(wire.items[0].allowed_region_ids, [])
assert.equal(wire.items[0].fixed, true)
const cup = demo.objects.find(o => o.model.prefabId === 'cup')!
const storedCup = placementAtSupport(cup, angled, room, [cup], offsets)
assert.equal(objectDrawerId(storedCup, room), 'top', 'desktop prefab binding must not pull a stored item back onto the desktop')
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string,v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) } })
const { useProjectsStore } = await import('../src/state/projectsStore')
const { useWorkspaceStore } = await import('../src/state/workspaceStore')
const { useDrawerStore, currentDrawerOffsets } = await import('../src/state/drawerStore')
const ws = useWorkspaceStore.getState(), id = 'drawer-store-test'
useProjectsStore.getState().upsert({ ...demo, id, objects: [box], cables: [] })
ws.resetHistory()
ws.updateObject(id, box.id, { transform: placed.transform })
useDrawerStore.getState().setProgress('top', 1)
let saved = useProjectsStore.getState().projects[id].objects[0]
near(drawerDisplayPosition(saved, room, currentDrawerOffsets())[0], .48)
ws.updateObject(id, box.id, { transform: out.transform })
assert.equal(objectDrawerId(useProjectsStore.getState().projects[id].objects[0], room), undefined)
ws.undo(id)
assert.equal(objectDrawerId(useProjectsStore.getState().projects[id].objects[0], room), 'top')
ws.redo(id)
assert.equal(objectDrawerId(useProjectsStore.getState().projects[id].objects[0], room), undefined)
const added = { ...desktop, id: 'new-strip' }
ws.addObject(id, added)
saved = useProjectsStore.getState().projects[id].objects.find(o => o.id === added.id)!
assert.equal(validBackboardMount(saved, saved.transform.position, room), true)
const history = useWorkspaceStore.getState().past.length
ws.updateObject(id, added.id, { dimensions: { width: 2 } })
assert.equal(useWorkspaceStore.getState().past.length, history)
ws.updateObject(id, added.id, { dimensions: { depth: .04 } })
saved = useProjectsStore.getState().projects[id].objects.find(o => o.id === added.id)!
near(saved.dimensions.depth, .04)
assert.equal(validBackboardMount(saved, saved.transform.position, room), true)
ws.updateObject(id, added.id, { transform: { rotationY: .2 } })
assert.equal(useProjectsStore.getState().projects[id].objects.find(o => o.id === added.id)!.transform.rotationY, 0)
assert.deepEqual(placePowerStripOnBackboard(box, room), box)
console.log('Drawers: one moving support, follow/open/close/detach, real walls, cavity bounds and undo/redo passed. PDU: mount, ports, drag support, default, resize, specification and API export passed.')
