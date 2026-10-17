import assert from 'node:assert/strict'
import { createDemoProject, DEMO_PROJECT_ID, DEMO_SEED_VERSION } from '../src/data/demoProject'
import { isDemoProjectStale, useProjectsStore } from '../src/state/projectsStore'
import { OUTLET_FIXED_Y_M, type Project, type SceneObject } from '../src/types/project'

// ── 示例数据本身：种子版本与场景规模 ─────────────────────────────────────────
const fresh = createDemoProject()
assert.equal(fresh.demoSeedVersion, DEMO_SEED_VERSION, '新种入的示例项目带当前种子版本')
assert.equal(fresh.room.desk.width, 1.45, 'L 形桌面包络宽 1450mm')
assert.equal(fresh.room.desk.depth, 0.86, 'L 形桌面包络深 860mm')
assert.equal(fresh.room.furnitureModel, 'dormdesk-v1')
assert.equal(fresh.objects.length, 14, '示例场景 14 件物品')
assert.equal(fresh.organization?.typingOffsetX, -.06, '真实笔记本需要主桌面的侧部净宽')
assert.equal(fresh.organization?.typingWidth, .55, '键鼠区保持原宽度')
assert.equal(fresh.room.outlets.length, 1, '示例房间仅一块插座面板（固定模型口径）')
assert.equal(fresh.room.outlets[0].id, 'outlet-1', '插座面板 id 稳定')
assert.deepEqual(fresh.room.outlets[0].position, [0, OUTLET_FIXED_Y_M, 0.01], '插座后墙居中、采用契约固定高度')
assert.equal(fresh.room.outlets[0].slots, 2, '面板为两个双插孔插座')

// ── isDemoProjectStale：判定边界 ────────────────────────────────────────────
assert.equal(isDemoProjectStale(undefined), false, '不存在时不算 stale（由调用方负责创建）')
assert.equal(isDemoProjectStale(fresh), false, '当前版本不算 stale')

// 模拟浏览器里遗留的旧数据：没有 demoSeedVersion 字段（0.7.0 之前写入）
const legacy = { ...fresh, demoSeedVersion: undefined } as Project
assert.equal(isDemoProjectStale(legacy), true, '缺字段的旧数据必须判为 stale（这正是本次修复的核心场景）')

// 模拟上一版种子：需要定向迁移
const previous = { ...fresh, demoSeedVersion: DEMO_SEED_VERSION - 1 } as Project
assert.equal(isDemoProjectStale(previous), true, '旧种子版本必须判为 stale')

// 未来版本（比代码新，例如用户切换过分支）：不应被降级覆盖
const newer = { ...fresh, demoSeedVersion: DEMO_SEED_VERSION + 1 } as Project
assert.equal(isDemoProjectStale(newer), false, '高于当前代码的种子版本不重种，避免降级覆盖')

// 用户自建项目永远不受影响，即使带了一个很旧的种子版本
const userProject = { ...fresh, id: 'user-abc', isDemo: false, demoSeedVersion: 1 } as Project
assert.equal(isDemoProjectStale(userProject), false, '用户自建项目不受示例种子逻辑影响')

// ── 旧数据重种后：外观确实是新场景 ──────────────────────────────────────────
const reseeded = isDemoProjectStale(legacy) ? createDemoProject() : legacy
assert.equal(reseeded.room.desk.width, 1.45, '重种后桌面为新尺寸')
assert.equal(reseeded.objects.length, 14, '重种后物品数为新场景规模')
assert.ok(
  reseeded.objects.some((o) => o.id === 'demo-thermos'),
  '重种后包含新增的保温杯',
)
assert.ok(
  !reseeded.objects.some((o) => o.model.shape === 'book' || o.model.shape === 'books'),
  '重种后不再生成书本模型',
)
assert.ok(
  !reseeded.objects.some((o) => o.id === 'demo-books'),
  '重种后不再有旧的叠放书本 id',
)

// A reseed must preserve edits in the archived demo and leave user projects intact.
const initialProjects = useProjectsStore.getState().projects
const editedPrevious = {
  ...fresh, demoSeedVersion: 5,
  objects: fresh.objects.map((o, i) => i === 0 ? { ...o, name: '保留用户编辑', dimensions: { ...o.dimensions, width: .4 } } : o),
}
try {
  useProjectsStore.setState({ projects: { [DEMO_PROJECT_ID]: editedPrevious, [userProject.id]: userProject } })
  useProjectsStore.getState().ensureDemo()
  const projects = useProjectsStore.getState().projects
  const archives = Object.values(projects).filter((p) => p.id.startsWith(`${DEMO_PROJECT_ID}-seed-`))
  assert.equal(archives.length, 1)
  assert.equal(archives[0].objects[0].name, '保留用户编辑')
  assert.deepEqual(archives[0].objects[0].dimensions, editedPrevious.objects[0].dimensions)
  assert.equal(archives[0].objects[0].projectId, archives[0].id)
  assert.equal(archives[0].isDemo, false)
  assert.deepEqual(projects[userProject.id], userProject)
  assert.equal(projects[DEMO_PROJECT_ID].demoSeedVersion, DEMO_SEED_VERSION)
  assert.equal(projects[DEMO_PROJECT_ID].organization?.typingOffsetX, -.06)
} finally {
  useProjectsStore.setState({ projects: initialProjects })
}

// v6 定向迁移：删书及其连线，其他物品、接口、房间与用户项目原样保留。
const bookIds = ['demo-book-math', 'demo-book-programming', 'demo-book-notebook']
const books: SceneObject[] = bookIds.map((id) => ({ ...fresh.objects[0], id, name: id,
  category: 'nonElectrical', ports: [], needsPower: false,
  model: { status: 'placeholder', source: 'demo', shape: 'book' },
}))
const v6: Project = structuredClone({ ...fresh, demoSeedVersion: 6 })
v6.objects[0].name = '保留自定义名称'
v6.objects[0].dimensions.width = .4
const printer = v6.objects.find((o) => o.id === 'demo-printer')!
printer.transform.position = [.7, .75, .5]
printer.ports[0].label = '用户已标记的电源口'
printer.ports[0].offset = [.1, .08, -.15]
v6.room.note = '保留房间编辑'
v6.organization = { ...v6.organization, typingOffsetX: -.08 }
const nonBooks = structuredClone(v6.objects)
v6.objects.push(...books)
v6.cables.push({ ...fresh.cables[0], id: 'removed-book-cable', from: { objectId: bookIds[0] } })
const custom: Project = { ...v6, id: userProject.id, isDemo: false }
try {
  useProjectsStore.setState({ projects: { [DEMO_PROJECT_ID]: v6, [custom.id]: custom } })
  useProjectsStore.getState().ensureDemo()
  const projects = useProjectsStore.getState().projects
  const migrated = projects[DEMO_PROJECT_ID]
  assert.equal(migrated.demoSeedVersion, 7)
  assert.deepEqual(migrated.objects, nonBooks, '仅删书，其余对象的所有字段保留')
  assert.deepEqual(migrated.room, v6.room)
  assert.deepEqual(migrated.organization, v6.organization)
  assert.deepEqual(migrated.cables.map((c) => c.id), fresh.cables.map((c) => c.id), '只删除书本关联线缆')
  assert.ok(migrated.cables.every((c) => c.status === 'stale'), '场景变更后旧走线失效')
  assert.deepEqual(projects[custom.id], custom, '自建项目中的书本和编辑保留')
  assert.equal(Object.keys(projects).length, 2, '定向迁移不重种或额外归档')
  useProjectsStore.getState().ensureDemo()
  assert.equal(useProjectsStore.getState().projects[DEMO_PROJECT_ID], migrated, '重复载入不再修改')
  useProjectsStore.getState().resetDemo()
  assert.equal(useProjectsStore.getState().projects[DEMO_PROJECT_ID].objects.length, 14)
  assert.ok(!useProjectsStore.getState().projects[DEMO_PROJECT_ID].objects.some((o) => bookIds.includes(o.id)))
} finally {
  useProjectsStore.setState({ projects: initialProjects })
}

console.log('Demo seed checks passed: 14 objects without books, targeted v6 migration, preserved edits, legacy archives and idempotence.')
