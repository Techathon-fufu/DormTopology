import { Box3, Vector3, type BufferGeometry, type Object3D, Mesh } from 'three'

export interface WindingRepair {
  geometry: BufferGeometry
  flippedComponents: number
  flippedTriangles: number
}

/**
 * Repair inward-facing CLOSED, consistently wound shells independently. A merged
 * mesh may contain a correctly wound screen and an inverted base. Open sheets and
 * non-manifold components have no reliable inside/outside and are left authored.
 */
export function repairClosedShellWinding(source: BufferGeometry): WindingRepair {
  const position = source.getAttribute('position')
  const index = source.index
  const count = index?.count ?? position?.count ?? 0
  const unchanged = { geometry: source, flippedComponents: 0, flippedTriangles: 0 }
  if (!position || count % 3 || Object.keys(source.morphAttributes).length) return unchanged
  const triangleCount = count / 3
  const parent = Array.from({ length: triangleCount }, (_, i) => i)
  const find = (value: number): number => {
    let root = value
    while (parent[root] !== root) root = parent[root]
    while (parent[value] !== value) { const next = parent[value]; parent[value] = root; value = next }
    return root
  }
  const edges = new Map<string, { faces: number[]; direction: number }>()
  const ids = Array.from({ length: count }, (_, i) => index ? index.getX(i) : i)
  const points = Array.from({ length: position.count }, (_, i) => new Vector3().fromBufferAttribute(position, i))
  // Weld only for topology analysis, keeping authored vertices/normals/UVs intact.
  const tolerance = 1e-7
  const keys = points.map(p => p.toArray().map(v => Math.round(v / tolerance)).join(','))
  for (let face = 0; face < triangleCount; face++) {
    const vertices = ids.slice(face * 3, face * 3 + 3).map(i => keys[i])
    for (let edge = 0; edge < 3; edge++) {
      const a = vertices[edge], b = vertices[(edge + 1) % 3]
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      const entry = edges.get(key) ?? { faces: [], direction: 0 }
      if (entry.faces.length) parent[find(face)] = find(entry.faces[0])
      entry.faces.push(face)
      entry.direction += a < b ? 1 : a > b ? -1 : 0
      edges.set(key, entry)
    }
  }
  const components = new Map<number, { faces: number[]; closed: boolean; volume: number }>()
  const bounds = new Box3().setFromPoints(points)
  const origin = bounds.getCenter(new Vector3())
  for (let face = 0; face < triangleCount; face++) {
    const root = find(face)
    const entry = components.get(root) ?? { faces: [], closed: true, volume: 0 }
    const [a, b, c] = ids.slice(face * 3, face * 3 + 3).map(i => points[i].clone().sub(origin))
    entry.faces.push(face)
    entry.volume += a.dot(b.cross(c)) / 6
    components.set(root, entry)
  }
  for (const edge of edges.values()) {
    if (edge.faces.length !== 2 || edge.direction !== 0) components.get(find(edge.faces[0]))!.closed = false
  }
  const size = bounds.getSize(new Vector3())
  const volumeTolerance = Math.max(1e-18, size.x * size.y * size.z * 1e-9)
  const inverted = [...components.values()].filter(c => c.closed && c.volume < -volumeTolerance)
  if (!inverted.length) return unchanged

  // Index each authored vertex (including non-indexed flat shading/UV seams)
  // exactly as before; only swap the last two indices of inward triangles.
  const next = [...ids]
  for (const component of inverted) for (const face of component.faces) {
    const offset = face * 3
    ;[next[offset + 1], next[offset + 2]] = [next[offset + 2], next[offset + 1]]
  }
  const geometry = source.clone()
  geometry.setIndex(next)
  geometry.computeVertexNormals()
  return { geometry, flippedComponents: inverted.length, flippedTriangles: inverted.reduce((n, c) => n + c.faces.length, 0) }
}

/** Runtime display copy only; preserve library files and all collision/port data. */
export function repairPrefabWinding(root: Object3D): void {
  const replacements = new Map<BufferGeometry, WindingRepair>()
  root.traverse(node => {
    if (!(node instanceof Mesh)) return
    let repair = replacements.get(node.geometry)
    if (!repair) {
      repair = repairClosedShellWinding(node.geometry)
      replacements.set(node.geometry, repair)
    }
    node.geometry = repair.geometry
  })
  replacements.forEach((repair, source) => { if (repair.geometry !== source) source.dispose() })
}
