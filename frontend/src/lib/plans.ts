import type { LayoutAssignment, LayoutPlan, Project, SceneObject, Vec3 } from '@/types/project'
import { uid } from '@/lib/utils'

/** 由场景对象生成布局指派（用于采集整理前快照 / 保存对比方案） */
export function assignmentFromObject(o: SceneObject): LayoutAssignment {
  const y = o.transform.position[1]
  return {
    objectId: o.id,
    position: [...o.transform.position] as Vec3,
    rotationY: o.transform.rotationY,
    zone: y < 0.1 ? 'floor' : 'free',
  }
}

export function planFromProject(project: Project, kind: LayoutPlan['kind'], name: string): LayoutPlan {
  return {
    id: uid('plan'),
    projectId: project.id,
    name,
    kind,
    createdAt: Date.now(),
    assignments: project.objects.map(assignmentFromObject),
    summary:
      kind === 'baseline' ? '整理前状态快照（进入工作台时自动采集）' : undefined,
  }
}
