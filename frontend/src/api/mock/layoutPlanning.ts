import { sleep, uid } from '@/lib/utils'
import type { LayoutAssignment, ObjectCategory, SceneObject, Vec3 } from '@/types/project'
import type { LayoutPlanningService } from '../types'

/**
 * 模拟自动整理：按三大分类分带摆放，旋转归零，地面物品保持原位。
 * 产出「候选方案」（kind = candidate），可在工作台应用并保存对比。
 */

const CATEGORY_ROW_Z: Record<ObjectCategory, number> = {
  electrical: -0.14, // 靠后墙一帯
  nonElectrical: 0.0,
  storage: 0.14,
}

const ZONE_BY_CATEGORY: Record<ObjectCategory, LayoutAssignment['zone']> = {
  electrical: 'deskBack',
  nonElectrical: 'deskFront',
  storage: 'deskSide',
}

function overlapsXZ(a: SceneObject, pa: Vec3, b: SceneObject, pb: Vec3): boolean {
  const halfW = (a.dimensions.width + b.dimensions.width) / 2
  const halfD = (a.dimensions.depth + b.dimensions.depth) / 2
  return Math.abs(pa[0] - pb[0]) < halfW && Math.abs(pa[2] - pb[2]) < halfD
}

export const mockLayoutPlanningService: LayoutPlanningService = {
  async planLayout({ projectId, objects, room, onProgress }) {
    onProgress?.(0.15, '分析物品占用')
    await sleep(400)
    onProgress?.(0.5, '按类别分带摆放')
    await sleep(500)

    const desk = room.desk
    const deskCenterZ = desk.depth / 2 + 0.05
    const margin = 0.06
    const gap = 0.03

    const fixedObjects = objects.filter((o) => o.fixed || o.locked)
    const floorObjects = objects.filter((o) => o.transform.position[1] < 0.1 && !o.fixed && !o.locked)
    const deskObjects = objects.filter(
      (o) => o.transform.position[1] >= 0.1 && o.visible && !o.fixed && !o.locked,
    )

    const assignments: LayoutAssignment[] = []
    const placed: Array<{ object: SceneObject; position: Vec3 }> = []

    // 固定摆放 / 锁定位置的物品保持原位，不参与自动整理
    for (const obj of fixedObjects) {
      assignments.push({
        objectId: obj.id,
        position: obj.transform.position,
        rotationY: obj.transform.rotationY,
        zone: obj.transform.position[1] >= 0.1 ? 'free' : 'floor',
      })
    }

    for (const category of ['electrical', 'nonElectrical', 'storage'] as ObjectCategory[]) {
      const group = deskObjects
        .filter((o) => o.category === category)
        .sort((a, b) => b.dimensions.width - a.dimensions.width)

      let cursorX = -desk.width / 2 + margin
      let rowIndex = 0
      for (const obj of group) {
        const rowZ = CATEGORY_ROW_Z[category] + deskCenterZ + rowIndex * 0.16
        if (cursorX + obj.dimensions.width > desk.width / 2 - margin) {
          rowIndex += 1
          cursorX = -desk.width / 2 + margin
        }
        const position: Vec3 = [cursorX + obj.dimensions.width / 2, desk.height, rowZ]
        assignments.push({
          objectId: obj.id,
          position,
          rotationY: 0,
          zone: ZONE_BY_CATEGORY[category],
        })
        placed.push({ object: obj, position })
        cursorX += obj.dimensions.width + gap
      }
    }

    for (const obj of floorObjects) {
      assignments.push({
        objectId: obj.id,
        position: obj.transform.position,
        rotationY: obj.transform.rotationY,
        zone: 'floor',
      })
    }

    // 简易整理度评估（本地模拟计算）
    let score = 100
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        if (overlapsXZ(placed[i].object, placed[i].position, placed[j].object, placed[j].position)) {
          score -= 6
        }
      }
    }
    score -= deskObjects.filter((o) => o.transform.rotationY !== 0).length * 1
    score = Math.max(0, Math.min(100, score))

    onProgress?.(0.9, '评估整理度')
    await sleep(300)
    onProgress?.(1, '完成')

    const summary = `模拟自动整理：${deskObjects.length} 件物品按类别分带摆放、旋转归零；${floorObjects.length} 件地面物品与 ${fixedObjects.length} 件固定/锁定物品保持原位`
    return {
      plan: {
        id: uid('plan'),
        projectId,
        name: '自动整理方案（模拟）',
        kind: 'candidate',
        createdAt: Date.now(),
        assignments,
        score,
        summary,
      },
      score,
      summary,
    }
  },
}
