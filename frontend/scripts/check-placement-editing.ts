import assert from 'node:assert/strict'
import { createDemoProject } from '../src/data/demoProject'
import { resizeIssue, snapPlacement, ROTATION_STEP, laptopViewingAngle } from '../src/scene/placementEditing'
import { resolveDropCommit } from '../src/scene/dragCommit'
import { furnitureSurfaces } from '../src/scene/fixedFurniture'
import { placementIssues } from '../src/scene/sceneValidation'
import { replayObjects, replaySteps } from '../src/features/replay/model'
import type { SceneObject, Vec3 } from '../src/types/project'
const p = createDemoProject()
const box: SceneObject = { ...p.objects[0], id: 'box', dimensions: { width: .1, height: .1, depth: .1 }, model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'genericBox' }, transform: { position: [.2, .75, .4], rotationY: 0 }, ports: [] }
const neighbor = { ...box, id: 'neighbor', transform: { position: [.4, .75, .4] as Vec3, rotationY: 0 } }
assert.deepEqual(resolveDropCommit([0, .75, .3], [.1, .75, .3], [.4, .75, .4], false), [.4, .75, .4])
assert.equal(resolveDropCommit([0, 0, 0], [1, 0, 0], [0, 0, 0], false), null)
assert.equal(Math.round(ROTATION_STEP * 180 / Math.PI), 10)
assert.equal(resizeIssue(box, box.dimensions, p.room, [box, neighbor]), null)
assert.match(resizeIssue(box, { ...box.dimensions, width: .5 }, p.room, [box, neighbor])!, /尺寸未改变/)
assert.ok(resizeIssue(box, { ...box.dimensions, height: 3 }, p.room, [box]))
assert.ok(resizeIssue(box, { ...box.dimensions, width: NaN }, p.room, [box]))
assert.ok(laptopViewingAngle([.7, .75, .3], p.room) < 0)
assert.ok(laptopViewingAngle([-.2, .75, .3], p.room) > 0)
const snapped = snapPlacement(box, { x: .281, y: .75, z: .4, kind: 'desk' }, p.room, [box, neighbor])
assert.ok(Math.abs(snapped[0] - .28) < 1e-6)
for (const s of furnitureSurfaces(p.room).filter((s) => s.id.startsWith('support-cabinet'))) {
  const placed = { ...box, transform: { position: [(s.rect.x0 + s.rect.x1) / 2, s.y, (s.rect.z0 + s.rect.z1) / 2] as Vec3, rotationY: .2 } }
  assert.deepEqual(placementIssues(placed, placed.transform.position, [placed], p.room), [], s.id)
  const snap = snapPlacement(box, { x: placed.transform.position[0] + .005, y: s.y, z: placed.transform.position[2], kind: 'shelf' }, p.room, [])
  assert.equal(snap[1], s.y)
  assert.ok(Math.abs(snap[0] - placed.transform.position[0]) < 1e-6)
}
const end = { ...box, transform: { position: [.5, .75, .4] as Vec3, rotationY: -Math.PI / 9 } }
const old = [box, neighbor], next = [end, { ...neighbor, id: 'new' }]
const serialized = JSON.stringify([old, next]), steps = replaySteps(old, next)
assert.equal(steps.length, 3)
assert.deepEqual(replayObjects(old, steps, 0), old)
assert.deepEqual(replayObjects(old, steps, steps.length), next)
assert.ok(replayObjects(old, steps, .5)[0].transform.position[0] > box.transform.position[0])
assert.equal(JSON.stringify([old, next]), serialized)
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string,v: string) => storage.set(k,v), removeItem: (k: string) => storage.delete(k) } })
const { useProjectsStore } = await import('../src/state/projectsStore')
const { useWorkspaceStore } = await import('../src/state/workspaceStore')
useProjectsStore.getState().upsert({ ...p, id: 'edit-test', objects: [box, neighbor], cables: [] })
const ws = useWorkspaceStore.getState()
ws.resetHistory()
ws.updateObject('edit-test', box.id, { dimensions: { width: .5 } })
assert.equal(useProjectsStore.getState().projects['edit-test'].objects[0].dimensions.width, .1)
assert.equal(useWorkspaceStore.getState().past.length, 0)
assert.ok(useWorkspaceStore.getState().notice)
ws.updateObject('edit-test', box.id, { transform: { position: neighbor.transform.position } })
assert.deepEqual(useProjectsStore.getState().projects['edit-test'].objects[0].transform.position, neighbor.transform.position)
ws.undo('edit-test')
assert.deepEqual(useProjectsStore.getState().projects['edit-test'].objects[0].transform.position, box.transform.position)
console.log('placement editing, cabinet supports, immutable replay and resize history checks passed')
