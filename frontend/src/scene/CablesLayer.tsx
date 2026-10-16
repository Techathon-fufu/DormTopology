import { useEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { Html } from '@react-three/drei'
import type { CableConnection, Project, Vec3 } from '@/types/project'
import { CABLE_KIND_META } from '@/types/project'
import { resolveOrganizationPreferences } from '@/types/organization'
import { cableDisplayPoints, endpointLabel } from '@/scene/cables'
import { checkCableRoute, sampleCurve } from '@/scene/cableRoute'
import { computeCableAvoidZones, computeRouteNodes } from '@/scene/routeNodes'
import { useCableStore, cableAnimEase } from '@/state/cableStore'
import { useWorkspaceStore } from '@/state/workspaceStore'
import { basicMaterial, sphereGeometry } from './resources'

/**
 * 线缆层（走线模式）：
 * - 折线控制点 → Catmull-Rom 平滑采样 → TubeGeometry 渲染（平滑仅用于显示）；
 * - 端点由接口世界坐标实时推导（设备移动 / 旋转后自动同步）；
 * - 「原始走线 / 建议走线」对比、路径节点拖拽编辑、障碍标记与收拢动画。
 */

const SMOOTH_DIVISIONS = 64

function snap10(v: number): number {
  return Math.round(v * 100) / 100
}

function resampleForAnim(points: Vec3[]): Vec3[] {
  const samples = sampleCurve(points, 48)
  return samples
}

function lerpSamples(a: Vec3[], b: Vec3[], t: number): Vec3[] {
  const n = Math.min(a.length, b.length)
  const out: Vec3[] = []
  for (let i = 0; i < n; i += 1) {
    out.push([
      a[i][0] + (b[i][0] - a[i][0]) * t,
      a[i][1] + (b[i][1] - a[i][1]) * t,
      a[i][2] + (b[i][2] - a[i][2]) * t,
    ])
  }
  return out
}

function useTubeGeometry(samples: Vec3[], radius: number) {
  const geometry = useMemo(() => {
    if (samples.length < 2) return null
    const curve = new THREE.CatmullRomCurve3(
      samples.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    )
    const tubular = Math.min(220, Math.max(24, samples.length * 2))
    return new THREE.TubeGeometry(curve, tubular, radius, 6, false)
  }, [samples, radius])
  useEffect(() => {
    return () => {
      geometry?.dispose()
    }
  }, [geometry])
  return geometry
}

function CableMesh({ cable, project }: { cable: CableConnection; project: Project }) {
  const selected = useCableStore((s) => s.selectedCableId === cable.id)
  const hovered = useCableStore((s) => s.hoveredCableId === cable.id)
  const view = useCableStore((s) => s.routeView)
  const animStatus = useCableStore((s) => s.animStatus)
  const animT = useCableStore((s) => s.animT)
  const animFrom = useCableStore((s) => s.animFrom[cable.id])
  const drag = useCableStore((s) =>
    s.nodeDrag && s.nodeDrag.cableId === cable.id ? s.nodeDrag : null,
  )
  const selectCable = useCableStore((s) => s.selectCable)
  const setHoveredCable = useCableStore((s) => s.setHoveredCable)
  const workspaceSelect = useWorkspaceStore((s) => s.select)

  const showOriginal = view === 'original' && Boolean(cable.originalRoute)

  const displayPoints = useMemo(() => {
    let pts = cableDisplayPoints(cable, project.objects, showOriginal ? 'original' : 'suggested')
    if (drag && !showOriginal) {
      pts = pts.map((p, i) => (i === drag.index ? drag.position : p))
    }
    return pts
  }, [cable, project.objects, showOriginal, drag])

  const samples = useMemo(() => {
    const target = sampleCurve(displayPoints, SMOOTH_DIVISIONS)
    if ((animStatus === 'playing' || animStatus === 'paused') && animFrom) {
      const from = animFrom
      const to = resampleForAnim(displayPoints)
      return lerpSamples(from, to, cableAnimEase(animT))
    }
    return target
  }, [displayPoints, animStatus, animFrom, animT])

  const stale = cable.status === 'stale'
  const conflicted = cable.status === 'conflict'
  const color = CABLE_KIND_META[cable.kind].color
  const opacity = showOriginal ? 0.5 : stale ? 0.45 : selected ? 1 : hovered ? 1 : 0.92
  const radius = selected ? 0.008 : 0.0055

  const geometry = useTubeGeometry(samples, radius)

  if (!geometry) return null

  return (
    <group>
      <mesh
        geometry={geometry}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHoveredCable(cable.id)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHoveredCable(null)
          document.body.style.cursor = ''
        }}
        onClick={(e) => {
          e.stopPropagation()
          selectCable(cable.id)
          workspaceSelect(null)
        }}
      >
        <meshStandardMaterial
          color={color}
          transparent
          opacity={opacity}
          roughness={0.45}
          metalness={0.05}
          emissive={selected || hovered ? color : '#000000'}
          emissiveIntensity={selected ? 0.45 : hovered ? 0.25 : 0}
          depthWrite={opacity >= 1}
        />
      </mesh>

      {hovered ? (
        <CableHoverLabel cable={cable} project={project} samples={samples} />
      ) : null}

      {conflicted || (selected && !showOriginal) ? (
        <CableIssueMarkers cable={cable} project={project} />
      ) : null}

      {selected && !showOriginal && animStatus !== 'playing' && animStatus !== 'paused' ? (
        <CableNodeHandles cable={cable} project={project} displayPoints={displayPoints} />
      ) : null}
    </group>
  )
}

function CableHoverLabel({
  cable,
  project,
  samples,
}: {
  cable: CableConnection
  project: Project
  samples: Vec3[]
}) {
  const mid = samples[Math.floor(samples.length / 2)]
  const from = endpointLabel(project.objects, cable.from)
  const to = endpointLabel(project.objects, cable.to)
  return (
    <Html position={[mid[0], mid[1] + 0.05, mid[2]]} center distanceFactor={7} zIndexRange={[20, 0]}>
      <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface/95 px-2 py-1 text-[11px] leading-tight shadow-sm">
        <span className="font-medium" style={{ color: CABLE_KIND_META[cable.kind].color }}>
          {CABLE_KIND_META[cable.kind].label}
        </span>
        <span className="text-muted-foreground">
          {' '}
          {from.objectName} → {to.objectName}
        </span>
      </div>
    </Html>
  )
}

/** 平滑路径障碍标记（红点 = 本地几何检查发现的问题位置） */
function CableIssueMarkers({ cable, project }: { cable: CableConnection; project: Project }) {
  const avoidZones = useMemo(
    () => computeCableAvoidZones(project.room, resolveOrganizationPreferences(project)),
    [project],
  )
  const issues = useMemo(() => {
    const result = checkCableRoute({
      points: cableDisplayPoints(cable, project.objects, 'suggested'),
      from: cable.from,
      to: cable.to,
      objects: project.objects,
      room: project.room,
      avoidZones,
    })
    return result.issues
  }, [cable, project.objects, project.room, avoidZones])

  if (issues.length === 0) return null
  return (
    <group>
      {issues.slice(0, 12).map((issue, i) => (
        <mesh key={i} position={[issue.position[0], issue.position[1] + 0.01, issue.position[2]]}>
          <primitive object={sphereGeometry(0.012, 10, 10)} attach="geometry" />
          <primitive
            object={basicMaterial('#E5484D', { opacity: 0.9 })}
            attach="material"
          />
        </mesh>
      ))}
    </group>
  )
}

/** 路径节点手柄：可拖拽（水平面内，10mm 吸附；靠近路由节点时自动贴合） */
function CableNodeHandles({
  cable,
  project,
  displayPoints,
}: {
  cable: CableConnection
  project: Project
  displayPoints: Vec3[]
}) {
  const drag = useCableStore((s) => s.nodeDrag)
  const selectNode = useCableStore((s) => s.selectNode)
  const selectedNodeIndex = useCableStore((s) => s.selectedNodeIndex)
  const routeNodes = useMemo(() => computeRouteNodes(project.room), [project.room])
  const plane = useRef(new THREE.Plane())
  const pointOut = useRef(new THREE.Vector3())
  const updateCable = useWorkspaceStore((s) => s.updateCable)

  // 内部节点（首末点绑定在接口上，不可拖拽）
  const handles = displayPoints.slice(1, -1)

  const startDrag = (e: { stopPropagation: () => void; target: EventTarget | null }, index: number) => {
    e.stopPropagation()
    const target = e.target as { setPointerCapture?: (id: number) => void } | null
    target?.setPointerCapture?.((e as unknown as { pointerId: number }).pointerId)
    const pos = displayPoints[index + 1]
    plane.current.set(new THREE.Vector3(0, 1, 0), -pos[1])
    useCableStore.getState().setNodeDrag({
      cableId: cable.id,
      index: index + 1,
      position: [...pos] as Vec3,
      snappedNodeId: null,
    })
    selectNode(index + 1)
  }

  const moveDrag = (e: {
    ray: THREE.Ray
    stopPropagation: () => void
  }, index: number) => {
    const state = useCableStore.getState()
    const current = state.nodeDrag
    if (!current || current.cableId !== cable.id || current.index !== index + 1) return
    e.stopPropagation()
    const hit = (e.ray as THREE.Ray).intersectPlane(plane.current, pointOut.current)
    if (!hit) return
    let x = snap10(hit.x)
    let y = displayPoints[index + 1][1]
    let z = snap10(hit.z)
    let snappedNodeId: string | null = null
    const snapNode = routeNodes.find(
      (n) =>
        Math.hypot(n.position[0] - x, n.position[2] - z) < 0.05 &&
        Math.abs(n.position[1] - y) < 0.12,
    )
    if (snapNode) {
      x = snapNode.position[0]
      y = snapNode.position[1]
      z = snapNode.position[2]
      snappedNodeId = snapNode.id
    }
    state.setNodeDrag({ cableId: cable.id, index: index + 1, position: [x, y, z], snappedNodeId })
  }

  const endDrag = (e: { stopPropagation: () => void }) => {
    e.stopPropagation()
    const state = useCableStore.getState()
    const current = state.nodeDrag
    if (!current || current.cableId !== cable.id) return
    updateCable(
      project.id,
      cable.id,
      (c) => {
        const points = c.route.points.map((p, i) => (i === current.index ? current.position : p))
        const nodeIds = c.route.nodeIds
          ? c.route.nodeIds.map((id, i) => (i === current.index ? current.snappedNodeId : id))
          : undefined
        return {
          ...c,
          route: { ...c.route, points, nodeIds },
          status: 'adjusted',
          note: '已手动调整路径节点：平滑路径会重新做本地障碍检查（非真实算法验证）',
          updatedAt: Date.now(),
        }
      },
      true,
    )
    state.setNodeDrag(null)
  }

  return (
    <group>
      {handles.map((_, i) => {
        const index = i + 1
        const pos = drag && drag.index === index ? drag.position : displayPoints[index]
        const active = drag?.index === index
        const focused = selectedNodeIndex === index
        return (
          <mesh
            key={index}
            geometry={sphereGeometry(active || focused ? 0.016 : 0.012, 12, 12)}
            material={basicMaterial(
              active ? '#0F9D8A' : focused ? '#F59E0B' : '#FFFFFF',
              { opacity: 0.95 },
            )}
            position={[pos[0], pos[1] + 0.006, pos[2]]}
            onPointerDown={(e) => startDrag(e, i)}
            onPointerMove={(e) => moveDrag(e, i)}
            onPointerUp={(e) => endDrag(e)}
            onPointerOver={(e) => {
              e.stopPropagation()
              document.body.style.cursor = 'move'
            }}
            onPointerOut={() => {
              document.body.style.cursor = ''
            }}
          />
        )
      })}
      {drag ? (
        <Html
          position={[drag.position[0], drag.position[1] + 0.06, drag.position[2]]}
          center
          distanceFactor={8}
          zIndexRange={[20, 0]}
        >
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface/95 px-2 py-0.5 text-[11px] shadow-sm">
            {drag.snappedNodeId ? `已贴合路径节点：${drag.snappedNodeId}` : '松开保存（可撤销）'}
          </div>
        </Html>
      ) : null}
    </group>
  )
}

export function CablesLayer({ project }: { project: Project }) {
  return (
    <group>
      {project.cables.map((cable) => (
        <CableMesh key={cable.id} cable={cable} project={project} />
      ))}
    </group>
  )
}
