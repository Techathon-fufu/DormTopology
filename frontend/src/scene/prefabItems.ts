import type { ModelRef, PrimitiveShape, SceneObject, Vec3 } from '@/types/project'
import { boundsOf } from './collisionGeometry'
import { PREFAB_ITEM_COLLISIONS } from './prefabItemCollisions.generated'

/**
 * 物品预制模型注册表（源资产 Prefabmodel/*.glb + collisionsize 碰撞数据，
 * 经 scripts/sync-prefab-items.ts 同步）。
 *
 * - 渲染：SceneObjectMesh / 对比页 / 交付页按 model.prefabId 加载 items/<id>.glb，
 *   锚点统一归一化到底面中心（源文件有的底心、有的几何居中，见 ObjectModel.tsx）；
 * - 碰撞：collisionGeometry.localCollision 直接采用随包碰撞数据（与模型同源、同底心约定），
 *   不再用尺寸参数化的占位几何近似；
 * - model.shape 仍是语义键（整理规则 / 后端打包 / 图标按语义形状分发），不随模型接入变化。
 */

export interface PrefabItemDef {
  id: string
  label: string
  /** 运行时资源路径（frontend/public 下相对路径；经 resolvePublicAssetUrl 解析） */
  url: string
  /** 碰撞数据实测外包尺寸（米；渲染归一化与诊断用） */
  size: Vec3
}

const LABELS: Record<string, string> = {
  books_stack: '书本堆',
  charger: '充电器',
  cup: '水杯（带把手）',
  keyboard: '键盘',
  laptop_extend: '笔记本电脑（展开）',
  laptop_fold: '笔记本电脑（合拢）',
  monitor: '显示器',
  mouse: '鼠标',
  mousepad: '鼠标垫',
  phone: '手机',
  stainless_bottle: '不锈钢保温杯',
  tissue_box: '纸巾盒',
}

export const PREFAB_ITEMS: Record<string, PrefabItemDef> = Object.fromEntries(
  Object.entries(PREFAB_ITEM_COLLISIONS).map(([id, compound]) => {
    const bounds = boundsOf(compound.parts.flatMap((part) => part.vertices_m))
    const size: Vec3 = [
      bounds.max[0] - bounds.min[0],
      bounds.max[1] - bounds.min[1],
      bounds.max[2] - bounds.min[2],
    ]
    return [id, { id, label: LABELS[id] ?? id, url: `models/items/${id}.glb`, size }]
  }),
)

/** 物品使用的预制模型（model.prefabId 命中注册表时返回；否则 null = 参数化占位几何） */
export function prefabItemOf(object: SceneObject): PrefabItemDef | null {
  const id = object.model.prefabId
  if (!id) return null
  return PREFAB_ITEMS[id] ?? null
}

/**
 * 预制模型 → ModelRef（示例物品共用，避免散落魔法字段）。
 * status = 'ready'（真实模型可用）；shape 保留语义形状用于图标 / 规则分发与加载期回退渲染。
 */
export function prefabModelRef(prefabId: string, shape: PrimitiveShape): ModelRef {
  const def = PREFAB_ITEMS[prefabId]
  if (!def) throw new Error(`未知预制模型：${prefabId}`)
  return {
    status: 'ready',
    source: 'library',
    format: 'glb',
    prefabId,
    assetUrl: def.url,
    shape,
    note: `预制模型：${def.label}`,
  }
}
