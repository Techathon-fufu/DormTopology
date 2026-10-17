import { readFileSync, writeFileSync } from 'node:fs'

/**
 * 桌体分离件同步（运行：npx tsx scripts/sync-desk-parts.ts）：
 *
 * - 把 `Prefabmodel/dormdesk_parts/` 的桌体与三只抽屉复制为运行时副本
 *   （`frontend/public/models/dorm_desk_body.glb` + `dorm_desk_drawer_{bottom,middle,top}.glb`）；
 * - 上游导出的抽屉 GLB **不含材质**（直接加载会渲染为默认白色）：从整装源
 *   `Prefabmodel/dormdesk.glb` 复制材质定义，并按节点名恢复分配——
 *   盒体 = 松木 / 面板 = 暖橡木 / 拉手槽与锁孔 = 深木 / 滑轨与锁片 = 金属；
 * - 几何数据（BIN chunk）原样保留，仅重写 JSON chunk。
 *
 * 资产更新后重跑本脚本，再运行 `npx tsx scripts/check-desk-model.ts` 校验契约。
 */

const sourceDir = new URL('../../Prefabmodel/', import.meta.url)
const outDir = new URL('../public/models/', import.meta.url)

interface GlbChunks {
  json: Record<string, unknown>
  bin: Buffer
}

function parseGlb(url: URL): GlbChunks {
  const buf = readFileSync(url)
  if (buf.toString('utf8', 0, 4) !== 'glTF') throw new Error(`${url.pathname} 不是二进制 glTF`)
  const total = buf.readUInt32LE(8)
  let offset = 12
  let json: Record<string, unknown> | null = null
  let bin = Buffer.alloc(0)
  while (offset < total) {
    const len = buf.readUInt32LE(offset)
    const type = buf.toString('utf8', offset + 4, offset + 8)
    const chunk = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8')) as Record<string, unknown>
    else if (type === 'BIN\0') bin = Buffer.from(chunk)
    offset += 8 + len
  }
  if (!json) throw new Error(`${url.pathname} 缺少 JSON chunk`)
  return { json, bin }
}

function serializeGlb(json: Record<string, unknown>, bin: Buffer): Buffer {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)])
  const binPad = (4 - (bin.length % 4)) % 4
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad, 0)])
  const total = 12 + 8 + jsonChunk.length + 8 + binChunk.length
  const out = Buffer.alloc(total)
  out.write('glTF', 0, 'latin1')
  out.writeUInt32LE(2, 4)
  out.writeUInt32LE(total, 8)
  let offset = 12
  out.writeUInt32LE(jsonChunk.length, offset)
  out.write('JSON', offset + 4, 'latin1')
  jsonChunk.copy(out, offset + 8)
  offset += 8 + jsonChunk.length
  out.writeUInt32LE(binChunk.length, offset)
  out.writeUInt32LE(0x004e4942, offset + 4) // "BIN\0"
  binChunk.copy(out, offset + 8)
  return out
}

// ── 材质：从整装源提取（顺序 = 抽屉文件内索引 0..3） ─────────────────────────
const MATERIAL_NAMES = ['Mat_Pine_Natural', 'Mat_Warm_Oak', 'Mat_Dark_Wood', 'Mat_Metal_Hardware']
const assembled = parseGlb(new URL('dormdesk.glb', sourceDir))
const sourceMaterials = (assembled.json.materials ?? []) as Array<{ name?: string }>
const materials = MATERIAL_NAMES.map((name) => {
  const found = sourceMaterials.find((m) => m.name === name)
  if (!found) throw new Error(`整装源缺少材质：${name}`)
  return JSON.parse(JSON.stringify(found)) as Record<string, unknown>
})

/** 节点名 → 材质索引（与整装模型的分配一致） */
const MATERIAL_INDEX_BY_PART: Array<[RegExp, number]> = [
  [/^(floor|wall_)/, 0],
  [/^front$/, 1],
  [/^pull$/, 2],
  [/^rail_/, 3],
  [/^lock_keyhole$/, 2],
  [/^lock_plate$/, 3],
]

function patchDrawer(json: Record<string, unknown>, file: string): void {
  json.materials = materials
  const nodes = (json.nodes ?? []) as Array<{ name?: string; mesh?: number }>
  const meshes = (json.meshes ?? []) as Array<{ primitives?: Array<{ material?: number }> }>
  for (const node of nodes) {
    if (node.mesh == null) continue
    const name = (node.name ?? '').trim()
    const rule = MATERIAL_INDEX_BY_PART.filter(([pattern]) => pattern.test(name))
    if (rule.length !== 1) throw new Error(`${file}: 节点 ${name} 的材质规则命中 ${rule.length} 条`)
    for (const primitive of meshes[node.mesh]?.primitives ?? []) primitive.material = rule[0][1]
  }
}

// ── 桌体：原样复制 ───────────────────────────────────────────────────────────
const body = readFileSync(new URL('dormdesk_parts/dormdesk_body.glb', sourceDir))
writeFileSync(new URL('dorm_desk_body.glb', outDir), body)
console.log('dorm_desk_body.glb ← dormdesk_parts/dormdesk_body.glb（原样）')

// ── 抽屉：复制 + 材质注入 ────────────────────────────────────────────────────
const DRAWER_FILES: Array<[string, string]> = [
  ['dormdesk_parts/drawer_bottom.glb', 'dorm_desk_drawer_bottom.glb'],
  ['dormdesk_parts/drawer_middle.glb', 'dorm_desk_drawer_middle.glb'],
  ['dormdesk_parts/drawer_top.glb', 'dorm_desk_drawer_top.glb'],
]
for (const [source, target] of DRAWER_FILES) {
  const { json, bin } = parseGlb(new URL(source, sourceDir))
  patchDrawer(json, source)
  writeFileSync(new URL(target, outDir), serializeGlb(json, bin))
  console.log(`${target} ← ${source}（注入 ${materials.length} 个材质并按节点名分配）`)
}

// ── 回读校验：材质必须已写入 ─────────────────────────────────────────────────
for (const [, target] of DRAWER_FILES) {
  const { json } = parseGlb(new URL(target, outDir))
  const mats = (json.materials ?? []) as Array<{ name?: string }>
  if (mats.length !== MATERIAL_NAMES.length) throw new Error(`${target} 材质数量异常`)
  let assigned = 0
  for (const node of (json.nodes ?? []) as Array<{ mesh?: number }>) {
    if (node.mesh == null) continue
    for (const primitive of (((json.meshes ?? []) as any[])[node.mesh].primitives ?? []) as Array<{ material?: number }>) {
      if (primitive.material == null) throw new Error(`${target} 存在未分配材质的 primitive`)
      assigned += 1
    }
  }
  console.log(`${target} 校验通过（${mats.length} 材质 / ${assigned} 个 primitive 已分配）`)
}
