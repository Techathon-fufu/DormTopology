import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * 物品预制模型同步（运行：npx tsx scripts/sync-prefab-items.ts）：
 *
 * - 把 `Prefabmodel/*.glb`（12 件桌面物品，清单见 Prefabmodel/prefab_list.txt）复制为运行时副本
 *   `frontend/public/models/items/<id>.glb`（原样复制，不改材质）；
 * - 把 `Prefabmodel/collisionsize/*.collision.json`（底心锚定 compound 碰撞体，schema
 *   dormtopology.colliders/1，单位米、Y 向上）内联生成为
 *   `src/scene/prefabItemCollisions.generated.ts`：物品摆放校验 / 拖拽相交直接采用随包
 *   碰撞数据本地同步计算，不引入运行时 fetch 与加载态。
 *
 * 资产更新后重跑本脚本（物品 GLB 与碰撞数据同时刷新）。
 */

const sourceDir = new URL('../../Prefabmodel/', import.meta.url)
const collisionDir = new URL('collisionsize/', sourceDir)
const outGlbDir = new URL('../public/models/items/', import.meta.url)
const outDataFile = new URL('../src/scene/prefabItemCollisions.generated.ts', import.meta.url)

/** 与 Prefabmodel/prefab_list.txt 对齐的 12 件物品（清单中 laptop_expand 对应文件名 laptop_extend） */
const ITEM_IDS = [
  'books_stack',
  'charger',
  'cup',
  'keyboard',
  'laptop_extend',
  'laptop_fold',
  'monitor',
  'mouse',
  'mousepad',
  'phone',
  'stainless_bottle',
  'tissue_box',
]

interface RawCollision {
  type: string
  parts: Array<{ vertices_m: number[][]; faces: number[][] }>
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6

/** 数值逐个四舍五入到 1e-6（μm 级，远小于生成管线的 1e-7 容差），显著压缩生成文件 */
function roundDeep(value: unknown): unknown {
  if (typeof value === 'number') return round6(value)
  if (Array.isArray(value)) return value.map(roundDeep)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundDeep(item)]))
  }
  return value
}

mkdirSync(outGlbDir, { recursive: true })

let totalVerts = 0
const entries: string[] = []
for (const id of ITEM_IDS) {
  const glb = readFileSync(new URL(`${id}.glb`, sourceDir))
  writeFileSync(new URL(`${id}.glb`, outGlbDir), glb)

  const raw = JSON.parse(readFileSync(new URL(`${id}.collision.json`, collisionDir), 'utf8')) as RawCollision
  if (raw.type !== 'compound' || !Array.isArray(raw.parts) || raw.parts.length === 0) {
    throw new Error(`${id}.collision.json 不是 compound 碰撞体`)
  }
  const minY = Math.min(...raw.parts.flatMap((part) => part.vertices_m.map((vertex) => vertex[1])))
  if (Math.abs(minY) > 0.01) {
    throw new Error(`${id}.collision.json 底面不在 y=0（minY=${minY.toFixed(4)}）；请与模型导出管线确认锚点`)
  }
  totalVerts += raw.parts.reduce((sum, part) => sum + part.vertices_m.length, 0)
  entries.push(`  ${id}: ${JSON.stringify(roundDeep(raw))},`)

  const verts = raw.parts.reduce((sum, part) => sum + part.vertices_m.length, 0)
  console.log(
    `items/${id}.glb ← Prefabmodel/${id}.glb（${(glb.length / 1024).toFixed(1)} KB）；` +
      `碰撞体 ${raw.parts.length} 部件 / ${verts} 顶点`,
  )
}

const moduleSource = `// 由 scripts/sync-prefab-items.ts 生成，请勿手改（重跑脚本刷新）。
// 源数据：Prefabmodel/collisionsize/*.collision.json（schema dormtopology.colliders/1；
// 单位米、Y 向上、底心锚定；数值四舍五入到 1e-6）。
import type { CompoundCollision } from './collisionGeometry'

export const PREFAB_ITEM_COLLISIONS: Record<string, CompoundCollision> = {
${entries.join('\n')}
}
`
writeFileSync(outDataFile, moduleSource)
console.log(`prefabItemCollisions.generated.ts 已生成：${ITEM_IDS.length} 件物品 / ${totalVerts} 顶点`)
