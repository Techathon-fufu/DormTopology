import assert from 'node:assert/strict'
import { createDemoProject, DEMO_PROJECT_ID, DEMO_ROOM_NOTE } from '../src/data/demoProject'
import { OUTLET_FIXED_Y_M } from '../src/types/project'

// 直接验证 persist 的 migrate 行为：它只依赖 zustand 的 persist 中间件，
// 这里用同一个探测函数逻辑复现（store 的 config.migrate 无法从外部直接取到）。
// 重要：migrate 必须能处理 v1 / v2 存储的真实形状——含旧示例项目（可能带左右两个独立插座）、
// 用户自建项目，且绝不能破坏用户数据（仅允许「插座归一」与「示例重种」两类改动）。

const PERSIST_VERSION = 3
type Shape = { projects: Record<string, any> }
const DEMO_SEED_VERSION = createDemoProject().demoSeedVersion!

function isDemoProjectStale(project: any): boolean {
  if (!project || project.id !== DEMO_PROJECT_ID) return false
  return (project.demoSeedVersion ?? 0) < DEMO_SEED_VERSION
}

/** 与 projectsStore 中 mergeOutletPanel 保持一致：左右两个独立插座 → 一块「双插孔 ×2」面板 */
function mergeOutletPanel(first: any) {
  return {
    id: first?.id ?? 'outlet-1',
    position: [first?.position?.[0] ?? 0, OUTLET_FIXED_Y_M, first?.position?.[2] ?? 0.01],
    label: '后墙插座（双插孔 ×2）',
    slots: 2,
  }
}

/** 与 projectsStore 中 migrate 保持一致的实现（此脚本用于锁定其行为契约） */
function migrate(persisted: any, from: number): Shape {
  const state = persisted as Partial<Shape> | undefined
  if (!state?.projects) return persisted as Shape
  const projects = { ...state.projects }
  if (from < 3) {
    for (const [id, p] of Object.entries(projects)) {
      if (!p?.room) continue
      projects[id] = {
        ...p,
        room: {
          ...p.room,
          outlets: [mergeOutletPanel(p.room.outlets?.[0])],
          note: id === DEMO_PROJECT_ID ? DEMO_ROOM_NOTE : p.room.note,
        },
      }
    }
  }
  if (from < PERSIST_VERSION && isDemoProjectStale(projects[DEMO_PROJECT_ID])) {
    projects[DEMO_PROJECT_ID] = createDemoProject()
  }
  return { ...state, projects } as Shape
}

// ── 场景 1：v1 存储，示例项目是旧场景（无种子字段、左右两个独立插座） ─────────
const staleDemo = {
  id: DEMO_PROJECT_ID,
  name: '示例：上床下桌·四人间',
  isDemo: true,
  room: {
    desk: { width: 1.2, depth: 0.6, height: 0.75, thickness: 0.025 },
    outlets: [
      { id: 'outlet-l', position: [-0.6, 0.35, 0.01], label: '后墙插座·左', slots: 2 },
      { id: 'outlet-r', position: [0.6, 0.4, 0.01], label: '后墙插座·右', slots: 2 },
    ],
  },
  objects: [{ id: 'demo-books', model: { shape: 'books' } }],
}
const userProject = {
  id: 'user-1',
  name: '我的空间',
  isDemo: false,
  objects: [{ id: 'o1' }],
  room: {
    length: 2.6,
    note: '用户自定说明',
    outlets: [
      { id: 'outlet-l', position: [-0.5, 0.4, 0.01], label: '后墙插座·左', slots: 2 },
      { id: 'outlet-r', position: [0.5, 0.4, 0.01], label: '后墙插座·右', slots: 2 },
    ],
  },
}

const migrated = migrate({ projects: { [DEMO_PROJECT_ID]: staleDemo, 'user-1': userProject } }, 1)

assert.equal(migrated.projects[DEMO_PROJECT_ID].room.desk.width, 1.6, '示例项目已重种为新尺寸')
assert.equal(migrated.projects[DEMO_PROJECT_ID].objects.length, 17, '示例项目已重种为 17 件物品')
assert.ok(
  migrated.projects[DEMO_PROJECT_ID].demoSeedVersion === DEMO_SEED_VERSION,
  '重种后写入当前种子版本',
)
assert.equal(migrated.projects[DEMO_PROJECT_ID].room.outlets.length, 1, '示例项目重种为单块插座面板')
assert.equal(migrated.projects[DEMO_PROJECT_ID].room.outlets[0].position[0], 0, '示例插座后墙居中')
assert.equal(migrated.projects[DEMO_PROJECT_ID].room.note, DEMO_ROOM_NOTE, '示例说明为固定模型口径')

// 用户项目：仅插座归一，其余数据原样保留
const user = migrated.projects['user-1']
assert.deepEqual(
  user.room.outlets,
  [
    {
      id: 'outlet-l',
      position: [-0.5, OUTLET_FIXED_Y_M, 0.01],
      label: '后墙插座（双插孔 ×2）',
      slots: 2,
    },
  ],
  '用户项目插座归一为单块面板（保留第一个插座的 id / 左右位置 / 贴墙 z）',
)
assert.equal(user.room.note, '用户自定说明', '用户项目说明不被改写')
assert.equal(user.name, '我的空间', '用户项目其余字段不变')
assert.equal(user.objects, userProject.objects, '用户项目对象数组保持引用不变')

// ── 场景 2：v1 存储，示例项目已是当前种子（不重种，但插座仍归一） ─────────────
const currentDemo = createDemoProject()
const kept = migrate({ projects: { [DEMO_PROJECT_ID]: currentDemo } }, 1)
assert.equal(
  kept.projects[DEMO_PROJECT_ID].objects,
  currentDemo.objects,
  '种子版本相符时不重种（物品保持）',
)
assert.equal(kept.projects[DEMO_PROJECT_ID].room.outlets.length, 1, '当前种子示例插座为单块面板')

// ── 场景 3：v2 存储（协作方版本，含旧左右插座） ───────────────────────────────
const v2Current = { ...staleDemo, demoSeedVersion: DEMO_SEED_VERSION }
const fromV2 = migrate({ projects: { [DEMO_PROJECT_ID]: v2Current, 'user-1': userProject } }, 2)
assert.equal(fromV2.projects[DEMO_PROJECT_ID].objects, v2Current.objects, 'v2 且种子最新：不重种')
assert.deepEqual(
  fromV2.projects[DEMO_PROJECT_ID].room.outlets,
  [
    {
      id: 'outlet-l',
      position: [-0.6, OUTLET_FIXED_Y_M, 0.01],
      label: '后墙插座（双插孔 ×2）',
      slots: 2,
    },
  ],
  'v2：插座归一为单块面板',
)
assert.equal(fromV2.projects['user-1'].room.outlets.length, 1, 'v2：用户项目插座同样归一')

const v2Stale = { ...staleDemo, demoSeedVersion: 2 }
const fromV2Stale = migrate({ projects: { [DEMO_PROJECT_ID]: v2Stale } }, 2)
assert.equal(
  fromV2Stale.projects[DEMO_PROJECT_ID].demoSeedVersion,
  DEMO_SEED_VERSION,
  'v2 且种子落后：重种到当前种子',
)

// ── 场景 4：已是 v3 存储（from=3），任何情况下 migrate 都不再改动 ─────────────
const v3Payload = {
  projects: {
    [DEMO_PROJECT_ID]: { ...staleDemo, demoSeedVersion: DEMO_SEED_VERSION },
    'user-1': userProject,
  },
}
const v3 = migrate(v3Payload, 3)
assert.equal(v3.projects[DEMO_PROJECT_ID], v3Payload.projects[DEMO_PROJECT_ID], 'from=3 不重种（引用不变）')
assert.equal(v3.projects['user-1'], v3Payload.projects['user-1'], 'from=3 用户项目引用不变')

// ── 场景 5：空 / 畸形 payload 不崩溃 ────────────────────────────────────────
assert.deepEqual(migrate({ projects: {} }, 1), { projects: {} }, '空项目表安全通过')
assert.deepEqual(migrate({}, 1), {}, '缺 projects 字段原样返回')
assert.equal(migrate(undefined, 1), undefined, 'undefined payload 原样返回')

const bareUser = { id: 'user-2', objects: [] }
const bare = migrate({ projects: { 'user-2': bareUser } }, 1)
assert.equal(bare.projects['user-2'], bareUser, '缺 room 的项目原样保留')

console.log(
  'Persist migrate checks passed: v1 stale demo reseeded to single-panel seed, user projects outlet-normalized only, v2 split normalize/reseed, v3 no-op, malformed payloads safe.',
)
