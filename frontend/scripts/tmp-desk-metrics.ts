// 临时探针：桌体真实几何测量（app 坐标口径，与运行时同一归一化流程）。
// 用后删除。运行：npx tsx scripts/tmp-desk-metrics.ts
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { createStandardRoom } from '../src/data/demoProject'
import { DORM_DESK_MODEL_CONFIG, mountDeskModel } from '../src/scene/deskModel'

const room = createStandardRoom()

async function loadGlb(relative: string): Promise<THREE.Group> {
  const buf = readFileSync(new URL(relative, import.meta.url))
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return new Promise((resolve, reject) =>
    new GLTFLoader().parse(arrayBuffer as ArrayBuffer, '', (g) => resolve(g.scene as THREE.Group), reject),
  )
}

function bboxOf(root: THREE.Object3D): THREE.Box3 {
  root.updateMatrixWorld(true)
  return new THREE.Box3().setFromObject(root)
}

function fmt(b: THREE.Box3): string {
  const f = (v: number) => v.toFixed(3)
  return `x[${f(b.min.x)},${f(b.max.x)}] y[${f(b.min.y)},${f(b.max.y)}] z[${f(b.min.z)},${f(b.max.z)}]`
}

function collideBoundsOfJson(path: string): Array<{ min: THREE.Vector3; max: THREE.Vector3 }> {
  const data = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
    parts: Array<{ vertices_m: number[][] }>
  }
  return data.parts.map((part) => {
    const b = new THREE.Box3()
    for (const v of part.vertices_m) b.expandByPoint(new THREE.Vector3(v[0], v[1], v[2]))
    return { min: b.min, max: b.max }
  })
}

// ── 桌体 ─────────────────────────────────────────────────────────────────────
const body = await loadGlb('../public/models/dorm_desk_body.glb')
const mounted = mountDeskModel(body, DORM_DESK_MODEL_CONFIG, room)
console.log('== 归一化结果 ==')
console.log('deskTopY', mounted.metrics.deskTopY, 'shelfTopY', mounted.metrics.shelfTopY, 'source', mounted.metrics.source)
console.log('measured', JSON.stringify(mounted.metrics.measured))
console.log('anchors', JSON.stringify(mounted.metrics.anchors))
console.log('body.position', JSON.stringify(body.position), 'scale', body.scale.x)

console.log('== 命名节点包围盒（app） ==')
const bodyNames: string[] = []
body.traverse((node) => {
  const name = node.name.trim()
  if (!name || !(node as THREE.Mesh).isMesh) return
  bodyNames.push(name)
  const b = bboxOf(node)
  console.log(name.padEnd(38), fmt(b))
})

console.log('== 46 碰撞部件（app，匹配节点名） ==')
const bodyParts = collideBoundsOfJson('../../Prefabmodel/dormdesk_parts/dormdesk_body.collision.json')
bodyParts.forEach((part, index) => {
  const b = new THREE.Box3(part.min.clone().applyMatrix4(body.matrix), part.max.clone().applyMatrix4(body.matrix))
  const name =
    bodyNames.find((n) => {
      const mesh = body.getObjectByName(n)!
      const nb = bboxOf(mesh)
      return (
        Math.abs(nb.min.x - b.min.x) < 1e-4 &&
        Math.abs(nb.max.x - b.max.x) < 1e-4 &&
        Math.abs(nb.min.y - b.min.y) < 1e-4 &&
        Math.abs(nb.max.y - b.max.y) < 1e-4 &&
        Math.abs(nb.min.z - b.min.z) < 1e-4 &&
        Math.abs(nb.max.z - b.max.z) < 1e-4
      )
    }) ?? '?'
  console.log(String(index).padStart(2), name.padEnd(38), fmt(b))
})

// ── 抽屉 ─────────────────────────────────────────────────────────────────────
for (const slot of ['bottom', 'middle', 'top'] as const) {
  const drawer = await loadGlb(`../public/models/dorm_desk_drawer_${slot}.glb`)
  console.log(`== 抽屉 ${slot}（raw → app） ==`)
  drawer.traverse((node) => {
    const name = node.name.trim()
    if (!name || !(node as THREE.Mesh).isMesh) return
    const raw = bboxOf(node)
    const app = new THREE.Box3(raw.min.clone().applyMatrix4(body.matrix), raw.max.clone().applyMatrix4(body.matrix))
    console.log(name.padEnd(20), 'raw', fmt(raw), ' app', fmt(app))
  })
  const parts = collideBoundsOfJson(`../../Prefabmodel/dormdesk_parts/drawer_${slot}.collision.json`)
  console.log(`  collision parts: ${parts.length}`)
  parts.forEach((part, index) => {
    const b = new THREE.Box3(part.min.clone().applyMatrix4(body.matrix), part.max.clone().applyMatrix4(body.matrix))
    console.log('  ', String(index).padStart(2), fmt(b))
  })
}
