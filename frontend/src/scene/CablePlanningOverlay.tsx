import { useMemo, useState } from 'react'
import { Html } from '@react-three/drei'
import type { Project } from '@/types/project'
import { ROUTE_NODE_META, type RouteNode } from '@/types/cable'
import { computeRouteNodes } from '@/scene/routeNodes'
import { useCableStore } from '@/state/cableStore'
import { basicMaterial, sphereGeometry } from './resources'

/**
 * 走线模式叠加层：
 * - 场景路由节点标记（桌边 / 桌底 / 桌腿与床架立柱 / 出线孔 / 插座 / 地面）；
 * 活动区仅用于物品整理，不约束线缆。
 */

export function CablePlanningOverlay({ project }: { project: Project }) {
  const showNodes = useCableStore((s) => s.showRouteNodes)
  const selectedCableId = useCableStore((s) => s.selectedCableId)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  const nodes = useMemo(() => computeRouteNodes(project.room), [project.room])
  const highlightedNodeIds = useMemo(() => {
    const cable = project.cables.find((c) => c.id === selectedCableId)
    return new Set((cable?.route.nodeIds ?? []).filter((id): id is string => Boolean(id)))
  }, [project.cables, selectedCableId])

  return (
    <group>
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
        <Html position={[0, 0.035, 0]} center zIndexRange={[20, 0]}>
          <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface/95 px-2 py-0.5 text-[11px] shadow-sm">
            <span style={{ color: meta.color }}>{meta.label}</span>
            <span className="text-muted-foreground"> · {node.label}</span>
          </div>
        </Html>
      ) : null}
    </group>
  )
}
