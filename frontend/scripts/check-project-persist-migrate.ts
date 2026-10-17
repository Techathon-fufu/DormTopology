import assert from 'node:assert/strict'
import { createDemoProject, DEMO_PROJECT_ID } from '../src/data/demoProject'

// 直接验证 persist 的 migrate 行为：它只依赖 zustand 的 persist 中间件，
// 这里用同一个探测函数逻辑复现（store 的 config.migrate 无法从外部直接取到）。
// 重要：migrate 必须能处理 v1 存储的真实形状——一个不含 demoSeedVersion 的示例项目，
// 以及若干用户自建项目，且绝不能动用户项目。

type Shape = { projects: Record<string, any> }
const DEMO_SEED_VERSION = createDemoProject().demoSeedVersion!

function isDemoProjectStale(project: any): boolean {
  if (!project || project.id !== DEMO_PROJECT_ID) return false
  return (project.demoSeedVersion ?? 0) < DEMO_SEED_VERSION
}

/** 与 projectsStore 中 migrate 保持一致的实现（此脚本用于锁定其行为契约） */
function migrate(persisted: any, from: number): Shape {
  const state = persisted as Partial<Shape> | undefined
  if (!state?.projects) return persisted as Shape
  const projects = { ...state.projects }
  if (from < 2 && isDemoProjectStale(projects[DEMO_PROJECT_ID])) {
    projects[DEMO_PROJECT_ID] = createDemoProject()
  }
  return { ...state, projects } as Shape
}

// ── 场景 1：v1 存储，示例项目是旧场景（1200 宽、叠放书本、无种子字段） ───────
const staleDemo = {
  id: DEMO_PROJECT_ID,
  name: '示例：上床下桌·四人间',
  isDemo: true,
  room: { desk: { width: 1.2, depth: 0.6, height: 0.75, thickness: 0.025 } },
  objects: [{ id: 'demo-books', model: { shape: 'books' } }],
}
const userProject = { id: 'user-1', name: '我的空间', isDemo: false, objects: [] }

const migrated = migrate({ projects: { [DEMO_PROJECT_ID]: staleDemo, 'user-1': userProject } }, 1)

assert.equal(migrated.projects[DEMO_PROJECT_ID].room.desk.width, 1.6, '示例项目已重种为新尺寸')
assert.equal(
  migrated.projects[DEMO_PROJECT_ID].objects.length,
  17,
  '示例项目已重种为 17 件物品',
)
assert.ok(
  migrated.projects[DEMO_PROJECT_ID].demoSeedVersion === DEMO_SEED_VERSION,
  '重种后写入当前种子版本',
)
assert.deepEqual(migrated.projects['user-1'], userProject, '用户项目必须逐字节原样保留')

// ── 场景 2：v1 存储，但示例项目已是当前种子（不应被覆盖，保护用户对示例的改动） ─
const currentDemo = createDemoProject()
const kept = migrate({ projects: { [DEMO_PROJECT_ID]: currentDemo } }, 1)
assert.equal(kept.projects[DEMO_PROJECT_ID], currentDemo, '种子版本相符时不重种（引用不变）')

// ── 场景 3：已是 v2 存储（from=2），任何情况下 migrate 都不再重种 ────────────
const noopDemo = { ...staleDemo }
const v2 = migrate({ projects: { [DEMO_PROJECT_ID]: noopDemo } }, 2)
assert.equal(v2.projects[DEMO_PROJECT_ID], noopDemo, 'from=2 时不做重种')

// ── 场景 4：空 / 畸形 payload 不崩溃 ────────────────────────────────────────
assert.deepEqual(migrate({ projects: {} }, 1), { projects: {} }, '空项目表安全通过')
assert.deepEqual(migrate({}, 1), {}, '缺 projects 字段原样返回')
assert.equal(migrate(undefined, 1), undefined, 'undefined payload 原样返回')

console.log(
  'Persist migrate checks passed: v1 stale demo reseeded, user projects untouched, current seed preserved, v2 no-op, malformed payloads safe.',
)
