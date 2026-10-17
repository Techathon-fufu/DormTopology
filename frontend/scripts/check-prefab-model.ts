import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Box3, Group, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { PREFAB_ITEMS } from '../src/scene/prefabItems'
import { createPrefabInstance, normalizePrefabTemplate } from '../src/scene/prefabModelGeometry'
import { localCollision, worldCollision } from '../src/scene/collisionGeometry'
import type { SceneObject } from '../src/types/project'

const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`)
let cases = 0
for (const def of Object.values(PREFAB_ITEMS)) {
  const data = await readFile(new URL(`../public/${def.url}`, import.meta.url))
  const gltf = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), '')
  const template = normalizePrefabTemplate(gltf.scene)
  for (const factors of [[1, 1, 1], [1.5, 0.75, 2], [0.6, 1.3, 0.9]]) {
    const dims = { width: def.size[0] * factors[0], height: def.size[1] * factors[1], depth: def.size[2] * factors[2] }
    const object = {
      id: def.id, dimensions: dims, transform: { position: [0.4, 0.77, 0.3], rotationY: 0 },
      model: { status: 'ready', prefabId: def.id },
    } as SceneObject
    const local = localCollision(object)
    close(local.bounds.min[1], 0)
    ;[dims.width, dims.height, dims.depth].forEach((size, i) => close(local.bounds.max[i] - local.bounds.min[i], size))
    for (const angle of [0, Math.PI / 6, Math.PI / 2]) {
      object.transform.rotationY = angle
      const world = worldCollision(object)
      const parent = new Group()
      parent.position.set(0.4, 0.77 + dims.height / 2, 0.3)
      parent.rotation.y = angle
      parent.add(createPrefabInstance(template, dims))
      const visual = new Box3().setFromObject(parent)
      close(visual.min.y, world.bounds.min[1])
      close(visual.max.y, world.bounds.max[1])
      // Simplified hulls may differ in XZ after arbitrary rotation.
      if (angle === 0 || angle === Math.PI / 2) {
        visual.min.toArray().forEach((value, i) => close(value, world.bounds.min[i]))
        visual.max.toArray().forEach((value, i) => close(value, world.bounds.max[i]))
      }
      cases += 1
    }
  }
  const native = createPrefabInstance(template, { width: def.size[0], height: def.size[1], depth: def.size[2] })
  close(new Box3().setFromObject(native).getSize(new Vector3()).x, def.size[0])
}
assert.equal(Object.keys(PREFAB_ITEMS).length, 12)
console.log(`Prefab model/collision checks passed: ${cases} cases across 12 real GLBs`)
