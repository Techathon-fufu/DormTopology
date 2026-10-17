import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import type { CableConnection, SceneObject } from '@/types/project'
import { CABLE_KIND_META, CABLE_THICKNESS_META } from '@/types/project'
import type { ZoneKind } from '@/types/organization'
import { ZONE_COLORS } from '@/types/organization'
import { cableDisplayPoints, resolveCableThickness } from '@/scene/cables'
import { sampleCurve } from '@/scene/cableRoute'
import { CATEGORY_COLORS } from '@/scene/models'
import { ObjectModel } from '@/scene/ObjectModel'
import { basicMaterial, boxGeometry } from './resources'

/**
 * 方案对比页的只读三维图层：
 * - 物品按快照渲染（可按分区着色；与其它方案不同的物品用琥珀色线框高亮）；
 * - 线缆按快照路径平滑渲染（不同线缆用琥珀色加粗高亮）；
 * 不接入拖拽 / 选中 / 编辑交互，保证查看对比不修改任何方案数据。
 */

/** 差异高亮色（与图例一致） */
export const DIFF_COLOR = '#D97706'

export function CompareObjectMesh({
  object,
  zone,
  zoneTint,
  diff,
}: {
  object: SceneObject
  /** 该物品的分区（估算口径，见 planMetrics.resolveObjectZone） */
  zone?: ZoneKind
  /** 按分区着色（关闭时按物品类别着色） */
  zoneTint: boolean
  /** 与其它选中方案存在差异（位姿不同 / 仅部分方案存在） */
  diff: boolean
}) {
  if (!object.visible) return null
  const { transform: t, dimensions: dims } = object
  const color = zoneTint && zone ? ZONE_COLORS[zone] : CATEGORY_COLORS[object.category]
  return (
    <group position={[t.position[0], t.position[1] + dims.height / 2, t.position[2]]} rotation={[0, t.rotationY, 0]}>
      <ObjectModel
        object={object}
        shape={object.model.shape}
        color={color}
        sockets={object.powerStrip?.socketCount}
      />
      {diff ? (
        <mesh
          geometry={boxGeometry(dims.width * 1.12, dims.height * 1.12, dims.depth * 1.12)}
          material={basicMaterial(DIFF_COLOR, { wireframe: true, opacity: 0.85 })}
        />
      ) : null}
    </group>
  )
}

function useTubeGeometry(samples: [number, number, number][], radius: number) {
  const geometry = useMemo(() => {
    if (samples.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(samples.map((p) => new THREE.Vector3(p[0], p[1], p[2])))
    const tubular = Math.min(200, Math.max(24, samples.length * 2))
    return new THREE.TubeGeometry(curve, tubular, radius, 6, false)
  }, [samples, radius])
  useEffect(() => () => geometry?.dispose(), [geometry])
  return geometry
}

function CompareCableMesh({
  cable,
  objects,
  diff,
}: {
  cable: CableConnection
  objects: SceneObject[]
  diff: boolean
}) {
  const samples = useMemo(() => {
    const points = cableDisplayPoints(cable, objects, 'suggested')
    return points.length >= 2 ? sampleCurve(points, 64) : []
  }, [cable, objects])

  const thickness = CABLE_THICKNESS_META[resolveCableThickness(cable)]
  const radius = thickness.renderRadiusM * (diff ? 1.5 : 1)
  const geometry = useTubeGeometry(samples, radius)
  if (!geometry) return null

  const color = diff ? DIFF_COLOR : CABLE_KIND_META[cable.kind].color
  const stale = cable.status === 'stale'
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial
        color={color}
        transparent
        opacity={stale ? 0.5 : 0.95}
        roughness={0.45}
        metalness={0.05}
        emissive={diff ? DIFF_COLOR : '#000000'}
        emissiveIntensity={diff ? 0.4 : 0}
        depthWrite={!stale}
      />
    </mesh>
  )
}

/** 快照线缆层（只读）：diffIds 中的线缆以琥珀色加粗高亮 */
export function CompareCables({
  cables,
  objects,
  diffIds,
}: {
  cables: CableConnection[]
  objects: SceneObject[]
  diffIds: Set<string>
}) {
  return (
    <>
      {cables.map((cable) => (
        <CompareCableMesh
          key={cable.id}
          cable={cable}
          objects={objects}
          diff={diffIds.has(cable.id)}
        />
      ))}
    </>
  )
}
