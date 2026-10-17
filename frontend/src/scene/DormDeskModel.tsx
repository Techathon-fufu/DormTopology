import { useEffect, useRef, useState } from 'react'
import type { Group } from 'three'
import type { RoomConfig, Vec3 } from '@/types/project'
import { DORM_DESK_MODEL_CONFIG, mountDeskModel } from '@/scene/deskModel'
import { disposeObject3D, loadModelFromUrl } from '@/scene/modelLoader'
import { ParametricDesk } from '@/scene/ParametricDesk'
import { useDeskModelStore } from '@/state/deskModelStore'

/**
 * 桌体渲染：优先加载 dormdesk_body.glb（GLTFLoader + 归一化），
 * 加载完成前 / 加载失败 / 用户选择简化几何时回退参数化桌体（ParametricDesk，与逻辑尺寸一致）。
 *
 * GLB 相关逻辑集中在 scene / state 层，不散落到工作台页面：
 * - 配置与归一化：scene/deskModel.ts（单位换算 / 居中 / 垂直对齐 / 轴校正 / 锚点实测）
 * - 加载与释放：scene/modelLoader.ts（与 importModel 共用）
 * - 状态与用户偏好：state/deskModelStore.ts（加载中 / 失败 / 重试 / 显示隐藏，偏好持久化）
 */
export function DormDeskModel({
  room,
  position = [0, 0, 0],
  rotationY = 0,
  visible = true,
}: {
  room: RoomConfig
  /** 额外位置偏移（米；叠加在归一化结果之上） */
  position?: Vec3
  /** 额外绕 Y 轴旋转（弧度；叠加在归一化校正之上） */
  rotationY?: number
  /** 组件级显示开关（与工具栏「显示桌体」开关取与） */
  visible?: boolean
}) {
  const forceFallback = useDeskModelStore((s) => s.forceFallback)
  const retryNonce = useDeskModelStore((s) => s.retryNonce)
  const status = useDeskModelStore((s) => s.status)
  const showDesk = useDeskModelStore((s) => s.showDesk)
  const [model, setModel] = useState<Group | null>(null)
  const modelRef = useRef<Group | null>(null)

  // 桌面尺寸配置变化时重新归一化；仅依赖影响归一化的标量，避免项目对象引用变化触发重载
  const roomShapeKey = [
    room.desk.width,
    room.desk.depth,
    room.desk.height,
    room.desk.thickness,
    room.shelf.enabled ? room.shelf.heightAboveDesk : 'off',
    room.shelf.depth,
  ].join('|')

  useEffect(() => {
    const clearModel = () => {
      if (modelRef.current) {
        disposeObject3D(modelRef.current)
        modelRef.current = null
        setModel(null)
      }
    }

    if (forceFallback) {
      clearModel()
      useDeskModelStore.getState().markSkipped()
      return
    }

    clearModel() // 重新加载前释放旧模型
    let cancelled = false
    const deskStore = useDeskModelStore.getState()
    deskStore.beginLoad()
    loadModelFromUrl(deskStore.modelUrl)
      .then(({ scene }) => {
        if (cancelled) {
          disposeObject3D(scene)
          return
        }
        const mounted = mountDeskModel(scene, DORM_DESK_MODEL_CONFIG, room)
        modelRef.current = scene
        setModel(scene)
        useDeskModelStore.getState().loadSucceeded(mounted.metrics)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        useDeskModelStore
          .getState()
          .loadFailed(error instanceof Error ? error.message : String(error))
      })

    return () => {
      cancelled = true
    }
    // roomShapeKey 覆盖归一化依赖的桌面 / 书架尺寸；room 其余字段（如位置微调）不触发重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceFallback, retryNonce, roomShapeKey])

  // 卸载时释放当前模型
  useEffect(
    () => () => {
      if (modelRef.current) {
        disposeObject3D(modelRef.current)
        modelRef.current = null
      }
    },
    [],
  )

  const useGlb = !forceFallback && status === 'loaded' && model !== null
  return (
    <group position={position} rotation={[0, rotationY, 0]} visible={showDesk && visible}>
      {useGlb && model ? <primitive object={model} /> : <ParametricDesk room={room} />}
    </group>
  )
}
