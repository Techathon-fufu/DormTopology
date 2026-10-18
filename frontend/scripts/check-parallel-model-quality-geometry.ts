import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { Box3, Mesh, PlaneGeometry, Raycaster, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { repairClosedShellWinding } from '../src/scene/meshWinding.ts'

const ASSETS = ['cup', 'phone', 'mousepad', 'monitor', 'keyboard', 'mouse', 'tissue_box', 'stainless_bottle', 'books_stack', 'charger'] as const
const EPS = 1e-7
const REPAIRED_CONTACT_ASSETS = new Set(['cup', 'phone', 'mousepad', 'monitor'])

const openSheet = new PlaneGeometry(1, 1)
assert.equal(repairClosedShellWinding(openSheet).geometry, openSheet, 'open/ambiguous imports remain authored')

function triangleKey(points: Vector3[]): string {
  return points
    .map((point) => point.toArray().map((value) => Math.round(value / EPS)).join(','))
    .sort()
    .join('|')
}

for (const id of ASSETS) {
  const bytes = await readFile(`public/models/items/${id}.glb`)
  const { scene } = await new GLTFLoader().parseAsync(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    '',
  )
  scene.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(scene)
  const size = bounds.getSize(new Vector3())
  const center = bounds.getCenter(new Vector3())
  const beforeRay = new Raycaster(new Vector3(center.x, bounds.max.y + size.y, center.z), new Vector3(0, -1, 0))
  const visibleTopBeforeM = beforeRay.intersectObject(scene, true)[0]?.point.y
  const duplicateTriangles: Array<{ mesh: string; count: number }> = []
  const bottomTriangles: Array<{ mesh: string; y: number; normalY: number }> = []
  let flippedComponents = 0
  let flippedTriangles = 0
  let meshCount = 0
  const materials: Array<{ mesh: string; material: string; color?: string; textured: boolean; transparent: boolean }> = []

  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return
    meshCount += 1
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      const candidate = material as typeof material & { color?: { getHexString(): string }; map?: unknown }
      materials.push({
        mesh: node.name,
        material: material.name,
        color: candidate.color ? `#${candidate.color.getHexString()}` : undefined,
        textured: Boolean(candidate.map),
        transparent: material.transparent,
      })
    }
    const geometry = node.geometry
    const position = geometry.getAttribute('position')
    const index = geometry.index
    const count = index?.count ?? position.count
    const seen = new Map<string, number>()
    for (let offset = 0; offset < count; offset += 3) {
      const points = [0, 1, 2].map((corner) => {
        const vertex = index ? index.getX(offset + corner) : offset + corner
        return new Vector3().fromBufferAttribute(position, vertex).applyMatrix4(node.matrixWorld)
      })
      const key = triangleKey(points)
      seen.set(key, (seen.get(key) ?? 0) + 1)
      const minY = Math.min(...points.map((point) => point.y))
      const maxY = Math.max(...points.map((point) => point.y))
      if (Math.abs(minY - bounds.min.y) <= EPS && Math.abs(maxY - bounds.min.y) <= EPS) {
        const normal = points[1].clone().sub(points[0]).cross(points[2].clone().sub(points[0])).normalize()
        bottomTriangles.push({ mesh: node.name, y: minY, normalY: normal.y })
      }
    }
    const duplicateCount = [...seen.values()].reduce((sum, occurrences) => sum + Math.max(0, occurrences - 1), 0)
    if (duplicateCount) duplicateTriangles.push({ mesh: node.name, count: duplicateCount })
    const repair = repairClosedShellWinding(geometry)
    flippedComponents += repair.flippedComponents
    flippedTriangles += repair.flippedTriangles
    node.geometry = repair.geometry
  })

  scene.updateMatrixWorld(true)
  const above = new Raycaster(new Vector3(center.x, bounds.max.y + size.y, center.z), new Vector3(0, -1, 0))
  const below = new Raycaster(new Vector3(center.x, bounds.min.y - size.y, center.z), new Vector3(0, 1, 0))
  const topHit = above.intersectObject(scene, true)[0]
  const bottomHit = below.intersectObject(scene, true)[0]
  assert.ok(topHit && bottomHit, `${id}: vertical rays must hit authored geometry`)
  if (REPAIRED_CONTACT_ASSETS.has(id)) {
    assert.ok(flippedComponents > 0, `${id}: known inward closed shell is repaired`)
    assert.ok(topHit.point.y > bounds.min.y + EPS, `${id}: the visible top ray no longer stops on the table-contact face`)
  }
  console.log(JSON.stringify({
    id,
    meshCount,
    bounds: { min: bounds.min.toArray(), max: bounds.max.toArray(), size: size.toArray() },
    duplicateTriangles,
    materials,
    bottomTriangles,
    closedShellRepair: { flippedComponents, flippedTriangles },
    centerRay: {
      visibleTopBeforeM,
      topY: topHit.point.y,
      topNormalY: topHit.face?.normal.y,
      bottomY: bottomHit.point.y,
      bottomNormalY: bottomHit.face?.normal.y,
    },
  }, null, 2))
}
