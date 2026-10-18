import type { ObjectDimensions, Port, SceneObject, Vec3 } from '@/types/project'

/**
 * 新建物品默认尺寸比例：物品库 / 识别得到的「源默认尺寸」× 0.85。
 *
 * 适用范围（未确认的新建默认值）：
 * - 新建项目时写入的示例物品库（见 `@/data/demoProject` 的 `createNewSampleSceneObjects`）；
 * - 识别清单确认后新建的估计尺寸物品；
 * - 工作台「添加自定义物品」的新建默认值。
 *
 * 不适用：家具 / 房间 / 固定墙插等房间元素；固定摆放物品；用户已确认或实测的尺寸；
 * 生成或导入模型的实测尺寸；排插长度（由孔数规格重算）。旧项目与示例种子迁移不经过本比例。
 */
export const NEW_OBJECT_DEFAULT_SIZE_SCALE = 0.85

/**
 * 不适用「新建默认」尺寸的原因。调用方可用于界面说明，测试用于锁定边界。
 * - `fixed`：固定摆放物品（如排插放在固定家具上）
 * - `measured`：用户已确认 / 实测尺寸（`recognition.dimensionSource === 'user'`）
 * - `imported`：生成或导入模型自带的实测尺寸
 * - `power-strip`：排插长度 = 2 × 留边 + (孔数 − 1) × 孔间距，由规格重算
 */
export type NewDefaultSkipReason = 'fixed' | 'measured' | 'imported' | 'power-strip'

export const NEW_DEFAULT_SKIP_LABELS: Record<NewDefaultSkipReason, string> = {
  fixed: '固定摆放物品，保留原尺寸',
  measured: '用户已确认尺寸，保留原尺寸',
  imported: '生成或导入模型的实测尺寸，保留原尺寸',
  'power-strip': '排插长度由孔数规格重算，保留原尺寸',
}

/** 判定「新建默认比例」适用性所需的字段（结构最小化，便于页面层与测试共用） */
export type NewDefaultCandidate = Pick<SceneObject, 'fixed' | 'powerStrip' | 'model' | 'recognition'>

/** 源默认尺寸 → 新建默认尺寸（米，底面中心锚点不变，因此只缩放三个轴） */
export function scaleNewObjectDefaultDimensions(dimensions: ObjectDimensions): ObjectDimensions {
  return {
    width: dimensions.width * NEW_OBJECT_DEFAULT_SIZE_SCALE,
    height: dimensions.height * NEW_OBJECT_DEFAULT_SIZE_SCALE,
    depth: dimensions.depth * NEW_OBJECT_DEFAULT_SIZE_SCALE,
  }
}

/**
 * 源默认局部接口偏移 → 新建默认偏移：同一比例逐轴缩放，方向与类型不变。
 *
 * 数据契约要求「修改尺寸或接口后按数据契约重新确认」，因此已确认的接口在缩放后取消确认；
 * 没有 offset 的接口按设备背面中心派生，无需缩放，保持原对象引用。
 */
export function scaleNewObjectDefaultPorts(ports: Port[]): Port[] {
  return ports.map((port) => {
    if (!port.offset) return port
    return {
      ...port,
      offset: port.offset.map((value) => value * NEW_OBJECT_DEFAULT_SIZE_SCALE) as Vec3,
      ...(port.confirmed ? { confirmed: false } : {}),
    }
  })
}

/** 该物品为什么不吃「新建默认」比例；`null` = 适用 */
export function newObjectDefaultSkipReason(object: NewDefaultCandidate): NewDefaultSkipReason | null {
  if (object.fixed) return 'fixed'
  if (object.powerStrip || object.model.shape === 'powerStrip') return 'power-strip'
  if (object.recognition?.dimensionSource === 'user') return 'measured'
  if (object.model.source === 'generated') return 'imported'
  return null
}

/** 新建默认比例是否适用于该物品 */
export function shouldApplyNewObjectDefaults(object: NewDefaultCandidate): boolean {
  return newObjectDefaultSkipReason(object) === null
}
