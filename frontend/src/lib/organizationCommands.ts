import type { SceneObject, Vec3 } from '@/types/project'
import { ZONE_LABELS, type OrganizationPlan } from '@/types/organization'

export interface OrganizationCommand {
  id: string
  objectId: string
  objectIds: string[]
  label: string
  reason: string
  durationMs: number
  position: Vec3
  rotationY: number
}

/** Local display commands compiled from structured suggestions; never executable prose. */
export function compileOrganizationCommands(plan: OrganizationPlan, objects: SceneObject[]): OrganizationCommand[] {
  const seen = new Set<string>()
  return plan.assignments.flatMap((a) => {
    const o = objects.find((item) => item.id === a.objectId)
    if (!o || seen.has(a.objectId)) throw new Error('整理指令引用了未知或重复物品')
    seen.add(a.objectId)
    if (a.position.length !== 3 || ![...a.position, a.rotationY].every(Number.isFinite)) {
      throw new Error('整理指令包含无效位置或朝向')
    }
    const moved = a.position.some((v, i) => Math.abs(v - o.transform.position[i]) > 0.00001)
    const angle = Math.atan2(Math.sin(a.rotationY - o.transform.rotationY), Math.cos(a.rotationY - o.transform.rotationY))
    if ((o.fixed || o.locked) && (moved || Math.abs(angle) > 0.00001)) throw new Error(`固定物品不能移动：${o.name}`)
    if (!moved && Math.abs(angle) < 0.00001) return []
    return [{ id: `operation-${o.id}`, objectId: o.id, objectIds: [o.id],
      label: `${o.name} → ${ZONE_LABELS[a.zone]}`, reason: a.reason,
      durationMs: 1200, position: [...a.position] as Vec3, rotationY: a.rotationY }]
  })
}
