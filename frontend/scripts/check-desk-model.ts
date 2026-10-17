import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStandardRoom } from '../src/data/demoProject'
import { DORM_DESK_MODEL_CONFIG } from '../src/scene/deskModel'

// 桌体 GLB 资产契约检查（Node 解析 GLB 的 JSON chunk，不依赖 three / 浏览器）：
// - 资产存在且为 glTF 2.0；
// - 结构契约：桌面 / 书架 / 三抽屉（含前后板与滑轨，供「抽屉推拉」分离模型复用）/ 立柱等命名节点齐全；
// - 实测包围盒与摆放约定（米制、Y-up、背面 z 最小）；
// - 以与 deskModel 相同的匹配 / 对齐口径复算一遍摆放结果（原点 / 缩放 / 贴墙 / 桌面对齐）。
//
// 用途：资产更新（重新导出）后第一时间发现尺寸、命名或单位变化；失效时更新
// frontend/src/scene/deskModel.ts 的配置并同步 docs/desk-model.md。

const assetUrl = new URL('../public/models/dorm_desk_assembled.glb', import.meta.url)
const buf = readFileSync(assetUrl)
assert.equal(buf.toString('utf8', 0, 4), 'glTF', '资产必须是二进制 glTF（.glb）')
assert.equal(buf.readUInt32LE(4), 2, 'glTF 版本必须为 2')

const totalLength = buf.readUInt32LE(8)
let offset = 12
let json: any = null
while (offset < totalLength) {
  const chunkLen = buf.readUInt32LE(offset)
  const chunkType = buf.toString('utf8', offset + 4, offset + 8)
  const chunk = buf.subarray(offset + 8, offset + 8 + chunkLen)
  if (chunkType === 'JSON') json = JSON.parse(chunk.toString('utf8'))
  offset += 8 + chunkLen
}
assert.ok(json, 'GLB 必须包含 JSON chunk')

const nodes: Array<{ name: string }> = json.nodes ?? []
const nodeNames = nodes.map((n) => (n.name ?? '').trim())
const hasNode = (name: string) => nodeNames.includes(name)

// ── 1. 命名节点契约（抽屉节点按「分离模型」的前后端 / 前坡 / 滑轨拆分保留） ───────
const REQUIRED_NODES = [
  'Desk_Top_Main',
  'Desk_Top_L_Return',
  'Desk_Back_Baffle',
  'Bookshelf_Bottom_Board',
  'Bookshelf_Top_Board',
  'Cabinet_Drawer_Bot_Box',
  'Cabinet_Drawer_Bot_Front',
  'Cabinet_Drawer_Bot_PullGroove',
  'Cabinet_Drawer_Bot_Rail_L',
  'Cabinet_Drawer_Bot_Rail_R',
  'Cabinet_Drawer_Mid_Box',
  'Cabinet_Drawer_Mid_Front',
  'Cabinet_Drawer_Top_Box',
  'Cabinet_Drawer_Top_Front',
  'Cabinet_Top_Panel',
  'Bed_Base_Board',
  'Wardrobe_Solid_Box',
  'Ladder_Rail_L',
  'Guardrail_Front_Top',
  'Pillar_BL',
  'Pillar_BR',
  'Pillar_FL',
  'Pillar_FR',
]
for (const name of REQUIRED_NODES) {
  assert.ok(hasNode(name), `缺少命名节点：${name}`)
}
assert.equal(json.animations?.length ?? 0, 0, '当前模型不应包含动画（抽屉推拉由前端运动学实现）')

// ── 2. 实测包围盒（原始坐标，米） ─────────────────────────────────────────────
function nodeBounds(node: { mesh?: number }): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of (json.meshes[node.mesh!]?.primitives ?? []) as any[]) {
    const acc = json.accessors?.[p.attributes?.POSITION]
    if (!acc?.min || !acc?.max) continue
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], acc.min[k])
      max[k] = Math.max(max[k], acc.max[k])
    }
  }
  return { min, max }
}
const boundsOf = (name: string) => nodeBounds(nodes[nodeNames.indexOf(name)]!)

let gMin = [Infinity, Infinity, Infinity]
let gMax = [-Infinity, -Infinity, -Infinity]
for (const [, node] of (json.nodes ?? []).entries()) {
  if (node.mesh == null) continue
  const b = nodeBounds(node)
  for (let k = 0; k < 3; k++) {
    gMin[k] = Math.min(gMin[k], b.min[k])
    gMax[k] = Math.max(gMax[k], b.max[k])
  }
}
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol
assert.ok(near(gMin[0], 0) && near(gMax[0], 2), `整体宽度应为 2.0m（实测 x [${gMin[0]}, ${gMax[0]}]）`)
assert.ok(near(gMin[1], 0) && near(gMax[1], 2.25), `整体高度应为 2.25m（实测 y [${gMin[1]}, ${gMax[1]}]）`)
assert.ok(near(gMin[2], -0.9) && near(gMax[2], 0.31), `整体进深应为 1.21m（实测 z [${gMin[2]}, ${gMax[2]}]）`)
const deskTopRaw = Math.max(boundsOf('Desk_Top_Main').max[1], boundsOf('Desk_Top_L_Return').max[1])
assert.ok(near(deskTopRaw, 0.77), `桌面标称高度应为 0.77m（实测 ${deskTopRaw}）`)

// ── 3. 锚点匹配复算（与 extractDeskAnchors 相同的大小写不敏感子串语义） ──────────
const patterns = DORM_DESK_MODEL_CONFIG.anchorPatterns
const hit = (name: string, list: string[]) =>
  list.some((p) => name.toLowerCase().includes(p.toLowerCase()))
const matches = { deskTop: [] as string[], shelf: [] as string[], cableHole: [] as string[] }
for (const raw of nodeNames) {
  if (raw.length === 0) continue
  const isDeskTop = hit(raw, patterns.deskTop)
  const isShelf = !isDeskTop && hit(raw, patterns.shelf)
  const isHole = !isDeskTop && !isShelf && hit(raw, patterns.cableHole)
  if (isDeskTop) matches.deskTop.push(raw)
  else if (isShelf) matches.shelf.push(raw)
  else if (isHole) matches.cableHole.push(raw)
}
assert.deepEqual(
  matches.deskTop.sort(),
  ['Desk_Top_L_Return', 'Desk_Top_Main'].sort(),
  '桌面锚点应只匹配主桌面与 L 形回台',
)
assert.equal(matches.shelf.length, 0, '书架锚点应刻意为空（上层四格书架与配置层书架支撑面不同，见配置注释）')
assert.equal(matches.cableHole.length, 0, '出线孔锚点不应误匹配（如 Cabinet_Lock_Keyhole）')

// ── 4. 摆放复算（与 normalizeDeskModel 相同口径；当前配置：无缩放 / 无旋转） ─────
const config = DORM_DESK_MODEL_CONFIG
assert.equal(config.unitScale, 1, '单位换算应为 1（模型已是米制）')
assert.equal(config.axisRotationY, 0, '不应有轴校正（已是 Y-up、正面朝 +z）')
assert.equal(config.fitWidthM, null, '固定模型不做等比缩放')
assert.equal(config.backWallZ, 0, '整组家具背面应贴后墙 z = 0')
assert.equal(config.verticalAlign, 'deskTop', '竖向应把桌面锚点对齐到逻辑桌面高度')

const room = createStandardRoom()
// verticalAlign='deskTop'：模型整体平移 room.desk.height - deskTopRaw
const shiftY = room.desk.height - deskTopRaw
assert.ok(near(shiftY, -0.02), `桌面对齐平移应为约 -0.02m（实测 ${shiftY}）`)
assert.equal(room.desk.height, 0.75, '逻辑桌面高度应为 750mm')
// 对齐后：桌面 = 逻辑高度；底脚轻微下沉（藏在 2cm 厚地面内）
assert.ok(near(deskTopRaw + shiftY, room.desk.height), '对齐后桌面应等于 room.desk.height')
const minYAfter = gMin[1] + shiftY
assert.ok(minYAfter <= 0 && minYAfter > -0.03, `底脚下沉量应不超过 3cm（实测 ${minYAfter}）`)
// x 居中：原始 [0, 2] → 平移 -1；z 贴墙：原始 [-0.9, 0.31] → 平移 +0.9
assert.ok(near(gMax[0] - gMin[0], 2), '居中平移不改变宽度')
const zAfterMin = gMin[2] + 0.9
assert.ok(near(zAfterMin, 0), '背面（最小 z）应贴在 z = 0')
const deskFrontAfter = boundsOf('Desk_Top_Main').max[2] + 0.9
assert.ok(near(deskFrontAfter, 0.61), `主桌面前沿应距后墙约 0.61m（实测 ${deskFrontAfter}）`)
const heightAfter = gMax[1] + shiftY
assert.ok(heightAfter < room.height - 0.2, `模型总高（${heightAfter.toFixed(3)}m）应明显低于房间高度`)

console.log(
  'Desk model checks passed: glTF 2.0, 23 required nodes (incl. 3 drawers with fronts/rails), ' +
    'bounds 2.0×2.25×1.21m, anchors deskTop only (shelf/keyhole excluded), ' +
    'placement recomputed (back at z=0, desk top = 0.75m, feet sink ≤ 3cm).',
)
