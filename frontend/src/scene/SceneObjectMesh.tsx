import { useEffect, useState } from 'react'
import type { ThreeEvent } from '@react-three/fiber'
import type { Project, SceneObject } from '@/types/project'
import type { SceneIssue } from '@/scene/sceneValidation'
import { useOrganizeStore, type PoseOverride } from '@/state/organizeStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { CATEGORY_COLORS } from './models'
import { ObjectModel } from './ObjectModel'
import { basicMaterial, boxGeometry } from './resources'
import { useObjectDrag } from './useObjectDrag'

/**
 * 场景对象网格：点击 / 拖拽选中与移动、悬停高亮、选中青绿外框、校验问题红框。
 * 拖拽预览只订阅「本物品」的 drag 状态：拖动 A 物品不会触发其它物品网格重渲染。
 * 空间整理预览（compare = after）时按方案 / 动画位姿显示，同样只订阅本物品的覆盖位姿。
 * 按住「摆放前后对比」时按整理前快照位姿（comparePose，由视口按物品传入）覆盖显示。
 */
export function SceneObjectMesh({
  project,
  object,
  selected,
  issues,
  comparePose,
  onSelect,
}: {
  project: Project
  object: SceneObject
  selected: boolean
  issues?: SceneIssue[]
  /** 摆放前后对比：整理前快照位姿（按住期间覆盖显示，不写项目数据） */
  comparePose?: PoseOverride | null
  onSelect: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const drag = useObjectDrag(project, object)
  const { transform: t, dimensions: dims } = object

  const dragPreview = useWorkspaceStore((s) =>
    s.drag && s.drag.objectId === object.id ? s.drag : null,
  )
  const organizePose = useOrganizeStore((s) =>
    s.plan ? s.compare === 'before' ? s.originals[object.id] : s.overrides[object.id] ?? s.originals[object.id] : undefined,
  )
  const activeOperation = useOrganizeStore((s) =>
    s.compare === 'after' && (s.status === 'playing' || s.status === 'paused') &&
    s.commands[s.batchIndex]?.objectId === object.id,
  )
  const dragging = dragPreview !== null
  const dragInvalid = dragPreview !== null && !dragPreview.valid

  // 模型未完成（未生成 / 生成中 / 失败）时，统一使用匹配尺寸的几何占位物
  const modelDone = object.model.status === 'placeholder' || object.model.status === 'ready'
  const hasIssues = !dragging && (issues?.length ?? 0) > 0

  useEffect(() => {
    document.body.style.cursor = dragging ? 'grabbing' : hovered ? 'pointer' : 'auto'
    return () => {
      document.body.style.cursor = 'auto'
    }
  }, [hovered, dragging])

  if (!object.visible) return null

  const pos = dragPreview?.position ?? comparePose?.position ?? organizePose?.position ?? t.position
  const rotationY = dragPreview
    ? t.rotationY
    : (comparePose?.rotationY ?? organizePose?.rotationY ?? t.rotationY)

  return (
    <group position={[pos[0], pos[1] + dims.height / 2, pos[2]]} rotation={[0, rotationY, 0]}>
      <group
        onPointerDown={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          onSelect(object.id)
          drag.onPointerDown(e)
        }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          e.stopPropagation()
          setHovered(true)
        }}
        onPointerOut={() => setHovered(false)}
      >
        <ObjectModel
          object={object}
          shape={modelDone ? object.model.shape : 'genericBox'}
          color={CATEGORY_COLORS[object.category]}
          sockets={object.powerStrip?.socketCount}
        />
      </group>
      {selected || hovered || dragging || activeOperation ? (
        <mesh
          geometry={boxGeometry(dims.width * 1.06, dims.height * 1.08, dims.depth * 1.06)}
          material={basicMaterial('#0F9D8A', {
            wireframe: true,
            opacity: selected || dragging || activeOperation ? 0.85 : 0.4,
          })}
        />
      ) : null}
      {hasIssues || dragInvalid ? (
        <mesh
          geometry={boxGeometry(dims.width * 1.1, dims.height * 1.1, dims.depth * 1.1)}
          material={basicMaterial('#D64545', { wireframe: true, opacity: dragInvalid ? 0.9 : 0.5 })}
        />
      ) : null}
    </group>
  )
}
