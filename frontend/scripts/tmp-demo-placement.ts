// 临时探针：示例场景摆放一致性（真实预制碰撞 + 当前支撑面口径）。
// 用后删除。运行：npx tsx scripts/tmp-demo-placement.ts
import { createDemoProject } from '../src/data/demoProject'
import { validateScene } from '../src/scene/sceneValidation'
import type { DeskSurfaceMetrics } from '../src/scene/deskModel'

const project = createDemoProject()

const args = process.argv.slice(2)
let metrics: DeskSurfaceMetrics | null = null
if (args.includes('--model-metrics')) {
  // 与浏览器同一归一化流程：离线加载桌体 GLB → 实测锚点
  const { readFileSync } = await import('node:fs')
  const THREE = await import('three')
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const { DORM_DESK_MODEL_CONFIG, mountDeskModel } = await import('../src/scene/deskModel')
  const buf = readFileSync(new URL('../public/models/dorm_desk_body.glb', import.meta.url))
  const gltf = await new Promise<any>((resolve, reject) =>
    new GLTFLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', resolve, reject),
  )
  const mounted = mountDeskModel(gltf.scene as THREE.Group, DORM_DESK_MODEL_CONFIG, project.room)
  metrics = mounted.metrics
  console.log('实测 metrics:', JSON.stringify(metrics))
}

const issues = validateScene(project.objects, project.room, metrics)
for (const object of project.objects) {
  const list = issues.get(object.id)
  if (list) console.log(object.id.padEnd(22), list.map((i) => `${i.type}｜${i.message}`).join(' ／ '))
}
console.log(`—— 共 ${project.objects.length} 件，${issues.size} 件有问题`)
