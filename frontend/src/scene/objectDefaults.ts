import type {
  ModelRef,
  ObjectCategory,
  ObjectDimensions,
  Port,
  PowerStripConfig,
  PrimitiveShape,
  RecognitionMeta,
  SceneObject,
  Vec3,
} from '@/types/project'
import {
  newObjectDefaultSkipReason,
  scaleNewObjectDefaultDimensions,
  scaleNewObjectDefaultPorts,
} from '@/data/objectDefaults'
import { PREFAB_ITEMS, prefabModelRef } from './prefabItems'

/**
 * 新建物品默认值（场景层）。
 *
 * 本模块只负责「新建」：把物品库 / 识别的源默认尺寸按 0.85 缩放一次，同步局部接口偏移，
 * 并处理必要的支撑关系（例：鼠标落在鼠标垫顶面）。已有物品、旧项目数据、示例种子迁移
 * 一律不经过这里——它们的尺寸是用户或历史数据的一部分。
 *
 * 底部中心锚点约定不变：缩小后物品底面仍停在原支撑面上，因此不需要重算 y。
 */

/** 鼠标预制模型 id（支撑关系用） */
export const MOUSE_PREFAB_ID = 'mouse'

/** 鼠标垫预制模型 id（支撑关系用） */
export const MOUSEPAD_PREFAB_ID = 'mousepad'

/** 判定与夹取时的浮点容差（米） */
const PLACEMENT_EPSILON = 1e-9

export interface NewSceneObjectSpec {
  id: string
  projectId: string
  name: string
  category: ObjectCategory
  /** 源默认尺寸（米，未确认）：创建时按 0.85 缩放一次 */
  dimensions: ObjectDimensions
  /** 底面中心位置（米）；给了 `support` 时只取 x / z，y 由支撑面顶面决定 */
  position: Vec3
  rotationY?: number
  /** 语义形状（图标 / 整理规则 / 占位几何） */
  shape: PrimitiveShape
  /** 命中预制注册表时用真实 GLB + 随包碰撞；未命中回退占位几何 */
  prefabId?: string
  /** 源默认局部接口（米）：随尺寸同比缩放 */
  ports?: Port[]
  quantity?: number
  needsPower?: boolean
  fixed?: boolean
  frequent?: boolean
  visible?: boolean
  locked?: boolean
  /** 默认 `manual`（页面手工新建）；识别清单新建传 `recognized` */
  source?: SceneObject['source']
  recognition?: RecognitionMeta
  powerStrip?: PowerStripConfig
  note?: string
  /** 支撑面（如鼠标垫）：物品底面落在其顶面，并夹取到其投影内 */
  support?: SceneObject
}

/**
 * 新建场景物品工厂：唯一会施加 0.85 默认尺寸的入口。
 *
 * 不适用的物品（固定摆放 / 已确认尺寸 / 生成模型实测尺寸 / 排插规格长度）保持源尺寸不变，
 * 判定见 `newObjectDefaultSkipReason`。
 */
export function createNewSceneObject(spec: NewSceneObjectSpec): SceneObject {
  const base: SceneObject = {
    id: spec.id,
    projectId: spec.projectId,
    name: spec.name,
    category: spec.category,
    dimensions: { ...spec.dimensions },
    transform: { position: [...spec.position] as Vec3, rotationY: spec.rotationY ?? 0 },
    model: modelRefFor(spec.prefabId, spec.shape),
    ports: (spec.ports ?? []).map((port) => ({ ...port })),
    quantity: spec.quantity ?? 1,
    needsPower: spec.needsPower ?? false,
    visible: spec.visible ?? true,
    fixed: spec.fixed ?? false,
    locked: spec.locked ?? false,
    frequent: spec.frequent ?? false,
    source: spec.source ?? 'manual',
    ...(spec.powerStrip ? { powerStrip: spec.powerStrip } : {}),
    ...(spec.recognition ? { recognition: spec.recognition } : {}),
    ...(spec.note ? { note: spec.note } : {}),
  }
  const sized = applyNewObjectDefaults(base)
  return spec.support ? placeOnSupport(sized, spec.support) : sized
}

/** 已施加过新建默认比例的实例 → 结果，用于防止重复缩小（同一源总是得到同一结果） */
const defaultedResults = new WeakMap<SceneObject, SceneObject>()

/**
 * 对刚构造出来、尚未确认的物品施加一次 0.85 默认尺寸：尺寸与局部接口同步缩放。
 *
 * - 只用于新建路径（页面把内联字面量交给它）。**不要**对已持久化 / 已存在的物品调用：
 *   那样会把用户数据再次缩小。工厂 `createNewSceneObject` 与示例函数已内置该步骤。
 * - 纯函数语义：源对象不被修改；同一源对象重复调用返回同一个结果实例，不会二次缩小。
 */
export function applyNewObjectDefaults(object: SceneObject): SceneObject {
  const done = defaultedResults.get(object)
  if (done) return done
  if (newObjectDefaultSkipReason(object) !== null) return object
  const next: SceneObject = {
    ...object,
    dimensions: scaleNewObjectDefaultDimensions(object.dimensions),
    ports: scaleNewObjectDefaultPorts(object.ports),
  }
  // 同时记住源对象与结果：同一字面量重复施加（重复渲染 / 重复事件）不会二次缩小。
  defaultedResults.set(object, next)
  defaultedResults.set(next, next)
  return next
}

/** 支撑面顶面高度（米）：底面中心锚点 + 声明高度（垫子类支撑面即其厚度） */
export function supportTopY(support: SceneObject): number {
  return support.transform.position[1] + support.dimensions.height
}

/**
 * 把物品底面放到支撑面顶面，并把水平位置夹取到支撑面投影内（放不下时居中）。
 * 只有 y 与 x / z 变化，旋转与尺寸不变。
 */
export function placeOnSupport(
  object: SceneObject,
  support: SceneObject,
  xz?: readonly [number, number],
): SceneObject {
  const rect = footprintRect(support)
  const [halfWidth, halfDepth] = halfExtents(object)
  const [x, z] = xz ?? [object.transform.position[0], object.transform.position[2]]
  return {
    ...object,
    transform: {
      ...object.transform,
      position: [
        clampInto(x, halfWidth, rect.x0, rect.x1),
        supportTopY(support),
        clampInto(z, halfDepth, rect.z0, rect.z1),
      ] as Vec3,
    },
  }
}

/**
 * 同步预制物品的支撑关系：鼠标落在最近的可见鼠标垫顶面。
 * 没有鼠标垫时原样返回（不凭空创建支撑面）。
 */
export function syncSupportPose(objects: SceneObject[]): SceneObject[] {
  const pads = objects.filter((o) => o.visible && o.model.prefabId === MOUSEPAD_PREFAB_ID)
  if (pads.length === 0) return objects
  return objects.map((object) => {
    if (object.model.prefabId !== MOUSE_PREFAB_ID) return object
    const pad = nearestPad(object, pads)
    return pad ? placeOnSupport(object, pad) : object
  })
}

function modelRefFor(prefabId: string | undefined, shape: PrimitiveShape): ModelRef {
  if (prefabId && PREFAB_ITEMS[prefabId]) return prefabModelRef(prefabId, shape)
  return { status: 'none', source: 'demo', format: 'placeholder-box', shape }
}

function halfExtents(object: SceneObject): [number, number] {
  const cos = Math.abs(Math.cos(object.transform.rotationY))
  const sin = Math.abs(Math.sin(object.transform.rotationY))
  const { width, depth } = object.dimensions
  return [(cos * width + sin * depth) / 2, (sin * width + cos * depth) / 2]
}

function footprintRect(object: SceneObject): { x0: number; x1: number; z0: number; z1: number } {
  const [halfWidth, halfDepth] = halfExtents(object)
  const [x, , z] = object.transform.position
  return { x0: x - halfWidth, x1: x + halfWidth, z0: z - halfDepth, z1: z + halfDepth }
}

function clampInto(value: number, half: number, min: number, max: number): number {
  const low = min + half
  const high = max - half
  if (low > high - PLACEMENT_EPSILON) return (min + max) / 2
  return Math.min(Math.max(value, low), high)
}

function nearestPad(mouse: SceneObject, pads: SceneObject[]): SceneObject | undefined {
  const [x, , z] = mouse.transform.position
  return pads
    .map((pad) => ({
      pad,
      distance: Math.hypot(pad.transform.position[0] - x, pad.transform.position[2] - z),
    }))
    .sort((a, b) => a.distance - b.distance)[0]?.pad
}
