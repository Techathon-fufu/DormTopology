import { useMemo, useState } from 'react'
import { Edges, Html } from '@react-three/drei'
import type { Project, Vec3 } from '@/types/project'
import type { CableMount } from '@/types/cableManagement'
import { cableMountVolume, resolveCableManagement } from './cableManagement'

function MountedAccessory({ project, mount }: { project: Project; mount: CableMount }) {
  const [hovered, setHovered] = useState(false)
  const volume = useMemo(() => cableMountVolume(project.room, mount), [project.room, mount])
  if (!volume) return null
  const center = volume.min.map((value, axis) => (value + volume.max[axis]) / 2) as Vec3
  const size = volume.min.map((value, axis) => volume.max[axis] - value) as Vec3
  const color = mount.installed ? '#168775' : '#D49A24'
  const tray = mount.kind === 'cable_tray'

  return <group position={center} onPointerOver={(event) => { event.stopPropagation(); setHovered(true) }} onPointerOut={() => setHovered(false)}>
    {tray ? <group>
      <mesh position={[0, -size[1] / 2 + .003, 0]}>
        <boxGeometry args={[size[0], .006, size[2]]} />
        <meshStandardMaterial color={color} transparent opacity={mount.installed ? .85 : .38} />
      </mesh>
      {[-1, 1].map((side) => <mesh key={side} position={[0, 0, side * (size[2] / 2 - .002)]}>
        <boxGeometry args={[size[0], size[1], .004]} />
        <meshStandardMaterial color={color} transparent opacity={mount.installed ? .8 : .3} />
      </mesh>)}
    </group> : <mesh>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent opacity={mount.installed ? .8 : .3} />
      <Edges color={color} />
    </mesh>}
    {hovered && <Html position={[0, size[1] / 2 + .035, 0]} center zIndexRange={[20, 0]}>
      <div className="pointer-events-none whitespace-nowrap rounded-md border border-border bg-surface/95 px-2 py-1 text-[11px] shadow-sm">
        <span className="font-medium">{mount.label}</span><span className="ml-1.5" style={{ color }}>{mount.installed ? '已确认安装' : '待安装建议'}</span>
      </div>
    </Html>}
  </group>
}

/** Attachments remain visible even when every cable has failed planning. */
export function CableManagementLayer({ project }: { project: Project }) {
  return <group name="cable-management">{resolveCableManagement(project.room).mounts.map((mount) => <MountedAccessory key={mount.id} project={project} mount={mount} />)}</group>
}
