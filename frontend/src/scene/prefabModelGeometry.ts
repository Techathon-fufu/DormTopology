import { AnimationClip, Box3, Group, Mesh, Vector3 } from 'three'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { SceneObject } from '@/types/project'

export interface PrefabTemplate {
  group: Group
  size: Vector3
  animations: AnimationClip[]
}

/** The closed-laptop export repeats the entire attribute range for each material. */
export function removeDuplicatePrefabPrimitives(scene: Group): void {
  scene.updateMatrixWorld(true)
  const kept: Mesh[] = [], duplicates: Mesh[] = []
  scene.traverse(node => {
    if (!(node instanceof Mesh)) return
    const duplicate = kept.some(other => {
      if (!node.matrixWorld.equals(other.matrixWorld) || node.geometry.index !== other.geometry.index) return false
      const keys = Object.keys(node.geometry.attributes)
      return keys.length === Object.keys(other.geometry.attributes).length &&
        keys.every(key => node.geometry.getAttribute(key) === other.geometry.getAttribute(key))
    })
    if (duplicate) duplicates.push(node)
    else kept.push(node)
  })
  duplicates.forEach(node => node.removeFromParent())
  const keptGeometry = new Set(kept.map(node => node.geometry))
  const keptMaterial = new Set(kept.flatMap(node => Array.isArray(node.material) ? node.material : [node.material]))
  duplicates.forEach(node => {
    if (!keptGeometry.has(node.geometry)) node.geometry.dispose()
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      if (!keptMaterial.has(material)) material.dispose()
    }
  })
}

/** Normalize through a parent so authored root transforms remain intact. */
export function normalizePrefabTemplate(scene: Group, animations: AnimationClip[] = []): PrefabTemplate {
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
  return { group, size, animations }
}

/** Callers position at bottom + half height, so return geometry centered on local Y. */
export function createPrefabInstance(template: PrefabTemplate, dims: SceneObject['dimensions']): Group {
  const scaled = new Group()
  scaled.scale.set(dims.width / template.size.x, dims.height / template.size.y, dims.depth / template.size.z)
  // SkeletonUtils keeps skinned imports correctly bound while static prefabs still
  // share immutable geometry/material resources from the cached display template.
  scaled.add(cloneSkeleton(template.group) as Group)
  const centered = new Group()
  centered.position.y = -dims.height / 2
  centered.add(scaled)
  return centered
}
