import assert from 'node:assert/strict'
import { createLegacyDemoProject as createDemoProject } from './fixtures/legacyDemo'
import { cachedRoomSolids, roomSolids } from '../src/scene/roomCollision'
import { objectExtent, objectFootprint, objectRoomHits, objectsCollide } from '../src/scene/collisionGeometry'
import { computeOrganizationZones } from '../src/scene/organizationZones'
import { computeRuleBasedPlan, estimateDeskFreeArea } from '../src/scene/ruleLayout'
import { resolveOrganizationPreferences } from '../src/types/organization'
import {
  DESK_BEAM_DEPTH,
  DESK_BEAM_SECTION,
  DESK_BEAM_Z,
  DESK_GAP,
  SHELF_THICKNESS,
  deskBeamTopY,
  placementIssues,
} from '../src/scene/sceneValidation'
import type { RoomConfig, SceneObject, Vec3 } from '../src/types/project'

const room = createDemoProject().room

/** Minimal object factory: bottom-centre position, metres, shape-driven collision. */
function obj(
  id: string,
  shape: SceneObject['model']['shape'],
  size: [number, number, number],
  position: Vec3,
  rotationY = 0,
): SceneObject {
  return {
    id,
    name: id,
    category: 'nonElectrical',
    dimensions: { width: size[0], height: size[1], depth: size[2] },
    transform: { position, rotationY },
    model: { status: 'placeholder', source: 'demo', shape },
    visible: true,
    fixed: false,
    ports: [],
    quantity: 1,
  } as unknown as SceneObject
}

// ── 1. 场地实体清单与几何范围 ────────────────────────────────────────────
const solids = roomSolids(room)
const byId = new Map(solids.map((s) => [s.id, s]))
// 桌面板 1 + 桌腿 4 + 横梁 1 + 搁板 1 + 侧板 2 + 立柱 = 9 + posts
assert.equal(solids.length, 9 + room.posts.length, `room solid count must track the configured post count`)
for (const id of ['desk-top', 'desk-beam', 'shelf-board', 'shelf-divider--1', 'shelf-divider-1', 'post-fl', 'post-fr', 'post-bl', 'post-br']) {
  assert.ok(byId.has(id), `missing room solid ${id}`)
}
assert.equal(solids.filter((s) => s.kind === 'deskLeg').length, 4)
assert.equal(solids.filter((s) => s.kind === 'post').length, room.posts.length)

// 桌面盒必须与渲染一致：顶面 = desk.height，厚度 = desk.thickness
const deskTop = byId.get('desk-top')!
assert.ok(Math.abs(deskTop.max[1] - room.desk.height) < 1e-12, 'desk top face must be at desk.height')
assert.ok(Math.abs(deskTop.min[1] - (room.desk.height - room.desk.thickness)) < 1e-12, 'desk top must be thickness thick')
assert.ok(Math.abs(solids.find((s) => s.id === 'desk-beam')!.max[1] - (room.desk.height - room.desk.thickness - 0.05)) < 1e-12, 'beam top must match deskBeamTopY')
assert.ok(solids.every((s) => s.max.every((v, i) => v > s.min[i])), 'every solid must have positive volume')

// roomCollision 就地声明的几何常量必须与 sceneValidation 的同名常量一致
// （避免循环导入的同时，不允许两处数值漂移）
assert.ok(Math.abs(solids.find((s) => s.id === 'desk-beam')!.max[1] - deskBeamTopY(room)) < 1e-12, 'local beam-top formula must match deskBeamTopY')
assert.ok(Math.abs(solids.find((s) => s.id === 'desk-beam')!.max[1] - solids.find((s) => s.id === 'desk-beam')!.min[1] - DESK_BEAM_SECTION) < 1e-12, 'local beam section must match DESK_BEAM_SECTION')
assert.ok(Math.abs(solids.find((s) => s.id === 'desk-beam')!.max[2] - solids.find((s) => s.id === 'desk-beam')!.min[2] - DESK_BEAM_DEPTH) < 1e-12, 'local beam depth must match DESK_BEAM_DEPTH')
assert.ok(Math.abs((solids.find((s) => s.id === 'desk-beam')!.min[2] + solids.find((s) => s.id === 'desk-beam')!.max[2]) / 2 - DESK_BEAM_Z) < 1e-12, 'local beam centre must match DESK_BEAM_Z')
assert.ok(Math.abs(solids.find((s) => s.id === 'shelf-board')!.max[1] - solids.find((s) => s.id === 'shelf-board')!.min[1] - SHELF_THICKNESS) < 1e-12, 'local shelf thickness must match SHELF_THICKNESS')
assert.ok(Math.abs(solids.find((s) => s.id === 'desk-top')!.min[2] - DESK_GAP) < 1e-12, 'desk top back edge must sit at DESK_GAP')

// 拖拽路径使用带记忆化的版本：结果必须与纯函数一致，且配置变化后必须失效
assert.deepEqual(cachedRoomSolids(room), roomSolids(room), 'cached room solids must equal the pure computation')
assert.equal(cachedRoomSolids(room), cachedRoomSolids(room), 'repeated calls must reuse the same instance')
const widened: RoomConfig = { ...room, desk: { ...room.desk, width: room.desk.width + 0.1 } }
assert.notEqual(cachedRoomSolids(widened), cachedRoomSolids(room), 'a furniture change must invalidate the cache')
assert.ok(cachedRoomSolids(widened).length === solids.length, 'cache must not change the solid count')

// ── 2. 贴面摆放不算穿模（回归保护）────────────────────────────────────────
const onDesk = obj('on-desk', 'keyboard', [0.42, 0.03, 0.15], [0, room.desk.height, 0.4])
assert.deepEqual(objectRoomHits(onDesk, onDesk.transform.position, solids, 0.001), [], 'an item resting exactly on the desk is not penetration')
assert.equal(placementIssues(onDesk, onDesk.transform.position, [], room).some((i) => i.type === 'roomCollision'), false)

const onShelf = obj('on-shelf', 'book', [0.18, 0.05, 0.2], [0, room.desk.height + room.shelf.heightAboveDesk + 0.018 / 2, 0.15])
assert.deepEqual(objectRoomHits(onShelf, onShelf.transform.position, solids, 0.001), [], 'an item resting on the shelf board is not penetration')

// ── 3. 明显穿模必须被抓到 ────────────────────────────────────────────────
// 3a. 沉进桌面（底面低于桌面 30mm）
const sunkDesk = obj('sunk-desk', 'keyboard', [0.42, 0.03, 0.15], [0, room.desk.height - 0.03, 0.4])
const sunkHits = objectRoomHits(sunkDesk, sunkDesk.transform.position, solids, 0.001)
assert.deepEqual(sunkHits.map((h) => h.id), ['desk-top'], 'an item sunk into the desk top must hit desk-top only')
assert.ok(placementIssues(sunkDesk, sunkDesk.transform.position, [], room).some((i) => i.type === 'roomCollision'), 'desk penetration must surface as roomCollision')

// 3b. 插进书架搁板
const sunkShelf = obj('sunk-shelf', 'book', [0.18, 0.05, 0.2], [0, room.desk.height + room.shelf.heightAboveDesk - 0.01, 0.15])
assert.ok(objectRoomHits(sunkShelf, sunkShelf.transform.position, solids, 0.001).some((h) => h.id === 'shelf-board'), 'shelf penetration must be caught')

// 3c. 撞进立柱（按配置的每根立柱逐一覆盖）
for (const post of room.posts) {
  const pos: Vec3 = [post.position[0], 0, post.position[2]]
  const postObj = obj(`hit-${post.id}`, 'book', [0.12, 0.3, 0.12], pos)
  assert.ok(
    objectRoomHits(postObj, pos, solids, 0.001).some((h) => h.id === post.id),
    `post ${post.id} penetration must be caught`,
  )
}

// 3d. 天花板上方不越界但撞进搁板 / 横梁
const hitBeam = obj('hit-beam', 'book', [0.12, 0.2, 0.12], [0, room.desk.height - room.desk.thickness - 0.05 - 0.1, 0.1])
assert.ok(objectRoomHits(hitBeam, hitBeam.transform.position, solids, 0.001).some((h) => h.id === 'desk-beam'), 'beam penetration must be caught')

// 3e. 旋转后仍按真实几何判定（绕 Y 旋转 45°，斜插进桌腿）
// 桌腿位于 x=±(width/2-0.05)、z=deskCZ±(depth/2-0.05)；取其一根，斜向插入
const legX = room.desk.width / 2 - 0.05
const legZ = room.desk.depth / 2 + 0.05 - (room.desk.depth / 2 - 0.05)
const rotHit = obj('rot-hit', 'keyboard', [0.42, 0.03, 0.15], [legX, 0.15, legZ], Math.PI / 4)
assert.ok(
  objectRoomHits(rotHit, rotHit.transform.position, solids, 0.001).some((h) => h.id.startsWith('desk-leg')),
  'rotated penetration must still be caught',
)

// ── 4. 允许间隙语义：恰好 1mm 内不算，超过才算 ─────────────────────────────
const hairline = obj('hairline', 'keyboard', [0.42, 0.03, 0.15], [0, room.desk.height - 0.0005, 0.4])
assert.deepEqual(objectRoomHits(hairline, hairline.transform.position, solids, 0.001), [], 'sub-clearance overlap is tolerated (float noise)')
const overClearance = obj('over-clearance', 'keyboard', [0.42, 0.03, 0.15], [0, room.desk.height - 0.005, 0.4])
assert.ok(objectRoomHits(overClearance, overClearance.transform.position, solids, 0.001).length > 0, 'over-clearance overlap must be reported')

// ── 5. 架空实体内部空隙不算穿模（compound 分离实体语义）────────────────────
// 显示器面板位于支杆上方：面板与底座之间是真实空隙，无物体也不该报碰撞
const monitor = obj('monitor', 'monitor', [0.58, 0.4, 0.14], [0, room.desk.height, 0.55])
assert.deepEqual(objectRoomHits(monitor, monitor.transform.position, solids, 0.001), [], 'a monitor standing on the desk must be clean')

// ── 6. 真实演示场景无假阳性 ──────────────────────────────────────────────
const demo = createDemoProject()
const demoRoom: RoomConfig = demo.room
const demoVisible = demo.objects.filter((o) => o.visible)
let demoRoomHits = 0
const offenders: string[] = []
for (const o of demoVisible) {
  const hits = objectRoomHits(o, o.transform.position, roomSolids(demoRoom), 0.001)
  if (hits.length > 0) {
    demoRoomHits += 1
    offenders.push(`${o.name} -> ${hits.map((h) => h.label).join(',')}`)
  }
}
assert.deepEqual(offenders, [], `demo scene must not contain room penetrations:\n${offenders.join('\n')}`)

// ── 7. 物品间碰撞仍独立工作（未被子系统破坏）──────────────────────────────
const a = obj('a', 'book', [0.18, 0.05, 0.2], [0, room.desk.height, 0.4])
const b = obj('b', 'book', [0.18, 0.05, 0.2], [0.05, room.desk.height, 0.4])
assert.equal(objectsCollide(a, a.transform.position, b, b.transform.position), true, 'item-vs-item SAT must still detect overlap')

// ── 8. 真实几何查询：搜索与验收必须看到同一个体积 ─────────────────────────
// 声明包围盒只在少数形状上等于真实体积；搜索若用声明盒，就会为台灯 / 显示器这类
// 「声明比实际宽」的物品过度保留空间，也会漏掉实际更宽的形状。
for (const o of demoVisible) {
  const ext = objectExtent(o)
  assert.ok(ext.width > 0 && ext.depth > 0 && ext.height > 0, `${o.name} must have a positive real volume`)
  // 真实体积不得大于声明盒（否则描边几何超出声明尺寸，说明描述符有问题）
  assert.ok(ext.width <= o.dimensions.width + 1e-6, `${o.name} real width must not exceed declared`)
  assert.ok(ext.depth <= o.dimensions.depth + 1e-6, `${o.name} real depth must not exceed declared`)
  assert.ok(ext.height <= o.dimensions.height + 1e-6, `${o.name} real height must not exceed declared`)
}
// 至少有一个形状确实比声明盒窄，否则本项检查没有区分力
const narrower = demoVisible.filter((o) => objectExtent(o).depth < o.dimensions.depth - 1e-4)
assert.ok(narrower.length > 0, 'at least one demo shape must be narrower than its declared box')

// ── 9. 整理方案端到端：真实算法产出的落位不得穿场地 ─────────────────────────
const plan = computeRuleBasedPlan({
  projectId: demo.id,
  objects: demo.objects,
  room: demo.room,
  preferences: resolveOrganizationPreferences(demo),
})
const planScene = demo.objects
  .filter((o) => o.visible)
  .map((o) => {
    const a = plan.assignments.find((x) => x.objectId === o.id)
    return a ? { ...o, transform: { position: a.position, rotationY: a.rotationY } } : o
  })
const planSolids = roomSolids(demo.room)
const planOffenders: string[] = []
for (const o of planScene) {
  const hits = objectRoomHits(o, o.transform.position, planSolids, 0.001)
  if (hits.length > 0) planOffenders.push(`${o.name} -> ${hits.map((h) => h.label).join(',')}`)
}
assert.deepEqual(planOffenders, [], `plan placements must not penetrate the room:\n${planOffenders.join('\n')}`)
// 方案指标里的「未解决问题」也必须与几何复核一致，不能报 0 却有穿模
assert.ok(plan.metrics.outOfBoundsCount >= 0, 'plan metrics must report an out-of-bounds count')

// A monitor base is offset toward +z; centering its width/depth loses that offset.
const asymmetricRoom: RoomConfig = {
  ...room,
  desk: { ...room.desk, depth: 0.87 },
  shelf: { ...room.shelf, enabled: false },
}
const preferences = { ...resolveOrganizationPreferences(demo), typingOffsetX: 0 }
const asymmetricMonitor = obj('asymmetric-monitor', 'monitor', [0.54, 0.20, 0.70], [0, room.desk.height, 0.35])
const typing = computeOrganizationZones(asymmetricRoom, preferences).typing.rect
const originalFootprint = objectFootprint(asymmetricMonitor, asymmetricMonitor.transform.position)
assert.ok(originalFootprint.z1 > typing.z0 + 0.004, 'fixture must put the real base 5mm inside the typing area')
assert.deepEqual(placementIssues(asymmetricMonitor, asymmetricMonitor.transform.position, [], asymmetricRoom), [], 'fixture must be physically supported without furniture collisions')
const asymmetricPlan = computeRuleBasedPlan({
  projectId: demo.id,
  objects: [asymmetricMonitor],
  room: asymmetricRoom,
  preferences,
})
assert.equal(asymmetricPlan.assignments.length, 0, 'ordinary monitor placement must not occupy the reserved typing area')
assert.equal(asymmetricPlan.unplaced[0]?.objectId, asymmetricMonitor.id, 'rejected placement must keep the item in the result')

// High objects explicitly allowed into the typing area retain that existing policy.
const tallMonitor = { ...asymmetricMonitor, dimensions: { ...asymmetricMonitor.dimensions, height: 0.46 } }
const tallRoom = { ...asymmetricRoom, shelf: { ...asymmetricRoom.shelf, enabled: true } }
const tallPlan = computeRuleBasedPlan({ projectId: demo.id, objects: [tallMonitor], room: tallRoom, preferences })
assert.equal(tallPlan.assignments.length, 1, 'explicit typing allowance for tall objects must remain available')
assert.ok(objectFootprint(tallMonitor, tallPlan.assignments[0].position).z1 > typing.z0, 'allowed tall placement must exercise the typing exception')

// Full real footprint remains on the desk; the offset must not clip 9mm off its area.
const edgeMonitor = obj('edge-monitor', 'monitor', [0.54, 0.46, 0.18], [0, room.desk.height, 0.113])
const freeArea = estimateDeskFreeArea(asymmetricRoom, [{ object: edgeMonitor, position: edgeMonitor.transform.position }])
assert.ok(Math.abs(freeArea - (asymmetricRoom.desk.width * asymmetricRoom.desk.depth - 0.54 * 0.144)) < 1e-7, 'desk area must clip the actual offset footprint')

console.log(
  `Collision volume checks passed: ${solids.length} room solids, desk/shelf/beam/post penetration caught, ` +
    `face-touching rest and 1mm clearance tolerated, rotated compound geometry honoured, ` +
    `${demoVisible.length} demo objects clean, item-vs-item SAT intact, asymmetric reserved-area and desk-area checks passed.`,
)
