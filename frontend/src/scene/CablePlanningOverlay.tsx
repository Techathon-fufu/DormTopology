import { useMemo, useState } from 'react'
import { Html, Line } from '@react-three/drei'
import type { Project } from '@/types/project'
import { resolveOrganizationPreferences } from '@/types/organization'
import { ROUTE_NODE_META, type CableAvoidZone, type RouteNode } from '@/types/cable'
import { computeCableAvoidZones, computeRouteNodes } from '@/scene/routeNodes'
import { useCableStore } from '@/state/cableStore'
import { basicMaterial, planeGeometry, sphereGeometry } from './resources'

/**
 * 走线模式叠加层：
 * - 场景路由节点标记（桌边 / 桌底 / 桌腿与床架立柱 / 出线孔 / 插座 / 地面）；
 * - 避让区投影（打字活动区 / 水杯活动区 / 桌下腿部活动区）。
 * 演示路径规划优先经过这些节点；这三类避让区同样参与平滑路径的障碍检查。
 */

export function CablePlanningOverlay({ project }: { project: Project }) {
  const showNodes = useCableStore((s) => s.showRouteNodes)
  const showZones = useCableStore((s) => s.showAvoidZones)
  const selectedCableId = useCableStore((s) => s.selectedCableId)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const nodes = useMemo(() => computeRouteNodes(project.room), [project.room])
  const zones = useMemo(
    () => computeCableAvoidZones(project.room, resolveOrganizationPreferences(project)),
    [project],
  )
  const highlightedNodeIds = useMemo(() => {
    const cable = project.cables.find((c) => c.id === selectedCableId)
    return new Set((cable?.route.nodeIds ?? []).filter((id): id is string => Boolean(id)))
  }, [project.cables, selectedCableId])

  return (
    <group>
      {showZones
        ? zones.map((zone) => (
            <AvoidZoneOverlay
              key={zone.id}
              zone={zone}
              surfaceY={
                zone.kind === 'legroom' ? 0.004 : project.room.desk.height + 0.003
              }
            />
          ))
        : null}
      {showNodes
        ? nodes.map((node) => (
            <RouteNodeMarker
              key={node.id}
              node={node}
              highlighted={highlightedNodeIds.has(node.id)}
              onHover={() => setHoveredNodeId(node.id)}
              onOut={() => setHoveredNodeId(null)}
              showLabel={hoveredNodeId === node.id}
            />
          ))
        : null}
    </group>
  )
}

function RouteNodeMarker({
  node,
  highlighted,
  showLabel,
  onHover,
  onOut,
}: {
  node: RouteNode
  highlighted: boolean
  showLabel: boolean
  onHover: () => void
  onOut: () => void
}) {
  const meta = ROUTE_NODE_META[node.kind]
  const big = node.kind === 'hole' || node.kind === 'outlet'
  const radius = highlighted ? 0.014 : big ? 0.011 : 0.008
  return (
    <group position={[node.position[0], node.position[1], node.position[2]]}>
      <mesh
        geometry={sphereGeometry(radius, 12, 12)}
        material={basicMaterial(meta.color, {
          opacity: highlighted ? 0.95 : 0.65,
        })}
        onPointerOver={(e) => {
          e.stopPropagation()
          onHover()
          document.body.style.cursor = 'help'
        }}
        onPointerOut={() => {
          onOut()
          document.body.style.cursor = ''
        }}
      />
      {showLabel ? (
        <Html position={[0, 0.035, 0]} center distanceFactor={8} zIndexRange={[20, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface/95 px-2 py-0.5 text-[11px] shadow-sm">
            <span style={{ color: meta.color }}>{meta.label}</span>
            <span className="text-muted-foreground"> · {node.label}</span>
          </div>
        </Html>
      ) : null}
    </group>
  )
}

function AvoidZoneOverlay({ zone, surfaceY }: { zone: CableAvoidZone; surfaceY: number }) {
  const meta = { typing: '#E5484D', cup: '#D97706', legroom: '#2563EB' }[zone.kind]
  const { x0, x1, z0, z1 } = zone.rect
  const w = Math.max(0.02, x1 - x0)
  const d = Math.max(0.02, z1 - z0)
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const loop: [number, number, number][] = [
    [x0, surfaceY, z0],
    [x1, surfaceY, z0],
    [x1, surfaceY, z1],
    [x0, surfaceY, z1],
    [x0, surfaceY, z0],
  ]
  return (
    <group>
      <mesh
        position={[cx, surfaceY, cz]}
        rotation={[-Math.PI / 2, 0, 0]}
        geometry={planeGeometry(w, d)}
        material={basicMaterial(meta, { opacity: 0.07, doubleSide: true })}
      />
      <Line points={loop} color={meta} lineWidth={1.2} transparent opacity={0.55} />
      <Html position={[cx, surfaceY + 0.02, cz]} center distanceFactor={9} zIndexRange={[10, 0]}>
        <div
          className="pointer-events-none whitespace-nowrap rounded-full border bg-surface/90 px-2 py-0.5 text-[10px] font-medium shadow-sm"
          style={{ borderColor: `${meta}66`, color: meta }}
        >
          {zone.label}
        </div>
      </Html>
    </group>
  )
}
