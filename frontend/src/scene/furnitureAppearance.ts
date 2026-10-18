import { Box3, BufferGeometry, Float32BufferAttribute, Matrix3, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three'

type Rect = { u0: number; u1: number; v0: number; v1: number }
type Face = Rect & { axis: number; sign: number; plane: number }
const EPS = 1e-6
const PALETTE: Record<string, string> = {
  Mat_Pine_Natural: '#C89F6A',
  Mat_Warm_Oak: '#D7B783',
  Mat_Dark_Wood: '#5D4B3E',
  Mat_Metal_Hardware: '#46515A',
}

/** Rectangle difference: no offsets, changes to dimensions, or collision geometry. */
function subtract(a: Rect, b: Rect): Rect[] {
  const u0 = Math.max(a.u0, b.u0), u1 = Math.min(a.u1, b.u1)
  const v0 = Math.max(a.v0, b.v0), v1 = Math.min(a.v1, b.v1)
  if (u1 - u0 <= EPS || v1 - v0 <= EPS) return [a]
  return [
    { u0: a.u0, u1: u0, v0: a.v0, v1: a.v1 },
    { u0: u1, u1: a.u1, v0: a.v0, v1: a.v1 },
    { u0, u1, v0: a.v0, v1: v0 },
    { u0, u1, v0: v1, v1: a.v1 },
  ].filter(r => r.u1 - r.u0 > EPS && r.v1 - r.v0 > EPS)
}

/** Only exact, untextured, axis-aligned boxes qualify; curved/detail meshes stay authored. */
function boxBounds(mesh: Mesh): Box3 | null {
  const geometry = mesh.geometry
  if (Array.isArray(mesh.material) || geometry.morphAttributes.position?.length ||
      Object.keys(geometry.attributes).some(key => key !== 'position' && key !== 'normal')) return null
  const position = geometry.getAttribute('position')
  if (!position || (geometry.index?.count ?? position.count) !== 36) return null
  geometry.computeBoundingBox()
  const box = geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld)
  const corners = new Set<string>()
  const p = new Vector3()
  for (let i = 0; i < position.count; i++) {
    p.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
    const bits = [0, 1, 2].map(axis => {
      const value = p.getComponent(axis)
      if (Math.abs(value - box.min.getComponent(axis)) < EPS) return '0'
      if (Math.abs(value - box.max.getComponent(axis)) < EPS) return '1'
      return 'x'
    }).join('')
    if (bits.includes('x')) return null
    corners.add(bits)
  }
  return corners.size === 8 ? box : null
}

/**
 * Repair the known box-built furniture once at load time. Same-facing coplanar
 * rectangles get one owner, removing the cause of Z-fighting rather than moving
 * boards apart. Cutaway parts and independently moving drawers never share owners.
 */
export function prepareFurnitureAppearance(root: Object3D): void {
  if (root.userData.previewPrepared) return
  root.updateMatrixWorld(true)
  const owned = new Map<string, Array<Face>>()
  const replaced = new Set<BufferGeometry>()
  root.traverse(node => {
    if (!(node instanceof Mesh)) return
    const materials = Array.isArray(node.material) ? node.material : [node.material]
    for (const material of materials) {
      if (material instanceof MeshStandardMaterial && PALETTE[material.name]) {
        material.color.set(PALETTE[material.name])
        material.roughness = 0.72
        material.metalness = material.name === 'Mat_Metal_Hardware' ? 0.25 : 0
      }
    }
    node.castShadow = true
    node.receiveShadow = true
    // The authored solid desktop is displayed directly. It participates in the
    // same coplanar-face ownership pass as the rest of the fixed furniture.
    const box = boxBounds(node)
    if (!box) return
    const family = /^(Bed_|Guardrail_|Ladder_)/i.test(node.name) ? 'cutaway' : 'fixed'
    const inverse = node.matrixWorld.clone().invert()
    const normalMatrix = new Matrix3().setFromMatrix4(node.matrixWorld).transpose()
    const positions: number[] = [], normals: number[] = []
    let changed = false
    for (let axis = 0; axis < 3; axis++) for (const sign of [-1, 1]) {
      const axes = [0, 1, 2].filter(i => i !== axis)
      const face: Face = {
        axis, sign, plane: (sign < 0 ? box.min : box.max).getComponent(axis),
        u0: box.min.getComponent(axes[0]), u1: box.max.getComponent(axes[0]),
        v0: box.min.getComponent(axes[1]), v1: box.max.getComponent(axes[1]),
      }
      // Bucket by orientation, then test plane distance explicitly (float GLB coordinates).
      const key = `${family}:${axis}:${sign}`
      const previous = owned.get(key) ?? []
      let pieces: Rect[] = [face]
      for (const other of previous) {
        if (Math.abs(other.plane - face.plane) > EPS) continue
        const next = pieces.flatMap(piece => subtract(piece, other))
        if (next.length !== pieces.length || next.some((r, i) => r !== pieces[i])) changed = true
        pieces = next
        if (!pieces.length) break
      }
      // Record the original rectangle: even a previously clipped part is already owned.
      previous.push(face)
      owned.set(key, previous)
      const normal = new Vector3().setComponent(axis, sign).applyMatrix3(normalMatrix).normalize()
      for (const piece of pieces) {
        const corners = [[piece.u0, piece.v0], [piece.u1, piece.v0], [piece.u1, piece.v1], [piece.u0, piece.v1]]
        // (u,v) gives +X, -Y, +Z winding for the three possible planes.
        const order = sign === (axis === 1 ? -1 : 1) ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]
        for (const index of order) {
          const p = new Vector3().setComponent(axis, face.plane)
            .setComponent(axes[0], corners[index][0]).setComponent(axes[1], corners[index][1]).applyMatrix4(inverse)
          positions.push(p.x, p.y, p.z)
          normals.push(normal.x, normal.y, normal.z)
        }
      }
    }
    if (changed) {
      const geometry = new BufferGeometry()
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
      geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
      geometry.computeBoundingBox()
      geometry.computeBoundingSphere()
      replaced.add(node.geometry)
      node.geometry = geometry
    }
  })
  const retained = new Set<BufferGeometry>()
  root.traverse(node => { if (node instanceof Mesh) retained.add(node.geometry) })
  replaced.forEach(geometry => { if (!retained.has(geometry)) geometry.dispose() })
  root.userData.previewPrepared = true
}
