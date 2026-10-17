import assert from 'node:assert/strict'
import { createDemoProject, DEMO_PROJECT_ID, DEMO_SEED_VERSION } from '../src/data/demoProject'
import { isDemoProjectStale, useProjectsStore } from '../src/state/projectsStore'
import type { Project } from '../src/types/project'

// ── 示例数据本身：种子版本与场景规模 ─────────────────────────────────────────
const fresh = createDemoProject()
assert.equal(fresh.demoSeedVersion, DEMO_SEED_VERSION, '新种入的示例项目带当前种子版本')
assert.equal(fresh.room.desk.width, 1.45, 'L 形桌面包络宽 1450mm')
assert.equal(fresh.room.desk.depth, 0.86, 'L 形桌面包络深 860mm')
assert.equal(fresh.room.furnitureModel, 'dormdesk-v1')
assert.equal(fresh.objects.length, 17, '示例场景 17 件物品')
assert.equal(fresh.organization?.typingOffsetX, -.06, '真实笔记本需要主桌面的侧部净宽')
assert.equal(fresh.organization?.typingWidth, .55, '键鼠区保持原宽度')
assert.equal(fresh.room.outlets.length, 1, '示例房间仅一块插座面板（固定模型口径）')
assert.equal(fresh.room.outlets[0].id, 'outlet-1', '插座面板 id 稳定')
assert.deepEqual(fresh.room.outlets[0].position, [0, 0.35, 0.01], '插座后墙居中、距地 350mm')
assert.equal(fresh.room.outlets[0].slots, 2, '面板为两个双插孔插座')

// ── isDemoProjectStale：判定边界 ────────────────────────────────────────────
assert.equal(isDemoProjectStale(undefined), false, '不存在时不算 stale（由调用方负责创建）')
assert.equal(isDemoProjectStale(fresh), false, '当前版本不算 stale')

// 模拟浏览器里遗留的旧数据：没有 demoSeedVersion 字段（0.7.0 之前写入）
const legacy = { ...fresh, demoSeedVersion: undefined } as Project
assert.equal(isDemoProjectStale(legacy), true, '缺字段的旧数据必须判为 stale（这正是本次修复的核心场景）')

// 模拟上一版种子：仍要重种
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
assert.equal(reseeded.objects.length, 17, '重种后物品数为新场景规模')
assert.ok(
  reseeded.objects.some((o) => o.id === 'demo-thermos'),
  '重种后包含新增的保温杯',
)
assert.ok(
  reseeded.objects.filter((o) => o.model.shape === 'book').length === 3,
  '重种后为三本独立书本',
)
assert.ok(
  !reseeded.objects.some((o) => o.id === 'demo-books'),
  '重种后不再有旧的叠放书本 id',
)

// A reseed must preserve edits in the archived demo and leave user projects intact.
const initialProjects = useProjectsStore.getState().projects
const editedPrevious = {
  ...fresh, demoSeedVersion: DEMO_SEED_VERSION - 1,
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

console.log(
  'Demo seed checks passed: seed boundaries, versioned L-shaped furniture and the 17-item scene with a single dual-socket outlet panel.',
)
