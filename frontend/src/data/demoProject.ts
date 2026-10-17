import {
  OUTLET_FIXED_Y_M,
  type CableConnection,
  type CableEndpoint,
  type Project,
  type RoomConfig,
  type SceneObject,
  type Vec3,
} from '@/types/project'
import { DEFAULT_ORGANIZATION_PREFERENCES } from '@/types/organization'
import { prefabModelRef } from '@/scene/prefabItems'

/** 内置示例项目的固定 id：任意路由均可通过它进入同一个示例项目 */
export const DEMO_PROJECT_ID = 'demo-dorm-101'

/**
 * 内置示例项目的数据种子版本。
 * 每次修改示例场景（尺寸、物品、线缆等）都要 +1：浏览器里已存在的示例项目会在载入时
 * 按最新数据重种，避免"代码已更新、页面仍是旧场景"。
 * 与持久化 schema 版本（projectsStore 的 persist version）相互独立，二者不要混用。
 * v2：桌面 1600×800、三本独立书本、新增打印机 / 主机 / 电源适配器 / 保温杯（17 件物品）。
 * v3：墙面插座收敛为一块「双插孔 ×2」面板（固定模型口径），说明文案更新。
 * v4：来源分支分别接入家具几何和预制物品。
 * v5：合并真实 L 形桌面、书架及抽屉支撑与预制物品尺寸/碰撞；归档两个不同的旧 v4 示例。
 * v6：键鼠区左移 6cm，给真实笔记本留出主桌面侧位，避免与打印机争用回台。
 */
export const DEMO_SEED_VERSION = 6

export const DEMO_ROOM_NOTE =
  '固定 L 形床桌、四格书架及三抽屉；出线孔与插座可在「空间配置」中调整'

/** 默认空间：上床下桌标准款（单位：米） */
export function createStandardRoom(): RoomConfig {
  return {
    template: 'loft-standard',
    furnitureModel: 'dormdesk-v1',
    length: 2.6,
    width: 2.0,
    height: 2.7,
    desk: { width: 1.45, depth: 0.86, thickness: 0.025, height: 0.75 },
    shelf: { enabled: true, levels: 2, heightAboveDesk: 0.701, depth: 0.25 },
    posts: [
      { id: 'post-fl', position: [-0.97, 0, 0.03], section: 0.06 },
      { id: 'post-fr', position: [0.97, 0, 0.03], section: 0.06 },
      { id: 'post-bl', position: [-0.97, 0, 0.87], section: 0.06 },
      { id: 'post-br', position: [0.97, 0, 0.87], section: 0.06 },
    ],
    cableHoles: [{ id: 'hole-1', position: [0.5, 0.75, 0.28], diameter: 0.05 }],
    outlets: [
      { id: 'outlet-1', position: [0, OUTLET_FIXED_Y_M, 0.01], label: '后墙插座（双插孔 ×2）', slots: 2 },
    ],
    note: DEMO_ROOM_NOTE,
  }
}

/** 扩展演示物品库：独立书本与桌面设备，尺寸为示例值（单位：米）。 */
export function createDemoSceneObjects(projectId = DEMO_PROJECT_ID): SceneObject[] {
  const deskY = 0.75
  const base = {
    projectId,
    visible: true,
    fixed: false,
    locked: false,
    frequent: false,
  }

  return [
    {
      id: 'demo-laptop',
      ...base,
      name: '笔记本电脑',
      category: 'electrical',
      dimensions: { width: 0.35, height: 0.228, depth: 0.346 },
      transform: { position: [-0.3, deskY, 0.3], rotationY: -0.25 },
      model: prefabModelRef('laptop_extend', 'laptop'),
      ports: [
        {
          id: 'port-laptop-usbc',
          type: 'usb-c',
          label: 'USB-C 供电',
          powered: true,
          maxWatt: 65,
          offset: [0.175, 0.005, -0.06],
          direction: 'right',
        },
        {
          id: 'port-laptop-hdmi',
          type: 'hdmi',
          label: 'HDMI 输出',
          powered: false,
          offset: [0.175, 0.005, -0.01],
          direction: 'right',
        },
        {
          id: 'port-laptop-usba',
          type: 'usb-a',
          label: 'USB-A 数据',
          powered: false,
          offset: [0.175, 0.005, 0.06],
          direction: 'right',
        },
      ],
      quantity: 1,
      needsPower: true,
      frequent: true,
      source: 'demo',
      note: '演示物品：约 14 英寸',
    },
    {
      id: 'demo-monitor',
      ...base,
      name: '显示器',
      category: 'electrical',
      dimensions: { width: 0.6, height: 0.55, depth: 0.18 },
      // 初始位置仍为待整理状态；规划使用实测碰撞体与真实家具支撑。
      transform: { position: [0.1, deskY, 0.4], rotationY: 0.1 },
      model: prefabModelRef('monitor', 'monitor'),
      ports: [
        {
          id: 'port-monitor-pwr',
          type: 'power-ac',
          label: '电源',
          powered: true,
          maxWatt: 40,
          offset: [0.12, 0.05, -0.092],
          direction: 'back',
        },
        {
          id: 'port-monitor-hdmi',
          type: 'hdmi',
          label: 'HDMI 输入',
          powered: false,
          offset: [-0.12, 0.05, -0.092],
          direction: 'back',
        },
      ],
      quantity: 1,
      needsPower: true,
      source: 'demo',
      note: '演示物品：约 24 英寸',
    },
    {
      id: 'demo-keyboard',
      ...base,
      name: '键盘',
      category: 'electrical',
      dimensions: { width: 0.328, height: 0.035, depth: 0.134 },
      transform: { position: [-0.26, deskY, 0.47], rotationY: -0.15 },
      model: prefabModelRef('keyboard', 'keyboard'),
      ports: [
        {
          id: 'port-keyboard-usba',
          type: 'usb-a',
          label: 'USB 数据',
          powered: false,
          maxWatt: 2.5,
          offset: [0, 0.015, -0.067],
          direction: 'back',
        },
      ],
      quantity: 1,
      needsPower: false,
      frequent: true,
      source: 'demo',
      note: '演示物品：有线键盘',
    },
    {
      id: 'demo-mouse',
      ...base,
      name: '鼠标',
      category: 'electrical',
      dimensions: { width: 0.068, height: 0.045, depth: 0.118 },
      transform: { position: [0.0, deskY, 0.49], rotationY: 0.2 },
      model: prefabModelRef('mouse', 'mouse'),
      ports: [{ id: 'port-mouse-wireless', type: 'wireless', label: '无线接收器', powered: false }],
      quantity: 1,
      needsPower: false,
      frequent: true,
      source: 'demo',
      note: '演示物品：无线鼠标',
    },
    {
      id: 'demo-lamp',
      ...base,
      name: '台灯',
      category: 'electrical',
      dimensions: { width: 0.16, height: 0.45, depth: 0.18 },
      // 同显示器：高 0.45 > 搁板下净空 0.371，落在搁板投影之外（z ≥ 0.25 + 深度/2）
      transform: { position: [0.47, deskY, 0.46], rotationY: 0.6 },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'lamp' },
      ports: [
        {
          id: 'port-lamp-pwr',
          type: 'power-ac',
          label: '电源',
          powered: true,
          maxWatt: 8,
          offset: [0, 0.06, -0.092],
          direction: 'back',
        },
      ],
      quantity: 1,
      needsPower: true,
      source: 'demo',
      note: '演示物品：LED 台灯',
    },
    {
      id: 'demo-book-math',
      ...base,
      name: '高等数学教材',
      category: 'nonElectrical',
      dimensions: { width: 0.21, height: 0.035, depth: 0.15 },
      transform: { position: [0.33, deskY, 0.33], rotationY: 0.9 },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'book' },
      ports: [],
      quantity: 1,
      needsPower: false,
      source: 'demo',
      note: '演示物品：独立教材，可单独移动与整理',
    },
    ...[
      { id: 'demo-book-programming', name: '程序设计教材', width: 0.23, height: 0.028, x: -0.38, z: 0.64, angle: -0.3 },
      { id: 'demo-book-notebook', name: '课堂笔记本', width: 0.19, height: 0.018, x: 0.14, z: 0.68, angle: 0.25 },
    ].map((book): SceneObject => ({
      ...base,
      id: book.id,
      name: book.name,
      category: 'nonElectrical',
      dimensions: { width: book.width, height: book.height, depth: 0.15 },
      transform: { position: [book.x, deskY, book.z], rotationY: book.angle },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'book' },
      ports: [], quantity: 1, needsPower: false, source: 'demo',
      note: '演示物品：独立书本，可单独移动与整理',
    })),
    {
      ...base, id: 'demo-printer', name: '打印机', category: 'electrical',
      dimensions: { width: 0.38, height: 0.20, depth: 0.30 },
      transform: { position: [-0.58, deskY, 0.48], rotationY: 0 },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'printer' },
      ports: [
        { id: 'port-printer-power', type: 'power-ac', label: '电源输入', powered: true, offset: [-0.12, 0.05, -0.15], direction: 'back' },
        { id: 'port-printer-usb', type: 'usb-a', label: 'USB 接口', powered: false, offset: [0.12, 0.05, -0.15], direction: 'back' },
      ],
      quantity: 1, needsPower: true, source: 'demo', note: '演示物品：紧凑打印机，接线待用户确认',
    },
    {
      ...base, id: 'demo-computer-tower', name: '电脑主机', category: 'electrical',
      dimensions: { width: 0.20, height: 0.42, depth: 0.38 },
      transform: { position: [0.66, deskY, 0.49], rotationY: 0 },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'computerTower' },
      ports: [
        { id: 'port-tower-power', type: 'power-ac', label: '电源输入', powered: true, offset: [0, 0.08, -0.19], direction: 'back' },
        { id: 'port-tower-hdmi', type: 'hdmi', label: 'HDMI 输出', powered: false, offset: [0.04, 0.22, -0.19], direction: 'back' },
        { id: 'port-tower-network', type: 'rj45', label: '网口', powered: false, offset: [-0.04, 0.26, -0.19], direction: 'back' },
      ],
      quantity: 1, needsPower: true, source: 'demo', note: '演示物品：桌面主机，接线待用户确认',
    },
    {
      ...base, id: 'demo-power-adapter', name: '电源适配器', category: 'electrical',
      dimensions: { width: 0.058, height: 0.028, depth: 0.05 },
      transform: { position: [-0.10, deskY, 0.34], rotationY: 0.45 },
      model: prefabModelRef('charger', 'powerAdapter'),
      ports: [
        { id: 'port-adapter-ac', type: 'power-ac', label: '交流输入', powered: true, offset: [-0.029, 0.014, 0], direction: 'left' },
        { id: 'port-adapter-usbc', type: 'usb-c', label: 'USB-C 输出', powered: true, offset: [0.029, 0.014, 0], direction: 'right' },
      ],
      quantity: 1, needsPower: true, source: 'demo', note: '演示物品：独立电源适配器，接线待用户确认',
    },
    {
      ...base, id: 'demo-thermos', name: '保温杯', category: 'nonElectrical',
      dimensions: { width: 0.07, height: 0.22, depth: 0.07 },
      transform: { position: [0.49, deskY, 0.71], rotationY: 0 },
      model: prefabModelRef('stainless_bottle', 'thermos'),
      ports: [], quantity: 1, needsPower: false, frequent: true, source: 'demo',
      note: '演示物品：带盖保温杯，与普通水杯分别管理',
    },
    {
      id: 'demo-cup',
      ...base,
      name: '水杯',
      category: 'nonElectrical',
      dimensions: { width: 0.111, height: 0.095, depth: 0.08 },
      transform: { position: [-0.47, deskY, 0.16], rotationY: 0 },
      model: prefabModelRef('cup', 'cup'),
      ports: [],
      quantity: 1,
      needsPower: false,
      frequent: true,
      source: 'demo',
      note: '演示物品：普通水杯',
    },
    {
      id: 'demo-storage-box',
      ...base,
      name: '收纳盒',
      category: 'storage',
      dimensions: { width: 0.24, height: 0.12, depth: 0.18 },
      transform: { position: [0.45, deskY, 0.47], rotationY: 0.05 },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'storageBox' },
      ports: [],
      quantity: 1,
      needsPower: false,
      source: 'demo',
      note: '演示物品：文具收纳盒',
    },
    {
      id: 'demo-earbuds',
      ...base,
      name: '无线耳机',
      category: 'nonElectrical',
      dimensions: { width: 0.09, height: 0.08, depth: 0.04 },
      transform: { position: [0.36, deskY, 0.3], rotationY: 0.3 },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'genericBox' },
      ports: [],
      quantity: 1,
      needsPower: false,
      source: 'demo',
      note: '演示物品：小件（用于演示「小件优先入盒」规则）',
    },
    {
      id: 'demo-phone',
      ...base,
      name: '手机',
      category: 'electrical',
      dimensions: { width: 0.15, height: 0.007, depth: 0.075 },
      // 预制手机长边在局部 +x：旋转 90° 保持示例原本的「长边沿 z、充电口朝后」摆放
      transform: { position: [0.2, deskY, 0.53], rotationY: 0.1 + Math.PI / 2 },
      model: prefabModelRef('phone', 'genericBox'),
      ports: [
        {
          id: 'port-phone-usbc',
          type: 'usb-c',
          label: 'USB-C 充电口',
          powered: true,
          maxWatt: 20,
          offset: [0.075, 0.0035, 0],
          direction: 'right',
        },
      ],
      quantity: 1,
      needsPower: true,
      frequent: true,
      source: 'demo',
      note: '演示物品：手机（充电线默认「可见线」，规划后从桌面出线槽走线；线径默认细线）',
    },
    {
      id: 'demo-power-strip',
      ...base,
      name: '排插',
      category: 'electrical',
      dimensions: { width: 0.21, height: 0.03, depth: 0.05 },
      // 优先放在桌面下方横梁（走线 / 插拔方便）；可在属性面板中切换 4 / 6 / 8 位并移动位置
      transform: { position: [0.4, deskY, 0.13], rotationY: 0 },
      powerStrip: { socketCount: 4, socketSpacing: 0.05, maxLoadW: 2500 },
      model: { status: 'placeholder', source: 'demo', format: 'placeholder-box', shape: 'powerStrip' },
      ports: [1, 2, 3, 4].map((n) => ({
        id: `port-strip-${n}`,
        type: 'power-ac' as const,
        label: `排插·${n} 号口`,
        powered: true,
        maxWatt: 2500,
        // 插孔位于排插顶面，沿长度方向均匀分布（局部坐标：+x 沿排插长边；与 scene/powerStrip.ts 同口径）
        offset: [-0.075 + (n - 1) * 0.05, 0.031, 0] as Vec3,
        direction: 'up' as const,
      })),
      quantity: 1,
      needsPower: true,
      fixed: true,
      source: 'demo',
      note: '演示物品：4 位排插，放在真实桌面上；规格 4/6/8 位可切换',
    },
  ].map((object) => {
    const positions: Record<string, Vec3> = {
      'demo-laptop': [-.26, deskY, .23], 'demo-monitor': [.1, deskY, .3],
      'demo-keyboard': [-.15, deskY, .5], 'demo-mouse': [.16, deskY, .5],
      'demo-lamp': [.48, deskY, .47], 'demo-printer': [.795, deskY, .55],
      'demo-computer-tower': [.4, 0, .34], 'demo-thermos': [.8, deskY, .29],
      'demo-cup': [.8, deskY, .4], 'demo-storage-box': [.41, 1.46, .17],
      'demo-book-math': [-.25, deskY, .35], 'demo-book-english': [.16, deskY, .45],
      'demo-book-programming': [.1, deskY, .4],
      'demo-book-notebook': [.12, deskY, .5],
    }
    return { ...object, transform: { position: positions[object.id] ?? object.transform.position, rotationY: 0 } } as SceneObject
  })
}

function endpoint(objectId: string, portId: string | undefined, position: Vec3): CableEndpoint {
  return { objectId, portId, position }
}

function makeCable(
  projectId: string,
  id: string,
  kind: CableConnection['kind'],
  from: CableEndpoint,
  to: CableEndpoint,
  points: Vec3[],
  note: string,
): CableConnection {
  return {
    id,
    projectId,
    kind,
    from,
    to,
    route: { channels: ['free'], points },
    status: 'existing',
    planSource: 'manual',
    accessories: [],
    note,
  }
}

/**
 * 演示用「现状线缆」：略微散乱，尚未走线（电源 ×3、视频 ×1、数据 ×1、充电 ×1）。
 * 端点坐标在渲染时由接口实时推导；散乱的折线仅作「原始走线」示意。
 * 线材类型（可见线 / 隐藏线）默认按设备名称推断：显示器 / 台灯 → 隐藏线，手机 / 笔记本 → 可见线。
 */
export function createDemoCables(
  objects: SceneObject[],
  projectId = DEMO_PROJECT_ID,
): CableConnection[] {
  const find = (id: string) => objects.find((o) => o.id === id)
  const laptop = find('demo-laptop')
  const monitor = find('demo-monitor')
  const lamp = find('demo-lamp')
  const strip = find('demo-power-strip')
  const keyboard = find('demo-keyboard')
  const phone = find('demo-phone')
  if (!laptop || !monitor || !lamp || !strip) return []

  const s = strip.transform.position
  const stripPoint: Vec3 = [s[0] + 0.03, s[1] + 0.03, s[2] + 0.01]

  const lp = laptop.transform.position
  const mp = monitor.transform.position
  const la = lamp.transform.position
  const kb = keyboard?.transform.position

  const cables: CableConnection[] = [
    makeCable(
      projectId,
      'demo-cable-laptop',
      'power',
      endpoint(laptop.id, 'port-laptop-usbc', [lp[0] - 0.06, 0.76, lp[2] - 0.06]),
      endpoint(strip.id, 'port-strip-1', stripPoint),
      [
        [lp[0] - 0.06, 0.76, lp[2] - 0.06],
        [lp[0] - 0.16, 0.754, lp[2] + 0.06],
        [lp[0] + 0.06, 0.758, lp[2] + 0.12],
        [lp[0] - 0.02, 0.45, 0.04],
        [lp[0] - 0.08, 0.02, 0.1],
        [lp[0] - 0.14, 0.02, 0.24],
        stripPoint,
      ],
      '现状：笔记本充电线在桌面拖出松散弯折后斜跨垂落（待规划）',
    ),
    makeCable(
      projectId,
      'demo-cable-monitor',
      'power',
      endpoint(monitor.id, 'port-monitor-pwr', [mp[0] - 0.06, 0.76, mp[2] - 0.03]),
      endpoint(strip.id, 'port-strip-2', stripPoint),
      [
        [mp[0] - 0.06, 0.76, mp[2] - 0.03],
        [mp[0] - 0.03, 0.72, 0.06],
        [mp[0] - 0.05, 0.4, 0.03],
        [mp[0] - 0.15, 0.02, 0.14],
        [mp[0] - 0.3, 0.02, 0.22],
        stripPoint,
      ],
      '现状：显示器电源线横穿桌下（待规划）',
    ),
    makeCable(
      projectId,
      'demo-cable-lamp',
      'power',
      endpoint(lamp.id, 'port-lamp-pwr', [la[0] + 0.02, 0.77, la[2] - 0.04]),
      endpoint(strip.id, 'port-strip-3', stripPoint),
      [
        [la[0] + 0.02, 0.77, la[2] - 0.04],
        [la[0] - 0.08, 0.753, la[2] + 0.1],
        [la[0] + 0.02, 0.3, 0.03],
        [la[0] - 0.1, 0.02, 0.1],
        [la[0] - 0.35, 0.02, 0.18],
        stripPoint,
      ],
      '现状：台灯电源线贴地散放（待规划）',
    ),
    makeCable(
      projectId,
      'demo-cable-hdmi',
      'video',
      endpoint(monitor.id, 'port-monitor-hdmi', [mp[0] - 0.16, 0.8, mp[2] - 0.06]),
      endpoint(laptop.id, 'port-laptop-hdmi', [lp[0] - 0.2, 0.8, lp[2] - 0.02]),
      [
        [mp[0] - 0.16, 0.8, mp[2] - 0.06],
        [mp[0] - 0.3, 0.775, mp[2] + 0.12],
        [mp[0] - 0.22, 0.756, 0.42],
        [lp[0] - 0.04, 0.76, lp[2] + 0.18],
        [lp[0] - 0.2, 0.8, lp[2] - 0.02],
      ],
      '现状：HDMI 线在桌面上松散下垂、横穿键鼠区（待规划：可沿桌边走线）',
    ),
  ]

  if (keyboard && kb) {
    cables.push(
      makeCable(
        projectId,
        'demo-cable-keyboard',
        'data',
        endpoint(keyboard.id, 'port-keyboard-usba', [kb[0], 0.765, kb[2] - 0.08]),
        endpoint(laptop.id, 'port-laptop-usba', [lp[0] - 0.12, 0.8, lp[2] + 0.08]),
        [
          [kb[0], 0.765, kb[2] - 0.08],
          [kb[0] + 0.16, 0.756, kb[2] - 0.18],
          [lp[0] + 0.02, 0.752, lp[2] + 0.26],
          [lp[0] - 0.12, 0.8, lp[2] + 0.08],
        ],
        '现状：键盘数据线在桌面上绕行后回到笔记本（待规划）',
      ),
    )
  }

  if (phone) {
    const pp = phone.transform.position
    cables.push(
      makeCable(
        projectId,
        'demo-cable-phone',
        'charging',
        endpoint(phone.id, 'port-phone-usbc', [pp[0], pp[1] + 0.006, pp[2] - 0.08]),
        endpoint(strip.id, 'port-strip-4', stripPoint),
        [
          [pp[0], pp[1] + 0.006, pp[2] - 0.08],
          [pp[0] - 0.05, 0.757, pp[2] + 0.06],
          [pp[0] + 0.06, 0.75, 0.44],
          [lp[0] + 0.28, 0.44, 0.2],
          [lp[0] + 0.16, 0.02, 0.12],
          stripPoint,
        ],
        '现状：手机充电线散在桌面（默认「可见线」：规划后从桌面出线槽走线；线径默认细线）',
      ),
    )
  }

  return cables
}

/** 可复用的内置示例项目（每次调用返回全新对象） */
export function createDemoProject(): Project {
  const objects = createDemoSceneObjects()
  const now = Date.now()
  return {
    id: DEMO_PROJECT_ID,
    name: '示例：上床下桌·四人间',
    isDemo: true,
    source: 'demo',
    createdAt: now,
    updatedAt: now,
    room: createStandardRoom(),
    objects,
    cables: createDemoCables(objects),
    // 保留 55cm 键鼠区；左移 6cm 后，右侧净宽 36.5cm 可容纳真实笔记本。
    organization: { ...DEFAULT_ORGANIZATION_PREFERENCES, typingOffsetX: -0.06, cupCorner: 'backRight' },
    demoSeedVersion: DEMO_SEED_VERSION,
    stage: 'organize',
  }
}
