import * as THREE from 'three'
import type { Vec3 } from '@/types/project'
import { disposeObject3D, loadModelFromUrl } from './modelLoader'
import { repairPrefabWinding } from './meshWinding'

/**
 * 动态导入外部 / 生成的单个模型文件（GLB / glTF）：供后续「生成物品模型」复用。
 *
 * - 返回的 group 已按「底面中心」锚点对齐：group.position 即物品底面中心（与 SceneObject 约定一致）；
 * - 调用方负责把 group 挂到场景（R3F：<primitive object={group} />），并在移除时调用 dispose()；
 * - 与桌体 GLB 共用同一加载封装（modelLoader.ts）；当前物品渲染仍使用参数化占位几何
 *   （生成流程产物尚未落盘为 GLB），本接口为后续阶段预留，界面未接入时不产生行为变化。
 */

export interface ImportModelOptions {
  /** 源单位换算（默认 1 = 米） */
  unitScale?: number
  /** 绕 Y 轴旋转校正（弧度） */
  rotationY?: number
  /** 统一缩放到指定宽度（米）；默认 null 保持原尺寸 */
  fitWidthM?: number | null
  /** 是否投射 / 接收阴影（默认 true） */
  castShadow?: boolean
}

export interface ImportedModel {
  name: string
  /** 已归一化的模型分组（position = 底面中心） */
  group: THREE.Group
  /** 归一化后的包围盒尺寸（米） */
  size: Vec3
  /** Authored clips stay available to callers that choose to play them. */
  animations: THREE.AnimationClip[]
  dispose: () => void
}

export async function importModel(
  url: string,
  name: string,
  position: Vec3,
  options: ImportModelOptions = {},
): Promise<ImportedModel> {
  const { unitScale = 1, rotationY = 0, fitWidthM = null, castShadow = true } = options
  const { scene, animations } = await loadModelFromUrl(url)
  // Only consistently wound, closed components are changed. Open cup-like
  // surfaces, non-manifold geometry, UVs, textures and material settings remain authored.
  repairPrefabWinding(scene)

  const group = new THREE.Group()
  group.name = name
  group.add(scene)
  if (unitScale !== 1) group.scale.multiplyScalar(unitScale)
  if (rotationY !== 0) group.rotation.y += rotationY
  group.updateMatrixWorld(true)

  if (fitWidthM) {
    const fitBox = new THREE.Box3().setFromObject(group)
    if (!fitBox.isEmpty()) {
      const width = fitBox.getSize(new THREE.Vector3()).x
      if (width > 1e-6) {
        group.scale.multiplyScalar(fitWidthM / width)
        group.updateMatrixWorld(true)
      }
    }
  }

  // 以包围盒底面中心为原点：group.position 即「底面中心锚点」
  let size: Vec3 = [0, 0, 0]
  const box = new THREE.Box3().setFromObject(group)
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3())
    scene.position.x -= center.x
    scene.position.z -= center.z
    scene.position.y -= box.min.y
    group.updateMatrixWorld(true)
    const finalSize = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3())
    size = [finalSize.x, finalSize.y, finalSize.z]
  }

  group.position.set(position[0], position[1], position[2])
  group.traverse((node) => {
    if ((node as THREE.Mesh).isMesh) {
      node.castShadow = castShadow
      node.receiveShadow = castShadow
    }
  })

  return { name, group, size, animations, dispose: () => disposeObject3D(group) }
}
