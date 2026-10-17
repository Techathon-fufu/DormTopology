import assert from 'node:assert/strict'
import { resolveDropCommit } from '../src/scene/dragCommit'
import { placementIssues } from '../src/scene/sceneValidation'
import { useWorkspaceStore } from '../src/state/workspaceStore'
import { createDemoProject } from '../src/data/demoProject'
import type { Vec3 } from '../src/types/project'

console.log('--- Testing dragCommit without collision bounce back ---')

const startPos: Vec3 = [0.1, 0.75, 0.2]
const lastValidPos: Vec3 = [0.15, 0.75, 0.2]
const collidingPos: Vec3 = [0.35, 0.75, 0.45]

// 1. 拖动到干涉/相交位置（finalValid = false）：不应弹回 lastValid 或 start，必须直接提交落点 finalPos
const dropColliding = resolveDropCommit(startPos, lastValidPos, collidingPos, false)
assert.deepEqual(
  dropColliding,
  collidingPos,
  '拖动落点存在干涉时，应直接保留落点位置，不能弹回到上次有效位置或起点',
)

// 2. 拖动到有效位置（finalValid = true）：提交 finalPos
const dropValid = resolveDropCommit(startPos, lastValidPos, [0.5, 0.75, 0.5], true)
assert.deepEqual(dropValid, [0.5, 0.75, 0.5], '拖动落点有效时正常提交')

// 3. 拖动后松手在原起点（未产生实际位移）：返回 null，避免生成空撤销历史
const dropUnmoved = resolveDropCommit(startPos, lastValidPos, [...startPos], false)
assert.equal(dropUnmoved, null, '落点与起点一致时不应产生提交')

console.log('✓ resolveDropCommit: 验证通过，已取消干涉弹回并正确保留落点')

console.log('--- Testing interference detection (placementIssues) ---')
const project = createDemoProject()
const objA = project.objects[0]
const objB = project.objects[1]
// 将 objA 移动到与 objB 重合的位置以构造干涉
const overlappingPosition: Vec3 = [...objB.transform.position]
const issues = placementIssues(objA, overlappingPosition, project.objects, project.room)

assert.ok(
  issues.length > 0,
  '物品放置于重叠位置时，应检出干涉问题',
)
assert.ok(
  issues.some((i) => i.type === 'overlap' || i.type === 'roomCollision'),
  '应包含 overlap 或 roomCollision 干涉类型，用于 UI 呈现警示',
)

console.log(`✓ placementIssues: 成功检出 ${issues.length} 项干涉问题，仅作警示不拦截摆放`)

console.log('--- Testing workspaceStore notice ---')
useWorkspaceStore.getState().setNotice('已摆放「显示器」，注意存在干涉冲突（可撤销）')
assert.equal(
  useWorkspaceStore.getState().notice,
  '已摆放「显示器」，注意存在干涉冲突（可撤销）',
  'workspaceStore 应能正确记录操作干涉提醒',
)
useWorkspaceStore.getState().setNotice(null)
assert.equal(useWorkspaceStore.getState().notice, null, '提示消费后应能正常重置')

console.log('✓ workspaceStore notice: 验证通过')
console.log('All drag-and-drop interference checks PASSED!')
