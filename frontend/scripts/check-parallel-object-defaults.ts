/* eslint-disable no-console */
import {
  NEW_DEFAULT_SKIP_LABELS,
  NEW_OBJECT_DEFAULT_SIZE_SCALE,
  newObjectDefaultSkipReason,
  scaleNewObjectDefaultDimensions,
  scaleNewObjectDefaultPorts,
  shouldApplyNewObjectDefaults,
} from '../src/data/objectDefaults'
import {
  applyNewObjectDefaults,
  createNewSceneObject,
  MOUSEPAD_PREFAB_ID,
  MOUSE_PREFAB_ID,
  placeOnSupport,
  supportTopY,
  syncSupportPose,
} from '../src/scene/objectDefaults'
import {
  createDemoSceneObjects,
  createNewSampleSceneObjects,
  DEMO_PROJECT_ID,
  DEMO_SEED_VERSION,
} from '../src/data/demoProject'
import { PREFAB_ITEMS, prefabDefaultDimensions } from '../src/scene/prefabItems'
import {
  POWER_STRIP_DEFAULTS,
  type Port,
  type SceneObject,
  type Vec3,
} from '../src/types/project'

/**
 * 新建物品默认尺寸（0.85）的离线检查：纯函数 + 工厂 + 新示例路径 + 旧示例回归。
 * 运行：`npx tsx scripts/check-parallel-object-defaults.ts`
 */

let failures = 0
function check(name: string, ok: boolean): void {
  if (ok) {
    console.log(`ok: ${name}`)
    return
  }
  failures += 1
  console.error(`FAIL: ${name}`)
}
function near(a: number, b: number, tolerance = 1e-12): boolean {
  return Math.abs(a - b) <= tolerance
}
function scaledBy(value: number, scale = NEW_OBJECT_DEFAULT_SIZE_SCALE): number {
  return value * scale
}

/** 页面内联构造的「源默认」物品：尚未确认，未施加默认比例 */
function sourceObject(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'obj-source',
    projectId: 'p1',
    name: '源默认物品',
    category: 'nonElectrical',
    dimensions: { width: 0.2, height: 0.1, depth: 0.4 },
    transform: { position: [0, 0.75, 0.3], rotationY: 0 },
    model: { status: 'none', source: 'demo', format: 'placeholder-box', shape: 'genericBox' },
    ports: [],
    quantity: 1,
    needsPower: false,
    visible: true,
    fixed: false,
    locked: false,
    frequent: false,
    source: 'manual',
    ...overrides,
  }
}
function movablePrefab(
  id: string,
  prefabId: string,
  shape: SceneObject['model']['shape'],
  position: Vec3,
  extra: Partial<SceneObject> = {},
): SceneObject {
  const size = PREFAB_ITEMS[prefabId].size
  return {
    ...sourceObject(extra),
    id,
    name: PREFAB_ITEMS[prefabId].label,
    dimensions: { width: size[0], height: size[1], depth: size[2] },
    transform: { position, rotationY: 0 },
    model: { status: 'ready', source: 'library', format: 'glb', prefabId, shape },
  }
}

// ── 1. 比例常量与纯缩放函数 ────────────────────────────────────────────────
check('默认比例为 0.85', NEW_OBJECT_DEFAULT_SIZE_SCALE === 0.85)

const scaled = scaleNewObjectDefaultDimensions({ width: 0.35, height: 0.228, depth: 0.346 })
check('宽 350mm → 297.5mm', near(scaled.width, 0.2975))
check('高 228mm → 193.8mm', near(scaled.height, 0.1938))
check('深 346mm → 294.1mm', near(scaled.depth, 0.2941))

const sourcePorts: Port[] = [
  { id: 'p-back', type: 'power-ac', powered: true, offset: [0.1, 0.2, -0.2], direction: 'back', confirmed: true },
  { id: 'p-usb', type: 'usb-c', powered: true, offset: [-0.4, 0.05, 0.1], direction: 'right' },
  { id: 'p-derived', type: 'wireless', powered: false },
]
const scaledPorts = scaleNewObjectDefaultPorts(sourcePorts)
check(
  '接口偏移按同一比例缩放',
  scaledPorts[0].offset!.every((value, i) => near(value, sourcePorts[0].offset![i] * NEW_OBJECT_DEFAULT_SIZE_SCALE)),
)
check('接口方向与类型不变', scaledPorts[0].direction === 'back' && scaledPorts[0].type === 'power-ac')
check('已确认接口在缩尺后取消确认', scaledPorts[0].confirmed === false)
check('未确认接口不新增确认字段', !('confirmed' in scaledPorts[1]))
check('无 offset 的接口保持原引用（按背面中心派生）', scaledPorts[2] === sourcePorts[2])

// ── 2. 适用性判定 ────────────────────────────────────────────────────────
check('普通可移动物品适用', shouldApplyNewObjectDefaults(sourceObject()))
check('固定摆放物品不适用', newObjectDefaultSkipReason(sourceObject({ fixed: true })) === 'fixed')
check(
  '排插（规格长度）不适用',
  newObjectDefaultSkipReason(sourceObject({ powerStrip: { ...POWER_STRIP_DEFAULTS } })) === 'power-strip',
)
check(
  '排插语义形状不适用',
  newObjectDefaultSkipReason(
    sourceObject({ model: { status: 'placeholder', source: 'demo', shape: 'powerStrip' } }),
  ) === 'power-strip',
)
check(
  '用户已确认尺寸不适用',
  newObjectDefaultSkipReason(
    sourceObject({ recognition: { confidence: 0.9, source: 'ai', dimensionSource: 'user' } }),
  ) === 'measured',
)
check(
  '生成 / 导入模型实测尺寸不适用',
  newObjectDefaultSkipReason(
    sourceObject({ model: { status: 'ready', source: 'generated', format: 'glb', assetUrl: '/m.glb' } }),
  ) === 'imported',
)
check('不适用原因均有文案', Object.values(NEW_DEFAULT_SKIP_LABELS).every((label) => label.length > 0))

// ── 3. 一次性应用（不二次缩放） ────────────────────────────────────────────
const literal = sourceObject({
  ports: [{ id: 'p', type: 'usb-c', powered: true, offset: [0.2, 0, 0] }],
})
const once = applyNewObjectDefaults(literal)
const twice = applyNewObjectDefaults(once)
const againFromSource = applyNewObjectDefaults(literal)
check(
  '新建默认宽高深恰为 0.85',
  near(once.dimensions.width, 0.17) && near(once.dimensions.height, 0.085) && near(once.dimensions.depth, 0.34),
)
check('接口偏移随尺寸缩放', near(once.ports[0].offset![0], 0.17))
check('底面中心位置不变（锚点仍贴支撑面）', once.transform.position.join(',') === literal.transform.position.join(','))
check('对结果重复调用不再缩小', twice === once)
check('对同一源字面量重复调用返回同一结果且不二次缩小', againFromSource === once)
check('源字面量本身不被修改（纯函数）', literal.dimensions.width === 0.2)
check('固定物品原样返回', applyNewObjectDefaults(sourceObject({ fixed: true })).dimensions.width === 0.2)

// ── 4. 新建工厂 ──────────────────────────────────────────────────────────
const laptopSize = PREFAB_ITEMS.laptop_extend.size
const laptop = createNewSceneObject({
  id: 'new-laptop',
  projectId: 'p1',
  name: '笔记本电脑',
  category: 'electrical',
  dimensions: { width: laptopSize[0], height: laptopSize[1], depth: laptopSize[2] },
  position: [-0.26, 0.75, 0.23],
  shape: 'laptop',
  prefabId: 'laptop_extend',
  ports: [
    {
      id: 'usbc',
      type: 'usb-c',
      powered: true,
      offset: [laptopSize[0] / 2, 0.005, -0.06],
      direction: 'right',
      confirmed: true,
    },
  ],
  needsPower: true,
  frequent: true,
})
check('工厂保留预制模型引用', laptop.model.prefabId === 'laptop_extend' && laptop.model.format === 'glb')
check(
  '工厂按 0.85 生成默认尺寸',
  near(laptop.dimensions.width, scaledBy(laptopSize[0])) && near(laptop.dimensions.height, scaledBy(laptopSize[1])),
)
check(
  '工厂同步缩放接口偏移并取消确认',
  near(laptop.ports[0].offset![0], scaledBy(laptopSize[0] / 2)) && laptop.ports[0].confirmed === false,
)
check(
  '工厂默认未锁定 / 可见 / 手动来源',
  laptop.locked === false && laptop.visible === true && laptop.source === 'manual',
)
check('工厂保留底面中心位置', laptop.transform.position[1] === 0.75)

const unknownPrefab = createNewSceneObject({
  id: 'new-odd',
  projectId: 'p1',
  name: '未知预制物品',
  category: 'nonElectrical',
  dimensions: { width: 0.2, height: 0.2, depth: 0.2 },
  position: [0, 0.75, 0.4],
  shape: 'genericBox',
  prefabId: 'no-such-prefab',
})
check(
  '未注册预制 id 回退占位几何且仍走默认比例',
  unknownPrefab.model.prefabId === undefined && near(unknownPrefab.dimensions.width, 0.17),
)

const strip = createNewSceneObject({
  id: 'new-strip',
  projectId: 'p1',
  name: '排插',
  category: 'electrical',
  dimensions: { width: 0.21, height: 0.03, depth: 0.05 },
  position: [0.4, 0.75, 0.13],
  shape: 'powerStrip',
  fixed: true,
  powerStrip: { ...POWER_STRIP_DEFAULTS },
  ports: [{ id: 'strip-1', type: 'power-ac', powered: true, offset: [-0.075, 0.031, 0], direction: 'up' }],
})
check('固定排插不被缩尺', strip.dimensions.width === 0.21 && strip.ports[0].offset![0] === -0.075)

// ── 5. 支撑关系（鼠标落在鼠标垫顶面） ─────────────────────────────────────
const pad = createNewSceneObject({
  id: 'pad',
  projectId: 'p1',
  name: '鼠标垫',
  category: 'nonElectrical',
  dimensions: { width: 0.24, height: 0.002, depth: 0.2 },
  position: [0.485, 0.75, 0.46],
  shape: 'genericBox',
  prefabId: MOUSEPAD_PREFAB_ID,
})
const padTop = 0.75 + scaledBy(0.002)
check('鼠标垫厚度按 0.85 缩放', near(pad.dimensions.height, scaledBy(0.002)))
check('支撑顶面 = 底面中心 + 声明高度', near(supportTopY(pad), padTop))

const mouse = movablePrefab('mouse', MOUSE_PREFAB_ID, 'mouse', [0.485, 0.75, 0.46])
check(
  '非工厂构造的物品保持源尺寸（比例只在新建路径施加）',
  mouse.dimensions.width === PREFAB_ITEMS.mouse.size[0],
)

const onPad = placeOnSupport(mouse, pad)
check('鼠标底面停在鼠标垫顶面', near(onPad.transform.position[1], padTop))
check('鼠标水平位置留在垫子投影内', near(onPad.transform.position[0], 0.485) && near(onPad.transform.position[2], 0.46))

const farMouse = { ...mouse, transform: { ...mouse.transform, position: [1.2, 0.75, 0.9] as Vec3 } }
const clamped = placeOnSupport(farMouse, pad)
const padHalfWidth = pad.dimensions.width / 2
const padHalfDepth = pad.dimensions.depth / 2
check(
  '超出垫子的鼠标被夹取回垫内',
  Math.abs(clamped.transform.position[0] - pad.transform.position[0]) <= padHalfWidth + 1e-9 &&
    Math.abs(clamped.transform.position[2] - pad.transform.position[2]) <= padHalfDepth + 1e-9,
)
check('夹取后仍贴合垫子顶面', near(clamped.transform.position[1], padTop))

const synced = syncSupportPose([pad, farMouse])
check('syncSupportPose 只调整鼠标，垫子原样', synced[0] === pad && near(synced[1].transform.position[1], padTop))
check('无鼠标垫时不凭空放置', syncSupportPose([farMouse])[0] === farMouse)

// ── 6. 旧示例 / 旧项目回归（不得被缩尺） ──────────────────────────────────
const legacy = createDemoSceneObjects(DEMO_PROJECT_ID)
const legacyLaptop = legacy.find((o) => o.id === 'demo-laptop')!
check('示例种子版本未因默认比例提升', DEMO_SEED_VERSION === 7)
check('旧示例物品数量不变', legacy.length === 14)
check('旧示例尺寸原样保留', legacyLaptop.dimensions.width === 0.35 && legacyLaptop.dimensions.depth === 0.346)
check('旧示例接口偏移原样保留', legacyLaptop.ports[0].offset![0] === 0.175)
check('旧示例搁板支撑高度原样保留', legacy.find((o) => o.id === 'demo-storage-box')!.transform.position[1] === 1.46)
check('旧示例固定排插原样保留', legacy.find((o) => o.id === 'demo-power-strip')!.dimensions.width === 0.21)

// ── 7. 新示例物品库（新项目路径） ─────────────────────────────────────────
const fresh = createNewSampleSceneObjects(DEMO_PROJECT_ID)
const freshLaptop = fresh.find((o) => o.id === 'demo-laptop')!
check('新示例物品数量与旧示例一致', fresh.length === legacy.length)
check(
  '新示例可移动物品恰为 0.85',
  near(freshLaptop.dimensions.width, scaledBy(0.35)) &&
    near(freshLaptop.dimensions.height, scaledBy(0.228)) &&
    near(freshLaptop.dimensions.depth, scaledBy(0.346)),
)
check('新示例接口偏移同步缩放', near(freshLaptop.ports[0].offset![0], scaledBy(0.175)))
check('新示例保留底面中心位置', freshLaptop.transform.position.join(',') === legacyLaptop.transform.position.join(','))
check('新示例固定排插不缩放', fresh.find((o) => o.id === 'demo-power-strip')!.dimensions.width === 0.21)
check(
  '新示例每次调用都只缩放一次',
  near(createNewSampleSceneObjects(DEMO_PROJECT_ID).find((o) => o.id === 'demo-laptop')!.dimensions.width, scaledBy(0.35)),
)

// ── 8. 预制物品库默认尺寸 ────────────────────────────────────────────────
const cupDefault = prefabDefaultDimensions('cup')
check(
  '预制库默认尺寸 = 实测外包 × 0.85',
  cupDefault !== null &&
    near(cupDefault.width, scaledBy(PREFAB_ITEMS.cup.size[0])) &&
    near(cupDefault.depth, scaledBy(PREFAB_ITEMS.cup.size[2])),
)
check('未注册预制 id 返回 null', prefabDefaultDimensions('no-such-prefab') === null)

if (failures > 0) {
  console.error(`\n${failures} 项检查未通过`)
  process.exitCode = 1
} else {
  console.log('\n全部检查通过')
}
