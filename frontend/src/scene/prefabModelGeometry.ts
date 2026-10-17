import { Box3, Group, Mesh, Vector3 } from 'three'
import type { SceneObject } from '@/types/project'

export interface PrefabTemplate {
  group: Group
  size: Vector3
}

/** Normalize through a parent so authored root transforms remain intact. */
export function normalizePrefabTemplate(scene: Group): PrefabTemplate {
  scene.updateMatrixWorld(true)
  const box = new Box3().setFromObject(scene)
  const size = box.getSize(new Vector3())
  if (box.isEmpty() || [size.x, size.y, size.z].some((value) => value <= 1e-9)) {
    throw new Error('预制模型没有有效的三维边界')
  }
  const center = box.getCenter(new Vector3())
  const group = new Group()
  group.position.set(-center.x, -box.min.y, -center.z)
  group.add(scene)
  scene.traverse((node) => {
    if (node instanceof Mesh) {
      node.castShadow = true
      node.receiveShadow = true
    }
  })
  return { group, size }
}

/** Callers position at bottom + half height, so return geometry centered on local Y. */
export function createPrefabInstance(template: PrefabTemplate, dims: SceneObject['dimensions']): Group {
  const scaled = new Group()
  scaled.scale.set(dims.width / template.size.x, dims.height / template.size.y, dims.depth / template.size.z)
  scaled.add(template.group.clone(true))
  const centered = new Group()
  centered.position.y = -dims.height / 2
  centered.add(scaled)
  return centered
}
