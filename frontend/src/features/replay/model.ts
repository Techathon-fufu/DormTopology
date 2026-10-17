import type { SceneObject } from '@/types/project'
export interface ReplayStep { id: string; name: string; before?: SceneObject; after?: SceneObject }
export function replaySteps(before: SceneObject[], after: SceneObject[]): ReplayStep[] {
  const old = new Map(before.map((o) => [o.id, o]))
  const next = new Map(after.map((o) => [o.id, o]))
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const same = (a: SceneObject, b: SceneObject) => a.transform.position.every((n, i) => near(n, b.transform.position[i]))
    && near(Math.sin(a.transform.rotationY - b.transform.rotationY), 0) && Math.cos(a.transform.rotationY - b.transform.rotationY) > 0
    && near(a.dimensions.width, b.dimensions.width) && near(a.dimensions.height, b.dimensions.height) && near(a.dimensions.depth, b.dimensions.depth)
    && a.visible === b.visible && a.model.prefabId === b.model.prefabId && a.model.shape === b.model.shape && a.model.assetUrl === b.model.assetUrl
  return [...new Set([...before.map((o) => o.id), ...after.map((o) => o.id)])].flatMap((id) => {
    const a = old.get(id), b = next.get(id)
    return a && b && same(a, b) ? [] : [{ id, name: (b ?? a)!.name, before: a, after: b }]
  })
}
/** Visual sequence only; immutable input snapshots are never edited. */
export function replayObjects(before: SceneObject[], steps: ReplayStep[], cursor: number): SceneObject[] {
  const objects = new Map(before.map((o) => [o.id, o]))
  steps.forEach((step, i) => {
    const t = Math.max(0, Math.min(1, cursor - i))
    if (!t) return
    if (!step.after) { if (t >= 1) objects.delete(step.id); return }
    if (!step.before || t >= 1) { objects.set(step.id, step.after); return }
    const a = step.before.transform, b = step.after.transform
    const angle = Math.atan2(Math.sin(b.rotationY - a.rotationY), Math.cos(b.rotationY - a.rotationY))
    objects.set(step.id, { ...step.after, transform: {
      position: [a.position[0] + (b.position[0] - a.position[0]) * t, a.position[1] + (b.position[1] - a.position[1]) * t + Math.sin(Math.PI * t) * .12, a.position[2] + (b.position[2] - a.position[2]) * t],
      rotationY: a.rotationY + angle * t,
    } })
  })
  return [...objects.values()]
}
