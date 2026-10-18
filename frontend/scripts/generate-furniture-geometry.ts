import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { Box3, Mesh, Raycaster, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

// Verify source assets and generate geometry; sync-desk-parts owns runtime GLBs.
const names = ['dormdesk_body', 'drawer_bottom', 'drawer_middle', 'drawer_top']
const parts: Array<{ name: string; min: number[]; max: number[] }> = []
const sources: Record<string, string> = {}
const desktopSolids: Array<{ name: string; min: number[]; max: number[] }> = []
const rearPassages: Array<{ min: number[]; max: number[] }> = []
for (const name of names) {
  const path = `../Prefabmodel/dormdesk_parts/${name}`
  const bytes = readFileSync(`${path}.glb`)
  sources[name] = createHash('sha256').update(bytes).digest('hex')
  const model = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '')).scene
  model.updateMatrixWorld(true)
  if (name === 'dormdesk_body') {
    const top = model.getObjectByName('Desk_Top_Main_Mesh') as Mesh
    const box = new Box3().setFromObject(top)
    const vertices = top.geometry.attributes.position
    const coords = [0, 2].map(axis => [...new Set(Array.from({ length: vertices.count }, (_, i) => {
      const p = new Vector3().fromBufferAttribute(vertices, i).applyMatrix4(top.matrixWorld)
      return +p.getComponent(axis).toFixed(6)
    }))].sort((a, b) => a - b))
    // The authored tabletop is an axis-aligned extrusion. Sample every cell
    // of its vertex grid, then merge adjacent solid cells in each Z row.
    const [xs, zs] = coords
    for (let zi = 0; zi < zs.length - 1; zi++) {
      let run: { min: number[]; max: number[] } | undefined
      for (let xi = 0; xi < xs.length - 1; xi++) {
        const cell = { min: [xs[xi], +box.min.y.toFixed(6), zs[zi]], max: [xs[xi + 1], +box.max.y.toFixed(6), zs[zi + 1]] }
        const ray = new Raycaster(new Vector3((xs[xi] + xs[xi + 1]) / 2, box.max.y + .1, (zs[zi] + zs[zi + 1]) / 2), new Vector3(0, -1, 0))
        if (ray.intersectObject(top).length) {
          if (run) run.max[0] = cell.max[0]
          else { run = cell; desktopSolids.push({ name: '', ...run }) }
        } else { rearPassages.push(cell); run = undefined }
      }
    }
    if (desktopSolids.length !== 3 || rearPassages.length !== 1 || rearPassages[0].min[2] !== zs[0]) {
      throw new Error('Unexpected authored tabletop topology; review the mesh before regenerating')
    }
    desktopSolids.forEach((p, i) => { p.name = i === desktopSolids.length - 1 ? 'Desk_Top_Main' : `Desk_Top_Main_Rear_${i}` })
  }
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
}
writeFileSync('src/scene/furnitureAsset.generated.json', JSON.stringify({ sources, parts, desktopSolids, rearPassages }, null, 2) + '\n')
console.log(`Generated ${parts.length} conservative furniture boxes from verified collision assets.`)
