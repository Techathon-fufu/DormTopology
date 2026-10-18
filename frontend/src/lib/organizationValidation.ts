import type { LayoutAssignment, Project, RoomConfig, SceneObject } from '@/types/project'
import { isBook, validBookPose } from '@/scene/bookPose'
import type { OrganizationPlan } from '@/types/organization'
import { placementIssues } from '@/scene/sceneValidation'
import { organizationClearanceIssues } from '@/scene/organizationClearance'

export function organizationPlanFailure(plan: OrganizationPlan): string | null {
  if (plan.serviceMeta?.status === 'infeasible' || plan.serviceMeta?.applicable === false) {
    return plan.serviceMeta.issues?.map((issue) => issue.message).filter(Boolean).join('；') || '当前场景没有可应用的整理方案'
  }
  if (plan.metrics.overlapCount > 0 || plan.metrics.outOfBoundsCount > 0) {
    return '目标布局仍有相交、越界或场地穿模问题，请调整场景后重新生成'
  }
  return null
}

/** Validate the whole candidate before any persistent state or undo history changes. */
export function assertScenePlacement(objects: SceneObject[], room: RoomConfig, current: SceneObject[]): void {
  const currentById = new Map(current.map((object) => [object.id, object]))
  const ids = new Set<string>()
  for (const object of objects) {
    if (ids.has(object.id)) throw new Error(`物品 ID 重复：${object.id}`)
    ids.add(object.id)
    const { position, rotationY } = object.transform
    if (object.transform.bookPose !== undefined && !validBookPose(object.transform.bookPose)) throw new Error(`书本姿态无效：${object.name}`)
    if (position.length !== 3 || ![...position, rotationY].every(Number.isFinite)) {
      throw new Error(`物品位置或朝向无效：${object.name}`)
    }
    if (!Object.values(object.dimensions).every((value) => Number.isFinite(value) && value > 0)) {
      throw new Error(`物品尺寸无效：${object.name}`)
    }
    const original = currentById.get(object.id)
    if (original && (original.fixed || original.locked)) {
      const moved = position.some((value, index) => Math.abs(value - original.transform.position[index]) > 0.00001)
      const angle = rotationY - original.transform.rotationY
      if ((object.transform.bookPose ?? 'original') !== (original.transform.bookPose ?? 'original') || moved || Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) > 0.00001) {
        throw new Error(`固定或锁定物品不能移动：${object.name}`)
      }
    }
  }
  const candidates = objects.map((object) => ({ ...object, visible: true }))
  const messages = candidates.flatMap((object) =>
    placementIssues(object, object.transform.position, candidates, room).map((issue) => `${object.name}：${issue.message}`),
  )
  if (messages.length > 0) throw new Error(`布局校验未通过：${messages.slice(0, 3).join('；')}${messages.length > 3 ? `；另有 ${messages.length - 3} 项` : ''}`)
}

/** Recommended layouts also retain handling clearance; baseline and undo keep their original policy. */
export function assertRecommendedScenePlacement(objects: SceneObject[], room: RoomConfig, current: SceneObject[]): void {
  assertScenePlacement(objects, room, current)
  const issues = organizationClearanceIssues(objects, room)
  if (issues.length) throw new Error(`布局校验未通过：${issues.slice(0, 3).map((issue) => issue.message).join('；')}${issues.length > 3 ? `；另有 ${issues.length - 3} 项` : ''}`)
}

export function objectsWithAssignments(
  objects: SceneObject[],
  assignments: Pick<LayoutAssignment, 'objectId' | 'position' | 'rotationY' | 'bookPose'>[],
): SceneObject[] {
  const objectIds = new Set(objects.map((object) => object.id))
  const assignedIds = new Set<string>()
  for (const assignment of assignments) {
    if (!objectIds.has(assignment.objectId) || assignedIds.has(assignment.objectId)) {
      throw new Error('整理方案引用了未知或重复物品')
    }
    assignedIds.add(assignment.objectId)
  }
  const byId = new Map(assignments.map((assignment) => [assignment.objectId, assignment]))
  return objects.map((object) => {
    const assignment = byId.get(object.id)
    return assignment ? {
      ...object,
      transform: { ...object.transform, bookPose: assignment.bookPose ?? (isBook(object) ? 'original' : object.transform.bookPose), position: [...assignment.position] as SceneObject['transform']['position'], rotationY: assignment.rotationY },
    } : object
  })
}

export function assertOrganizationApplicable(plan: OrganizationPlan, project: Project): void {
  if (plan.projectId !== project.id) throw new Error('整理方案属于其他场景，请重新生成')
  const failure = organizationPlanFailure(plan)
  if (failure) throw new Error(failure)
  if (plan.kind === 'algorithm') {
    const meta = plan.serviceMeta
    if (!meta || !meta.sceneId || !meta.jobId || !Number.isInteger(meta.sceneRevision) || meta.sceneRevision < 0 || meta.applicable !== true) {
      throw new Error('后端方案缺少有效的场景版本或应用确认，请重新生成')
    }
  }
  assertRecommendedScenePlacement(objectsWithAssignments(project.objects, plan.assignments), project.room, project.objects)
}
