import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createStandardRoom } from '../src/data/demoProject'
import { DORM_DESK_MODEL_CONFIG } from '../src/scene/deskModel'
import {
  advanceDrawerProgress,
  clampDrawerProgress,
  DORM_DESK_DRAWERS,
  DRAWER_SLIDE_DIRECTION_X,
  drawerSlideX,
  snapDrawerTarget,
} from '../src/scene/dormDeskDrawers'

// 桌体分离件资产契约检查（Node 解析 GLB 的 JSON chunk，不依赖 three / 浏览器）：
// - 桌体（无抽屉桌体 dormdesk_parts/dormdesk_body.glb）与三只抽屉分离件存在且为 glTF 2.0；
// - 桌体：抽屉 / 锁件必须已拆分（Prefabmodel 清单的 removed_parts 不得残留）、
//   kept_parts 命名节点齐全；实测包围盒与摆放约定（米制、Y-up、背面 z 最小）；
// - 抽屉：部件齐全（盒体 / 面板 / 拉手槽 / 滑轨，上层含锁件）、材质按节点名分配
//   （sync-desk-parts.ts 注入）、前板位于滑出侧（-x）、包围盒与 Prefabmodel 清单一致；
// - 以与 deskModel 相同的匹配 / 对齐口径复算摆放结果；
// - 行程 / 吸附 / 缓动纯函数边界断言（与 useDrawerInteraction / DormDeskModel 同口径）。
//
// 运行时资产位于 public/models/dormdesk_parts/（canonical main paths）；清单仍源自
// Prefabmodel/dormdesk_parts/。资产更新（重新导出 / 重跑 sync-desk-parts.ts）后第一
// 时间发现尺寸、命名、材质或单位变化；失效时更新 frontend/src/scene/deskModel.ts /
// dormDeskDrawers.ts 的配置并同步 docs/desk-model.md、docs/drawer-interaction.md。

interface GlbChunks {
  json: any
}

function parseGlb(url: URL): GlbChunks {
  const buf = readFileSync(url)
  assert.equal(buf.toString('utf8', 0, 4), 'glTF', `${url.pathname} 必须是二进制 glTF（.glb）`)
  assert.equal(buf.readUInt32LE(4), 2, `${url.pathname} glTF 版本必须为 2`)
  const total = buf.readUInt32LE(8)
  let offset = 12
  let json: any = null
  while (offset < total) {
    const len = buf.readUInt32LE(offset)
    const type = buf.toString('utf8', offset + 4, offset + 8)
    const chunk = buf.subarray(offset + 8, offset + 8 + len)
    if (type === 'JSON') json = JSON.parse(chunk.toString('utf8'))
    offset += 8 + len
  }
  assert.ok(json, `${url.pathname} 必须包含 JSON chunk`)
  return { json }
}

function nodeBounds(json: any, node: { mesh?: number }): { min: number[]; max: number[] } {
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

function globalBounds(json: any): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const node of (json.nodes ?? []) as any[]) {
    if (node.mesh == null) continue
    const b = nodeBounds(json, node)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.min[k])
      max[k] = Math.max(max[k], b.max[k])
    }
  }
  return { min, max }
}

const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol

// ── 1. 桌体（无抽屉桌体）：拆分契约 + 命名节点 + 包围盒 ─────────────────────────
const partsDir = new URL('../../Prefabmodel/dormdesk_parts/', import.meta.url)
const bodyManifest = JSON.parse(readFileSync(new URL('dormdesk_body.manifest.json', partsDir), 'utf8'))
const bodyJson = parseGlb(new URL('../public/models/dormdesk_parts/dormdesk_body.glb', import.meta.url)).json

const bodyNames: string[] = (bodyJson.nodes ?? []).map((n: any) => (n.name ?? '').trim())
const bodyNameSet = new Set(bodyNames)
assert.equal(bodyNames.length, 46, `桌体节点数应为 46（实测 ${bodyNames.length}）`)
for (const name of bodyManifest.kept_parts as string[]) {
  assert.ok(bodyNameSet.has(name), `桌体缺少清单保留部件：${name}`)
}
for (const name of bodyManifest.removed_parts as string[]) {
  assert.ok(!bodyNameSet.has(name), `抽屉 / 锁件未拆分，桌体仍含：${name}`)
}
assert.equal(bodyJson.animations?.length ?? 0, 0, '桌体不应包含动画（抽屉推拉由前端运动学实现）')

const bodyBounds = globalBounds(bodyJson)
assert.ok(near(bodyBounds.min[0], 0) && near(bodyBounds.max[0], 2), `桌体整体宽度应为 2.0m（实测 x [${bodyBounds.min[0]}, ${bodyBounds.max[0]}]）`)
assert.ok(near(bodyBounds.min[1], 0) && near(bodyBounds.max[1], 2.25), `桌体整体高度应为 2.25m（实测 y [${bodyBounds.min[1]}, ${bodyBounds.max[1]}]）`)
assert.ok(near(bodyBounds.min[2], -0.9) && near(bodyBounds.max[2], 0.31), `桌体整体进深应为 1.21m（实测 z [${bodyBounds.min[2]}, ${bodyBounds.max[2]}]）`)

const bodyBoundsOf = (name: string) => nodeBounds(bodyJson, bodyJson.nodes[bodyNames.indexOf(name)])
const deskTopRaw = Math.max(bodyBoundsOf('Desk_Top_Main_Mesh').max[1], bodyBoundsOf('Desk_Top_L_Return_Mesh').max[1])
assert.ok(near(deskTopRaw, 0.77), `桌面标称高度应为 0.77m（实测 ${deskTopRaw}）`)

// ── 2. 锚点匹配复算（与 extractDeskAnchors 相同的大小写不敏感子串语义） ──────────
const patterns = DORM_DESK_MODEL_CONFIG.anchorPatterns
const hit = (name: string, list: string[]) =>
  list.some((p) => name.toLowerCase().includes(p.toLowerCase()))
const matches = { deskTop: [] as string[], shelf: [] as string[], cableHole: [] as string[] }
for (const raw of bodyNames) {
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
  ['Desk_Top_L_Return_Mesh', 'Desk_Top_Main_Mesh'].sort(),
  '桌面锚点应只匹配主桌面与 L 形回台',
)
assert.equal(matches.shelf.length, 0, '书架锚点应刻意为空（上层四格书架与配置层书架支撑面不同，见配置注释）')
assert.equal(matches.cableHole.length, 0, '出线孔锚点不应误匹配（锁件已移至上层抽屉）')

// ── 3. 摆放复算（与 normalizeDeskModel 相同口径；当前配置：无缩放 / 无旋转） ─────
const config = DORM_DESK_MODEL_CONFIG
assert.equal(config.url, 'models/dormdesk_parts/dormdesk_body.glb', '桌体运行时路径应为无抽屉桌体')
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
assert.ok(near(deskTopRaw + shiftY, room.desk.height), '对齐后桌面应等于 room.desk.height')
const minYAfter = bodyBounds.min[1] + shiftY
assert.ok(minYAfter <= 0 && minYAfter > -0.03, `底脚下沉量应不超过 3cm（实测 ${minYAfter}）`)
// x 居中：原始 [0, 2] → 平移 -1；z 贴墙：原始 [-0.9, 0.31] → 平移 +0.9
assert.ok(near(bodyBounds.max[0] - bodyBounds.min[0], 2), '居中平移不改变宽度')
const zAfterMin = bodyBounds.min[2] + 0.9
assert.ok(near(zAfterMin, 0), '背面（最小 z）应贴在 z = 0')
const deskFrontAfter = bodyBoundsOf('Desk_Top_Main_Mesh').max[2] + 0.9
assert.ok(near(deskFrontAfter, 0.61), `主桌面前沿应距后墙约 0.61m（实测 ${deskFrontAfter}）`)
const heightAfter = bodyBounds.max[1] + shiftY
assert.ok(heightAfter < room.height - 0.2, `模型总高（${heightAfter.toFixed(3)}m）应明显低于房间高度`)

// ── 4. 抽屉分离件：清单一致性 + 部件 / 材质 / 滑出侧 ────────────────────────────
const drawerManifest = JSON.parse(readFileSync(new URL('drawers.manifest.json', partsDir), 'utf8'))
assert.equal(drawerManifest.pull_axis, '-x', '清单滑出方向应为 -x')
assert.equal(DRAWER_SLIDE_DIRECTION_X, -1, '运行时滑出方向应为 -x（与清单一致）')
assert.deepEqual(
  DORM_DESK_DRAWERS.map((d) => d.id),
  ['bot', 'mid', 'top'],
  '运行时抽屉清单应覆盖下 / 中 / 上层三只',
)

const CABINET_Z = { min: -0.78, max: -0.04 } // 柜体进深范围（原始坐标）
const MATERIAL_NAMES = ['Mat_Pine_Natural', 'Mat_Warm_Oak', 'Mat_Dark_Wood', 'Mat_Metal_Hardware']
const DRAWER_FILES: Array<{ id: string; file: string; extraParts: string[] }> = [
  { id: 'drawer_bottom.glb', file: 'drawer_bottom.glb', extraParts: [] },
  { id: 'drawer_middle.glb', file: 'drawer_middle.glb', extraParts: [] },
  { id: 'drawer_top.glb', file: 'drawer_top.glb', extraParts: ['lock_keyhole', 'lock_plate'] },
]
const EXPECTED_MATERIAL_BY_PART: Array<[RegExp, string]> = [
  [/^(floor|wall_)/, 'Mat_Pine_Natural'],
  [/^front$/, 'Mat_Warm_Oak'],
  [/^pull$/, 'Mat_Dark_Wood'],
  [/^rail_/, 'Mat_Metal_Hardware'],
  [/^lock_keyhole$/, 'Mat_Dark_Wood'],
  [/^lock_plate$/, 'Mat_Metal_Hardware'],
]

for (const spec of DORM_DESK_DRAWERS) {
  const entry = DRAWER_FILES.find((f) => f.id === `drawer_${spec.id === 'bot' ? 'bottom' : spec.id === 'mid' ? 'middle' : 'top'}.glb`)
  assert.ok(entry, `抽屉清单缺少对应文件：${spec.id}`)
  const file = entry!
  assert.equal(spec.url, `models/dormdesk_parts/${file.file}`, `运行时路径应为 models/dormdesk_parts/${file.file}`)
  assert.equal(spec.travelM, 0.3, '行程应为 0.30m（见配置注释：盒体 0.304 − 面板 0.018 − 2cm 余量）')

  const json = parseGlb(new URL(`../public/models/dormdesk_parts/${file.file}`, import.meta.url)).json
  const names: string[] = (json.nodes ?? []).map((n: any) => (n.name ?? '').trim())
  const requiredParts = ['floor', 'wall_x0', 'wall_x1', 'wall_z0', 'wall_z1', 'front', 'pull', 'rail_l', 'rail_r', ...file.extraParts]
  assert.deepEqual([...names].sort(), [...requiredParts].sort(), `${file.file} 部件命名应为盒体 / 面板 / 拉手槽 / 滑轨${file.extraParts.length ? ' + 锁件' : ''}`)
  assert.equal(json.animations?.length ?? 0, 0, `${file.file} 不应包含动画`)

  // 材质：4 个定义齐全，且每个 primitive 按节点名分配正确
  const materialNames = (json.materials ?? []).map((m: any) => m.name)
  assert.deepEqual(materialNames, MATERIAL_NAMES, `${file.file} 材质定义应齐全（sync-desk-parts.ts 注入）`)
  for (const node of (json.nodes ?? []) as any[]) {
    if (node.mesh == null) continue
    const rules = EXPECTED_MATERIAL_BY_PART.filter(([pattern]) => pattern.test(node.name))
    assert.equal(rules.length, 1, `${file.file} 节点 ${node.name} 应恰好命中 1 条材质规则`)
    for (const primitive of (json.meshes[node.mesh]?.primitives ?? []) as any[]) {
      assert.equal(materialNames[primitive.material], rules[0][1], `${file.file} 节点 ${node.name} 材质分配错误`)
    }
  }

  // 包围盒与 Prefabmodel 清单一致（同一建模坐标系，未施加平移）
  const expected = drawerManifest.models[file.id]
  assert.equal(expected.pull_axis, '-x')
  assert.equal(expected.shift_applied, false)
  const bounds = globalBounds(json)
  for (let k = 0; k < 3; k++) {
    assert.ok(near(bounds.min[k], expected.bounds_min[k], 0.005), `${file.file} 包围盒 min[${k}] 与清单不一致（实测 ${bounds.min[k]}，清单 ${expected.bounds_min[k]}）`)
    assert.ok(near(bounds.max[k], expected.bounds_max[k], 0.005), `${file.file} 包围盒 max[${k}] 与清单不一致（实测 ${bounds.max[k]}，清单 ${expected.bounds_max[k]}）`)
  }
  // 前板 / 拉手槽位于滑出侧（-x），盒体进深决定行程上限
  const boundsOf = (name: string) => nodeBounds(json, json.nodes[names.indexOf(name)])
  const front = boundsOf('front')
  assert.ok(front.max[0] < bounds.min[0] + 0.05, `${file.file} 前板应位于 x 最小侧（滑出方向 -x）`)
  const boxSpanX = boundsOf('rail_l').max[0] - boundsOf('rail_l').min[0]
  assert.ok(near(boxSpanX, 0.304, 0.005), `${file.file} 盒体沿滑出轴长度应为约 0.304m（实测 ${boxSpanX}）`)
  assert.ok(spec.travelM <= boxSpanX && boxSpanX - spec.travelM <= 0.01, `${file.file} 行程应不超过盒体长度且留有余量`)
  // 抽屉进深应落在柜体范围内
  assert.ok(bounds.min[2] >= CABINET_Z.min - 0.01 && bounds.max[2] <= CABINET_Z.max + 0.01, `${file.file} 进深应落在柜体范围内`)
}

// ── 5. 行程 / 吸附 / 缓动纯函数（与交互实现同口径） ─────────────────────────────
assert.equal(clampDrawerProgress(-0.5), 0, 'progress 下界钳制')
assert.equal(clampDrawerProgress(1.5), 1, 'progress 上界钳制')
assert.equal(clampDrawerProgress(Number.NaN), 0, '非有限值按 0 处理')
assert.equal(snapDrawerTarget(0.49), 0, 'progress < 0.5 吸附到全关')
assert.equal(snapDrawerTarget(0.5), 1, 'progress ≥ 0.5 吸附到全开')
assert.ok(Math.abs(drawerSlideX(0.3, 0) - 0) < 1e-9, '全闭偏移应为 0')
assert.ok(Math.abs(drawerSlideX(0.3, 0.5) + 0.15) < 1e-9, '半开偏移应为 -0.15m（沿 -x）')
assert.ok(Math.abs(drawerSlideX(0.3, 1) + 0.3) < 1e-9, '全开偏移应为 -0.30m（沿 -x）')
assert.ok(Math.abs(drawerSlideX(0.3, 2) + 0.3) < 1e-9, '越界 progress 应钳制到全开')
const eased = advanceDrawerProgress(0, 1, 0.22)
assert.ok(Math.abs(eased - (1 - Math.exp(-1))) < 0.02, `220ms 缓动应达到约 63.2%（实测 ${eased}）`)
assert.equal(advanceDrawerProgress(0.2, 1, 0.22) > 0.2, true, '缓动应单调逼近目标')
assert.equal(advanceDrawerProgress(1, 1, 0.016), 1, '已到目标应直接落位')
assert.equal(advanceDrawerProgress(0.9996, 1, 0.016), 1, '接近目标（<1e-3）应直接落位')

console.log(
  'Desk parts checks passed: body 46 kept parts / 17 drawer-lock parts split out, bounds 2.0×2.25×1.21m, ' +
    'anchors deskTop only, placement recomputed (back z=0, desk top 0.75m, feet sink ≤ 3cm); ' +
    '3 drawers matched to manifest (pull -x, materials assigned, box span 0.304m, travel 0.30m, inside cabinet); ' +
    'kinematics clamp/snap/ease/orientation asserted.',
)
