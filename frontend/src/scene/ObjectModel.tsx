import * as THREE from 'three'
import { useEffect, useState, type ReactNode } from 'react'
import type { ObjectDimensions, PrimitiveShape, SceneObject, Vec3 } from '@/types/project'
import { resolvePublicAssetUrl } from './deskModel'
import { loadModelFromUrl } from './modelLoader'
import { PrimitiveModel } from './models'
import { prefabItemOf } from './prefabItems'

/**
 * 物品外观统一入口：命中有预制模型（model.prefabId）时渲染真实 GLB（Prefabmodel 随包资产），
 * 否则回退参数化占位几何。工作台 / 方案对比 / 交付预览共用，保证三处外观一致。
 *
 * 锚点归一化：预制源文件的锚点不统一（部分底心在 y=0、部分几何居中，如 mouse / keyboard /
 * books_stack / laptop_fold），加载后统一归一到「包围盒中心」——与调用侧渲染口径一致
 * （外层 group 平移到 position[1] + height/2，模型自身以中心为原点，底面恰好落在 position）。
 * 外观同时按声明尺寸各轴等比缩放（基准 = 随包碰撞数据的实测外包，prefabItems.size），
 * 与碰撞体（collisionGeometry 按同一基准缩放）同口径，尺寸编辑 / 整体缩放两侧同步。
 */

/** 预制物品 GLB 的模块级模板缓存（归一化后的模板；每个实例克隆后挂载） */
const templateCache = new Map<string, Promise<THREE.Group>>()

function loadPrefabTemplate(url: string): Promise<THREE.Group> {
  const cached = templateCache.get(url)
  if (cached) return cached
  const promise = loadModelFromUrl(url).then(({ scene }) => {
    const box = new THREE.Box3().setFromObject(scene)
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3())
      scene.position.x -= center.x
      scene.position.z -= center.z
      // 垂直归一到包围盒中心（而非底面）：调用侧按 height/2 外移，模型底面即落在 position
      scene.position.y -= center.y
    }
    scene.traverse((node) => {
      const mesh = node as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    })
    return scene
  })
  // 失败不保留废缓存（下次挂载可重试）；已在模板内的几何由缓存持有，不做逐实例释放
  promise.catch(() => templateCache.delete(url))
  templateCache.set(url, promise)
  return promise
}

/** 预制物品模型：加载前 / 加载失败时显示传入的回退占位几何（形状语义不变，仅外观替换） */
export function PrefabItemModel({
  url,
  size,
  dims,
  fallback,
}: {
  url: string
  /** 随包碰撞数据实测外包尺寸（缩放基准，米） */
  size: Vec3
  /** 当前声明尺寸（米） */
  dims: ObjectDimensions
  fallback: ReactNode
}) {
  const [group, setGroup] = useState<THREE.Group | null>(null)
  const resolved = resolvePublicAssetUrl(url)
  useEffect(() => {
    let alive = true
    loadPrefabTemplate(resolved)
      .then((template) => {
        if (alive) setGroup(template.clone(true))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [resolved])
  if (!group) return <>{fallback}</>
  // 与碰撞体同口径：按声明尺寸各轴等比缩放（围绕归一化后的包围盒中心）
  const scale: [number, number, number] = [
    size[0] > 1e-6 ? dims.width / size[0] : 1,
    size[1] > 1e-6 ? dims.height / size[1] : 1,
    size[2] > 1e-6 ? dims.depth / size[2] : 1,
  ]
  return (
    <group scale={scale}>
      <primitive object={group} />
    </group>
  )
}

export function ObjectModel({
  object,
  shape,
  color,
  sockets,
}: {
  object: SceneObject
  /** 回退占位几何的形状（调用方决定：模型未完成时用 genericBox 等） */
  shape?: PrimitiveShape
  color: string
  sockets?: number
}) {
  const def = prefabItemOf(object)
  if (!def) {
    return <PrimitiveModel shape={shape} dims={object.dimensions} color={color} sockets={sockets} />
  }
  return (
    <PrefabItemModel
      url={def.url}
      size={def.size}
      dims={object.dimensions}
      fallback={<PrimitiveModel shape={shape} dims={object.dimensions} color={color} sockets={sockets} />}
    />
  )
}
