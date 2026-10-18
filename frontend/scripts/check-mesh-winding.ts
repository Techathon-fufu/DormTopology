import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Box3, BoxGeometry, Mesh, PlaneGeometry, Raycaster, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { repairClosedShellWinding } from '../src/scene/meshWinding'

const reverse = (geometry: BoxGeometry) => {
  const indices = [...geometry.index!.array]
  for (let i = 0; i < indices.length; i += 3) [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]]
  geometry.setIndex(indices)
  return geometry
}
const normalBox = new BoxGeometry(1, .01, .5)
assert.equal(repairClosedShellWinding(normalBox).geometry, normalBox, 'valid winding retains the original geometry')
const inwardBox = reverse(new BoxGeometry(1, .01, .5))
const originalIndex = [...inwardBox.index!.array]
const repaired = repairClosedShellWinding(inwardBox)
assert.equal(repaired.flippedComponents, 1)
assert.equal(repaired.flippedTriangles, 12)
assert.deepEqual([...inwardBox.index!.array], originalIndex, 'source indices stay immutable')
assert.equal(repairClosedShellWinding(repaired.geometry).flippedComponents, 0, 'repair is idempotent')
const mixed = mergeGeometries([normalBox.clone().translate(0, 1, 0), inwardBox], false)!
const mixedRepair = repairClosedShellWinding(mixed)
assert.equal(mixedRepair.flippedComponents, 1, 'mixed shells are corrected independently')
assert.equal(mixedRepair.flippedTriangles, 12)
assert.deepEqual([...mixedRepair.geometry.index!.array].slice(0, 36), [...mixed.index!.array].slice(0, 36))
const open = new PlaneGeometry(1, 1)
assert.equal(repairClosedShellWinding(open).geometry, open, 'open sheets have no inferred inside/outside')
const broken = inwardBox.clone()
broken.setIndex([...broken.index!.array, ...Array.from(broken.index!.array).slice(0, 3)])
assert.equal(repairClosedShellWinding(broken).geometry, broken, 'non-manifold shells are left authored')

const report: unknown[] = []
for (const id of ['mousepad', 'monitor', 'phone']) {
  const bytes = await readFile(`public/models/items/${id}.glb`)
  const { scene } = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, '')
  const meshes: Mesh[] = []
  scene.traverse(node => { if (node instanceof Mesh) meshes.push(node) })
  const bounds = new Box3().setFromObject(scene)
  const rootMatrix = scene.matrix.toArray()
  const ray = new Raycaster(new Vector3(id === 'monitor' ? .1 : 0, .1, id === 'monitor' ? .065 : 0), new Vector3(0, -1, 0))
  const beforeY = ray.intersectObject(scene, true)[0]?.point.y
  let flippedComponents = 0, flippedTriangles = 0
  for (const mesh of meshes) {
    const positions = [...mesh.geometry.getAttribute('position').array]
    const repair = repairClosedShellWinding(mesh.geometry)
    flippedComponents += repair.flippedComponents
    flippedTriangles += repair.flippedTriangles
    mesh.geometry = repair.geometry
    assert.deepEqual([...mesh.geometry.getAttribute('position').array], positions)
  }
  scene.updateMatrixWorld(true)
  const hit = ray.intersectObject(scene, true)[0]
  assert.ok(hit, `${id}: visible top surface`)
  assert.ok(Math.abs(hit.point.y - (id === 'monitor' ? .015 : id === 'phone' ? .007 : .001)) < 1e-7, `${id}: ray hits the top, not the coplanar bottom`)
  assert.ok(hit.face!.normal.y > .999)
  assert.ok(flippedComponents > 0)
  assert.deepEqual(new Box3().setFromObject(scene), bounds)
  assert.deepEqual(scene.matrix.toArray(), rootMatrix)
  for (const mesh of meshes) assert.equal(repairClosedShellWinding(mesh.geometry).flippedComponents, 0)
  report.push({ id, flippedComponents, flippedTriangles, visibleTopBeforeM: beforeY, visibleTopAfterM: hit.point.y, positionsAndBoundsPreserved: true })
}
console.log(JSON.stringify(report, null, 2))
