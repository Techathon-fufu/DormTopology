import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Box3, Group, Mesh, Raycaster, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { prepareFurnitureAppearance } from '../src/scene/furnitureAppearance'
import { removeDuplicatePrefabPrimitives } from '../src/scene/prefabModelGeometry'
import { SCENE_CAMERA_CLIP, SCENE_GL_OPTIONS } from '../src/scene/renderProfile'
import { preparePrefabAppearance } from '../src/scene/prefabAppearance'
import { batchStaticPrefab } from '../src/scene/batchPrefab'

async function load(file: string) {
  const bytes = await readFile(`public/models/${file}`)
  const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return (await new GLTFLoader().parseAsync(data, '')).scene
}

function triangles(scene: Group) {
  const result: Array<{ owner: number; family: string; vertices: Vector3[]; normal: Vector3 }> = []
  scene.updateMatrixWorld(true)
  scene.traverse(node => {
    if (!(node instanceof Mesh) || node.name.startsWith('Desk_Top_')) return
    const position = node.geometry.getAttribute('position'), index = node.geometry.index
    for (let i = 0; i < (index?.count ?? position.count); i += 3) {
      const vertices = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(position, index ? index.getX(i + j) : i + j).applyMatrix4(node.matrixWorld))
      const normal = vertices[1].clone().sub(vertices[0]).cross(vertices[2].clone().sub(vertices[0])).normalize()
      result.push({ owner: node.id, family: /^(Bed_|Guardrail_|Ladder_)/i.test(node.name) ? 'cutaway' : 'fixed', vertices, normal })
    }
  })
  return result
}

const area = (poly: number[][]) => poly.reduce((sum, p, i) => {
  const q = poly[(i + 1) % poly.length]
  return sum + p[0] * q[1] - p[1] * q[0]
}, 0) / 2

function intersectionArea(a: number[][], b: number[][]) {
  const orientation = Math.sign(area(b))
  let output = a
  for (let i = 0; i < 3; i++) {
    const p = b[i], q = b[(i + 1) % 3]
    const cross = (r: number[]) => orientation * ((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]))
    const input = output
    output = []
    for (let j = 0; j < input.length; j++) {
      const start = input[j], end = input[(j + 1) % input.length], s = cross(start), e = cross(end)
      if (s >= 0) output.push(start)
      if ((s >= 0) !== (e >= 0)) {
        const t = s / (s - e)
        output.push(start.map((v, axis) => v + t * (end[axis] - v)))
      }
    }
  }
  return Math.abs(area(output))
}

/** Independent triangle intersection test, rather than reusing the rectangle repair. */
function coplanarOverlapCount(scene: Group) {
  const faces = triangles(scene)
  let overlaps = 0
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const a = faces[i], b = faces[j]
    if (a.owner === b.owner || a.family !== b.family || a.normal.dot(b.normal) < 0.99999) continue
    const axis = [0, 1, 2].find(d => Math.abs(a.normal.getComponent(d)) > 0.99999)
    if (axis === undefined || Math.abs(a.vertices[0].getComponent(axis) - b.vertices[0].getComponent(axis)) > 1e-6) continue
    const axes = [0, 1, 2].filter(d => d !== axis)
    if (intersectionArea(a.vertices.map(v => axes.map(d => v.getComponent(d))), b.vertices.map(v => axes.map(d => v.getComponent(d)))) > 1e-9) overlaps++
  }
  return overlaps
}

function visibleDepths(scene: Group, gridSize = 13) {
  const bounds = new Box3().setFromObject(scene), values: Array<number | null> = []
  const raycaster = new Raycaster()
  for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
    const axes = [0, 1, 2].filter(d => d !== axis)
    for (let u = 0; u < gridSize; u++) for (let v = 0; v < gridSize; v++) {
      const origin = bounds.getCenter(new Vector3()).setComponent(axis, (sign < 0 ? bounds.min : bounds.max).getComponent(axis) + sign)
      for (const [i, value] of [[axes[0], u], [axes[1], v]]) origin.setComponent(i, bounds.min.getComponent(i) + (bounds.max.getComponent(i) - bounds.min.getComponent(i)) * (value + 0.37) / gridSize)
      raycaster.set(origin, new Vector3().setComponent(axis, -sign))
      values.push(raycaster.intersectObject(scene, true)[0]?.distance ?? null)
    }
  }
  return values
}

const files = ['dormdesk_body', 'drawer_bottom', 'drawer_middle', 'drawer_top']
const report: unknown[] = []
for (const file of files) {
  const scene = await load(`dormdesk_parts/${file}.glb`)
  const bounds = new Box3().setFromObject(scene)
  const before = visibleDepths(scene), overlapsBefore = coplanarOverlapCount(scene)
  const start = performance.now()
  prepareFurnitureAppearance(scene)
  const repairMs = performance.now() - start
  scene.updateMatrixWorld(true)
  const overlapsAfter = coplanarOverlapCount(scene)
  assert.equal(overlapsAfter, 0, `${file}: coplanar triangles must have one owner`)
  const afterBounds = new Box3().setFromObject(scene)
  assert.ok(bounds.min.distanceTo(afterBounds.min) < 1e-6 && bounds.max.distanceTo(afterBounds.max) < 1e-6, `${file}: bounds retained`)
  const after = visibleDepths(scene)
  after.forEach((value, i) => {
    if (value === null || before[i] === null) assert.equal(value, before[i], `${file}: silhouette ray ${i}`)
    else assert.ok(Math.abs(value - before[i]!) < 2e-6, `${file}: visible surface depth ray ${i}`)
  })
  const geometries: unknown[] = []
  scene.traverse(node => { if (node instanceof Mesh) geometries.push(node.geometry) })
  prepareFurnitureAppearance(scene)
  const again: unknown[] = []
  scene.traverse(node => { if (node instanceof Mesh) again.push(node.geometry) })
  assert.deepEqual(again, geometries, `${file}: preparation is idempotent`)
  report.push({ file, overlapsBefore, overlapsAfter, silhouetteRays: after.length, repairMs: +repairMs.toFixed(2) })
}

const laptop = await load('items/laptop_fold.glb')
const boundsBefore = new Box3().setFromObject(laptop)
const originalCount = triangles(laptop).length
removeDuplicatePrefabPrimitives(laptop)
const count = triangles(laptop).length
assert.equal(originalCount, 192)
assert.equal(count, 48)
assert.deepEqual(new Box3().setFromObject(laptop), boundsBefore)
assert.equal(SCENE_GL_OPTIONS.powerPreference, 'high-performance')
assert.ok(SCENE_CAMERA_CLIP.far >= 8 && SCENE_CAMERA_CLIP.far <= 50)
report.push({ file: 'laptop_fold', trianglesBefore: originalCount, trianglesAfter: count })
for (const id of ['monitor', 'laptop_extend', 'cup', 'stainless_bottle', 'tissue_box', 'phone', 'charger', 'mousepad']) {
  const scene = await load(`items/${id}.glb`)
  const before = new Box3().setFromObject(scene)
  const countBefore = triangles(scene).length
  preparePrefabAppearance(scene, id)
  assert.deepEqual(new Box3().setFromObject(scene), before, `${id}: cosmetic color edits preserve bounds`)
  assert.equal(triangles(scene).length, countBefore, `${id}: cosmetic color edits preserve every triangle`)
}
report.push({ recoloredPrefabs: 8, geometryPreserved: true })
for (const id of ['keyboard', 'mouse']) {
  const scene = await load(`items/${id}.glb`)
  const meshCount = () => { let count = 0; scene.traverse(n => { if (n instanceof Mesh) count++ }); return count }
  const meshesBefore = meshCount(), trianglesBefore = triangles(scene).length
  const before = visibleDepths(scene, 7), box = new Box3().setFromObject(scene)
  batchStaticPrefab(scene)
  scene.updateMatrixWorld(true)
  const after = visibleDepths(scene, 7)
  assert.equal(triangles(scene).length, trianglesBefore, `${id}: all triangles preserved by batching`)
  const nextBox = new Box3().setFromObject(scene)
  assert.ok(box.min.distanceTo(nextBox.min) < 1e-6 && box.max.distanceTo(nextBox.max) < 1e-6)
  after.forEach((value, i) => {
    if (value === null || before[i] === null) assert.equal(value, before[i])
    else assert.ok(Math.abs(value - before[i]!) < 2e-6, `${id}: batched surface ray ${i}`)
  })
  assert.ok(meshCount() < meshesBefore / 2, `${id}: batching must meaningfully reduce submissions`)
  report.push({ file: id, meshesBefore, meshesAfter: meshCount(), trianglesPreserved: trianglesBefore, silhouetteRays: after.length })
}
console.log(JSON.stringify(report, null, 2))
