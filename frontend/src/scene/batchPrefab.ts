import { BufferGeometry, Matrix4, Mesh, type Object3D } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** Bake library-only static meshes into material batches, preserving every triangle. */
export function batchStaticPrefab(root: Object3D): void {
  root.updateMatrixWorld(true)
  const inverse = new Matrix4().copy(root.matrixWorld).invert()
  const buckets = new Map<string, Mesh[]>()
  root.traverse(node => {
    if (!(node instanceof Mesh) || node.type === 'SkinnedMesh' || !node.visible ||
        Array.isArray(node.material) || Object.keys(node.geometry.morphAttributes).length ||
        node.matrixWorld.determinant() < 0) return
    const format = Object.keys(node.geometry.attributes).sort().map(name => {
      const attr = node.geometry.getAttribute(name)
      return `${name}:${attr.itemSize}:${attr.normalized}:${attr.array.constructor.name}`
    }).join('|')
    const key = `${node.material.uuid}:${node.layers.mask}:${node.renderOrder}:${Boolean(node.geometry.index)}:${format}`
    const meshes = buckets.get(key) ?? []
    meshes.push(node)
    buckets.set(key, meshes)
  })
  const replaced = new Set<BufferGeometry>()
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue
    const copies = meshes.map(mesh => mesh.geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld)))
    const geometry = mergeGeometries(copies, false)
    copies.forEach(copy => copy.dispose())
    if (!geometry) continue
    const first = meshes[0]
    const material = Array.isArray(first.material) ? first.material[0] : first.material
    const batch = new Mesh(geometry, material)
    batch.name = `batch:${material.name}`
    batch.layers.mask = first.layers.mask
    batch.renderOrder = first.renderOrder
    for (const mesh of meshes) {
      replaced.add(mesh.geometry)
      mesh.removeFromParent()
    }
    root.add(batch)
  }
  const retained = new Set<BufferGeometry>()
  root.traverse(node => { if (node instanceof Mesh) retained.add(node.geometry) })
  replaced.forEach(geometry => { if (!retained.has(geometry)) geometry.dispose() })
}
