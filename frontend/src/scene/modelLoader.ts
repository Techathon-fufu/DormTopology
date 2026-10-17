import * as THREE from 'three'

/**
 * 模型文件加载封装（GLTFLoader，按需动态加载解析器）：
 * 桌体 GLB（DormDeskModel）与后续生成的物品模型（importModel）共用同一入口。
 * 失败时抛出可读错误（404 时给出文件放置路径指引）。
 */

export interface LoadedModelData {
  scene: THREE.Group
  animations: THREE.AnimationClip[]
}

export async function loadModelFromUrl(url: string): Promise<LoadedModelData> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js')
  const loader = new GLTFLoader()
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations }),
      undefined,
      (error) => reject(new Error(describeLoadError(url, error))),
    )
  })
}

function describeLoadError(url: string, error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ((error as { message?: string } | null | undefined)?.message ?? '未知错误')
  // 404（生产静态服务）或 SPA 回退把 index.html 当模型返回（Vite dev 对缺失文件）
  if (/404/.test(raw) || /Unexpected token '<'|<!DOCTYPE|<html/i.test(raw)) {
    return `未找到模型文件（${url}）。请将 dorm_desk_assembled.glb 放入 frontend/public/models/ 目录，然后点击「重试」。`
  }
  return `模型加载失败：${raw}`
}

/** 释放模型占用的几何体 / 材质 / 贴图（切换模型或卸载时调用） */
export function disposeObject3D(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>()
  root.traverse((node) => {
    const mesh = node as THREE.Mesh
    if (mesh.geometry) mesh.geometry.dispose()
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((m) => materials.add(m))
    else if (material) materials.add(material)
  })
  materials.forEach((material) => {
    for (const value of Object.values(material as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) value.dispose()
    }
    material.dispose()
  })
}
