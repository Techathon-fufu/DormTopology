import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { Box3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Offline asset build: runtime geometry never depends on asynchronous GLB loading.
const names = ['dormdesk_body', 'drawer_bottom', 'drawer_middle', 'drawer_top']
const parts: Array<{ name: string; min: number[]; max: number[] }> = []
const sources: Record<string, string> = {}
mkdirSync('public/models/dormdesk_parts', { recursive: true })
for (const name of names) {
  const path = `../Prefabmodel/dormdesk_parts/${name}`
  const bytes = readFileSync(`${path}.glb`)
  sources[name] = createHash('sha256').update(bytes).digest('hex')
  const model = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
  model.updateMatrixWorld(true)
  const meshes: Array<{ name: string; box: Box3 }> = []
  model.traverse((node) => {
    if ('isMesh' in node) meshes.push({ name: node.name.replace(/_Mesh$/, ''), box: new Box3().setFromObject(node) })
  })
  const collision = JSON.parse(readFileSync(`${path}.collision.json`, 'utf8')) as { parts: Array<{ vertices_m: number[][] }> }
  if (collision.parts.length !== meshes.length) throw new Error(`${name}: collision/mesh count differs`)
  collision.parts.forEach((part, i) => {
    const min = [0, 1, 2].map((axis) => Math.min(...part.vertices_m.map((v) => v[axis])))
    const max = [0, 1, 2].map((axis) => Math.max(...part.vertices_m.map((v) => v[axis])))
    const index = meshes.findIndex((mesh) => [...min, ...max].every((v, axis) => Math.abs(v - [...mesh.box.min.toArray(), ...mesh.box.max.toArray()][axis]) <= 0.0001))
    if (index < 0) throw new Error(`${name}:${i}: collision has no matching mesh`)
    const [mesh] = meshes.splice(index, 1)
    parts.push({ name: name === 'dormdesk_body' ? mesh.name : `${name}:${mesh.name}`, min: min.map((v) => +v.toFixed(6)), max: max.map((v) => +v.toFixed(6)) })
  })
  copyFileSync(`${path}.glb`, `public/models/dormdesk_parts/${name}.glb`)
}
writeFileSync('src/scene/furnitureAsset.generated.json', JSON.stringify({ sources, parts }, null, 2) + '\n')
console.log(`Generated ${parts.length} conservative furniture boxes from verified collision assets.`)
