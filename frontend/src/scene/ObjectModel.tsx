import * as THREE from 'three'
import { useEffect, useState, type ReactNode } from 'react'
import type { PrimitiveShape, SceneObject } from '@/types/project'
import { resolvePublicAssetUrl } from './deskModel'
import { loadModelFromUrl } from './modelLoader'
import { PrimitiveModel } from './models'
import { prefabItemOf } from './prefabItems'

/**
 * 物品外观统一入口：命中有预制模型（model.prefabId）时渲染真实 GLB（Prefabmodel 随包资产），
 * 否则回退参数化占位几何。工作台 / 方案对比 / 交付预览共用，保证三处外观一致。
 *
 * 锚点归一化：预制源文件的锚点不统一（部分底心在 y=0、部分几何居中，如 mouse / keyboard /
 * books_stack / laptop_fold），加载后统一归一到「底面中心」——与 SceneObject.transform.position
 * 的约定及随包碰撞数据（collisionsize，底心锚定）一致，其余渲染层无需感知差异。
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
      scene.position.y -= box.min.y
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
export function PrefabItemModel({ url, fallback }: { url: string; fallback: ReactNode }) {
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
  return <primitive object={group} />
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
      fallback={<PrimitiveModel shape={shape} dims={object.dimensions} color={color} sockets={sockets} />}
    />
  )
}
