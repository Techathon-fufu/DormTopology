import type {
  CableConnection,
  LayoutAssignment,
  LayoutPlan,
  PlanCableSource,
  PlanSceneSnapshot,
  PlanSourceInfo,
  Project,
  RoomConfig,
  SceneObject,
  Vec3,
} from '@/types/project'
import { PLAN_SCENE_SNAPSHOT_VERSION } from '@/types/project'
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

/** JSON 深拷贝：保证快照与当前场景不共享引用、且可持久化（strips undefined） */
export function clonePlanData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 采集场景快照（房间 / 物品 / 线缆深拷贝） */
export function buildPlanSceneSnapshot(
  room: RoomConfig,
  objects: SceneObject[],
  cables: CableConnection[],
): PlanSceneSnapshot {
  return {
    version: PLAN_SCENE_SNAPSHOT_VERSION,
    room: clonePlanData(room),
    objects: clonePlanData(objects),
    cables: clonePlanData(cables),
  }
}

const CABLE_SOURCE_MAP: Record<NonNullable<CableConnection['planSource']>, PlanCableSource> = {
  'demo-rule': 'rule',
  manual: 'manual',
  algorithm: 'algorithm',
}

/** 推断方案来源：布局来自项目最近接受的整理方案；走线按各线缆规划来源汇总 */
export function derivePlanSource(project: Project): PlanSourceInfo {
  const sources = new Set<PlanCableSource>()
  for (const cable of project.cables) {
    sources.add(CABLE_SOURCE_MAP[cable.planSource ?? 'manual'])
  }
  const cable: PlanCableSource =
    project.cables.length === 0 ? 'none' : sources.size === 1 ? [...sources][0] : 'mixed'
  return { layout: project.layoutSource ?? 'unknown', cable }
}

/**
 * 由项目当前场景生成布局方案。
 * - kind = 'candidate'（默认）：写入完整场景快照与来源信息（0.8.0 起），供对比界面读取；
 * - kind = 'baseline'：仅记录物品指派（整理前快照，保持既有数据形态）。
 */
export function planFromProject(
  project: Project,
  kind: LayoutPlan['kind'],
  name: string,
  options?: { withScene?: boolean },
): LayoutPlan {
  const withScene = options?.withScene ?? kind === 'candidate'
  const now = Date.now()
  return {
    id: uid('plan'),
    projectId: project.id,
    name,
    kind,
    createdAt: now,
    updatedAt: now,
    assignments: project.objects.map(assignmentFromObject),
    scene: withScene ? buildPlanSceneSnapshot(project.room, project.objects, project.cables) : undefined,
    source: withScene ? derivePlanSource(project) : undefined,
    summary:
      kind === 'baseline' ? '整理前状态快照（进入工作台时自动采集）' : undefined,
  }
}

/** 复制方案：新 id、新创建 / 更新时间；场景快照深拷贝（与源方案不共享引用） */
export function duplicatePlan(plan: LayoutPlan, name: string): LayoutPlan {
  const now = Date.now()
  return {
    ...clonePlanData(plan),
    id: uid('plan'),
    name,
    createdAt: now,
    updatedAt: now,
  }
}
