import { useMemo, useState } from 'react'
import { useConnectionsStore } from '@/features/connections/store'
import { Html } from '@react-three/drei'
import type { Port, Project, Vec3 } from '@/types/project'
import { PORT_TYPE_LABELS } from '@/types/project'
import { PORT_TYPE_COLORS, portWorldPosition } from '@/scene/ports'
import { useCableLink } from '@/lib/useCableLink'
import { useCableStore } from '@/state/cableStore'
import { basicMaterial, ringGeometry, sphereGeometry } from './resources'

/**
 * 接口标记（走线模式）：在电气设备的接口世界坐标处显示可点击小球。
 * 点击第一个接口进入连线模式，再点击另一个接口即建立连接关系。
 */

interface PortMarkerData {
  objectId: string
  objectName: string
  port: Port
  position: Vec3
}

export function PortMarkers({ project }: { project: Project }) {
  const showPorts = useCableStore((s) => s.showPorts)
  const linkFrom = useCableStore((s) => s.linkFrom)
  const [hoveredKey, setHoveredKey] = useState<string | null>(null)
  const onPortClick = useCableLink()

  const markers = useMemo<PortMarkerData[]>(() => {
    const out: PortMarkerData[] = []
    for (const o of project.objects) {
      if (!o.visible || o.ports.length === 0) continue
      for (const p of o.ports) {
        out.push({ objectId: o.id, objectName: o.name, port: p, position: portWorldPosition(o, p) })
      }
    }
    return out
  }, [project.objects])

  const picking = useConnectionsStore(s => s.projectId === project.id && s.pickingObjectId !== null)
  if (!showPorts || picking) return null

  return (
    <group>
      {markers.map((m) => {
        const key = `${m.objectId}:${m.port.id}`
        const isLinkSource =
          linkFrom?.objectId === m.objectId && linkFrom?.portId === m.port.id
        const isHovered = hoveredKey === key
        const color = PORT_TYPE_COLORS[m.port.type]
        const wireless = m.port.type === 'wireless'
        return (
          <group key={key} position={[m.position[0], m.position[1], m.position[2]]}>
            <mesh
              geometry={sphereGeometry(isLinkSource ? 0.017 : isHovered ? 0.014 : 0.01, 12, 12)}
              material={basicMaterial(color, {
                opacity: isLinkSource ? 1 : wireless ? 0.45 : 0.9,
              })}
              onPointerOver={(e) => {
                e.stopPropagation()
                setHoveredKey(key)
                document.body.style.cursor = 'crosshair'
              }}
              onPointerOut={() => {
                setHoveredKey(null)
                document.body.style.cursor = ''
              }}
              onClick={(e) => {
                e.stopPropagation()
                onPortClick(project, m.objectId, m.port.id)
              }}
            />
            {isLinkSource ? (
              <mesh
                rotation={[-Math.PI / 2, 0, 0]}
                geometry={ringGeometry(0.02, 0.026, 24)}
                material={basicMaterial('#0F9D8A', { opacity: 0.9, doubleSide: true })}
              />
            ) : null}
            {isHovered || isLinkSource ? (
              <Html
                position={[0, 0.045, 0]}
                center
                zIndexRange={[30, 10]}
              >
                <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface/95 px-2 py-1 text-[11px] leading-tight shadow-sm">
                  <span className="font-medium">{m.objectName}</span>
                  <span className="text-muted-foreground">
                    {' '}
                    · {m.port.label ?? PORT_TYPE_LABELS[m.port.type]}
                  </span>
                  {m.port.note ? <p className="mt-1 max-w-48 whitespace-normal break-words text-xs text-muted-foreground">{m.port.note}</p> : null}
                  <div className="text-[10px] text-faint">
                    {isLinkSource
                      ? '已选为起点：再点击另一个接口'
                      : wireless
                        ? '无线接口：无需线缆'
                        : '点击选择 / 建立连接'}
                  </div>
                </div>
              </Html>
            ) : null}
          </group>
        )
      })}
    </group>
  )
}
