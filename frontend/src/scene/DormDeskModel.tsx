import { useEffect, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import type { RoomConfig, Vec3 } from '@/types/project'
import {
  applyBedCutaway,
  DORM_DESK_MODEL_CONFIG,
  mountDeskModel,
  resolvePublicAssetUrl,
} from '@/scene/deskModel'
import {
  advanceDrawerProgress,
  DORM_DESK_DRAWERS,
  drawerSlideX,
  type DormDeskDrawerSpec,
} from '@/scene/dormDeskDrawers'
import { useDrawerInteraction } from '@/scene/useDrawerInteraction'
import { disposeObject3D, loadModelFromUrl } from '@/scene/modelLoader'
import { ParametricDesk } from '@/scene/ParametricDesk'
import { useDeskModelStore } from '@/state/deskModelStore'
import { useDrawerStore } from '@/state/drawerStore'
import { hasFixedFurniture } from './fixedFurniture'

/**
 * 桌体渲染：加载 models/dormdesk_parts/dormdesk_body.glb（无抽屉桌体）与三只抽屉分离件
 * （同目录 drawer_{bottom,middle,top}.glb，清单见 scene/dormDeskDrawers.ts），
 * 加载完成前 / 加载失败 / 用户选择简化几何时回退参数化桌体（ParametricDesk，与逻辑尺寸一致）。
 *
 * 固定家具（hasFixedFurniture）走 fixedFurniture 提供的支撑 / 碰撞与共同父节点偏移
 * （FURNITURE_OFFSET 由 mountDeskModel 施加），完整显示模型定义的桌板，不程序开孔。
 * 非固定家具沿用历史归一化路径。
 *
 * 抽屉推拉：每只抽屉包一层滑动组，逐帧由 drawerStore 的 progress 驱动
 * （单击开 / 关、拖拽跟手、松手吸附；交互见 scene/useDrawerInteraction.ts）。
 *
 * GLB 相关逻辑集中在 scene / state 层，不散落到工作台页面：
 * - 配置与归一化：scene/deskModel.ts（单位换算 / 居中 / 垂直对齐 / 轴校正 / 锚点实测）
 * - 抽屉清单与运动学：scene/dormDeskDrawers.ts（纯函数，可脚本直跑）
 * - 加载与释放：scene/modelLoader.ts（与 importModel 共用）
 * - 状态与用户偏好：state/deskModelStore.ts（加载中 / 失败 / 重试 / 显示隐藏）
 */

interface MountedDeskParts {
  body: Group
  drawers: Array<{ spec: DormDeskDrawerSpec; scene: Group }>
}

export function DormDeskModel({
  room,
  position = [0, 0, 0],
  rotationY = 0,
  visible = true,
  respectToolbar = true,
  hideBedParts = false,
}: {
  room: RoomConfig
  /** 额外位置偏移（米；叠加在归一化结果之上） */
  position?: Vec3
  /** 额外绕 Y 轴旋转（弧度；叠加在归一化校正之上） */
  rotationY?: number
  /** 组件级显示开关（与工具栏「显示桌体」开关取与） */
  visible?: boolean
  /** 是否叠加工具栏「显示桌体」总开关：工作台 / 对比页 true；空间配置预览 false 始终显示家具 */
  respectToolbar?: boolean
  /** 显示-only 剖切：俯视时隐藏床体 / 护栏 / 爬梯（整组家具模型；碰撞与校验几何不变） */
  hideBedParts?: boolean
}) {
  const forceFallback = useDeskModelStore((s) => s.forceFallback)
  const retryNonce = useDeskModelStore((s) => s.retryNonce)
  const status = useDeskModelStore((s) => s.status)
  const showDesk = useDeskModelStore((s) => s.showDesk)
  const [parts, setParts] = useState<MountedDeskParts | null>(null)
  const partsRef = useRef<MountedDeskParts | null>(null)

  // 桌面尺寸配置变化时重新归一化；仅依赖影响归一化的标量，避免项目对象引用变化触发重载
  const roomShapeKey = [
    room.furnitureModel,
    room.desk.width,
    room.desk.depth,
    room.desk.height,
    room.desk.thickness,
    room.shelf.enabled ? room.shelf.heightAboveDesk : 'off',
    room.shelf.depth,
  ].join('|')

  useEffect(() => {
    const clearParts = () => {
      const mounted = partsRef.current
      if (mounted) {
        disposeObject3D(mounted.body)
        mounted.drawers.forEach(({ scene }) => disposeObject3D(scene))
        partsRef.current = null
      }
      setParts(null)
      useDrawerStore.getState().reset()
    }

    if (forceFallback || !hasFixedFurniture(room)) {
      clearParts()
      useDeskModelStore.getState().markSkipped()
      return
    }

    clearParts() // 重新加载前释放旧部件
    let cancelled = false
    const deskStore = useDeskModelStore.getState()
    deskStore.beginLoad()

    const loads = [
      loadModelFromUrl(resolvePublicAssetUrl(DORM_DESK_MODEL_CONFIG.url)),
      ...DORM_DESK_DRAWERS.map((spec) => loadModelFromUrl(resolvePublicAssetUrl(spec.url))),
    ]
    Promise.allSettled(loads).then((results) => {
      const rejected = results.find((r) => r.status === 'rejected')
      if (rejected?.status === 'rejected') {
        // 任一部件失败：释放已加载部件并走统一失败回退（与单文件模型一致的失败口径）
        for (const result of results) {
          if (result.status === 'fulfilled') disposeObject3D(result.value.scene)
        }
        if (cancelled) return
        const reason: unknown = rejected.reason
        useDeskModelStore
          .getState()
          .loadFailed(reason instanceof Error ? reason.message : String(reason))
        return
      }
      if (cancelled) {
        for (const result of results) {
          if (result.status === 'fulfilled') disposeObject3D(result.value.scene)
        }
        return
      }

      const [bodyResult, ...drawerResults] = results
      if (bodyResult.status !== 'fulfilled') return
      const bodyData = bodyResult.value
      const body = bodyData.scene
      const mounted = mountDeskModel(body, DORM_DESK_MODEL_CONFIG, room)
      const drawers = drawerResults.map((result, index) => {
        const scene = (result as PromiseFulfilledResult<{ scene: Group }>).value.scene
        // 分离件与桌体同一建模坐标系（清单标注未施加平移）：套用桌体归一化的同一变换
        scene.applyMatrix4(body.matrix)
        return { spec: DORM_DESK_DRAWERS[index], scene }
      })
      partsRef.current = { body, drawers }
      setParts({ body, drawers })
      useDeskModelStore.getState().loadSucceeded(mounted.metrics)
      useDrawerStore.getState().setLoaded(DORM_DESK_DRAWERS.map((spec) => spec.id))
    })

    return () => {
      cancelled = true
    }
    // roomShapeKey 覆盖归一化依赖的桌面 / 书架尺寸；room 其余字段（如位置微调）不触发重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceFallback, retryNonce, roomShapeKey])

  // 显示-only 剖切（俯视）：隐藏床体 / 护栏 / 爬梯，便于查看桌面与地面布局
  useEffect(() => {
    if (!parts) return
    applyBedCutaway(parts.body, hideBedParts)
  }, [parts, hideBedParts])

  // 卸载时释放当前部件
  useEffect(
    () => () => {
      const mounted = partsRef.current
      if (mounted) {
        disposeObject3D(mounted.body)
        mounted.drawers.forEach(({ scene }) => disposeObject3D(scene))
        partsRef.current = null
      }
      useDrawerStore.getState().reset()
    },
    [],
  )

  useFrame((_, delta) => {
    for (const spec of DORM_DESK_DRAWERS) {
      const store = useDrawerStore.getState(), state = store.drawers[spec.id]
      if (store.draggingId !== spec.id) {
        const next = advanceDrawerProgress(state.progress, state.target, delta)
        if (next !== state.progress) store.setProgress(spec.id, next)
      }
    }
  })

  const useGlb = hasFixedFurniture(room) && !forceFallback && status === 'loaded' && parts !== null
  return (
    <group position={position} rotation={[0, rotationY, 0]} visible={(respectToolbar ? showDesk : true) && visible}>
      {useGlb && parts ? (
        <>
          <primitive object={parts.body} />
          {parts.drawers.map(({ spec, scene }) => (
            <DeskDrawerPart key={spec.id} spec={spec} scene={scene} />
          ))}
        </>
      ) : (
        <ParametricDesk room={room} hideBedParts={hideBedParts} />
      )}
    </group>
  )
}

/** 单只抽屉：滑动组 + 交互 + 逐帧缓动（progress → target） */
function DeskDrawerPart({ spec, scene }: { spec: DormDeskDrawerSpec; scene: Group }) {
  const pivotRef = useRef<Group>(null)
  const handlers = useDrawerInteraction(spec, scene)

  useFrame(() => {
    const pivot = pivotRef.current
    if (pivot) {
      const current = useDrawerStore.getState().drawers[spec.id]
      pivot.position.x = drawerSlideX(spec.travelM, current.progress)
    }
  })

  return (
    <group ref={pivotRef}>
      <primitive object={scene} {...handlers} />
    </group>
  )
}
