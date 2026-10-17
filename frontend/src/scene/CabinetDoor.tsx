import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { useCabinetStore } from '@/state/cabinetStore'

/** Runtime door for the open cabinet in the supplied desk asset. */
export function CabinetDoor() {
  const pivot = useRef<Group>(null)
  const open = useCabinetStore((s) => s.open)
  const toggle = useCabinetStore((s) => s.toggle)
  useFrame((_, dt) => {
    if (!pivot.current) return
    const target = open ? -Math.PI / 2 : 0
    pivot.current.rotation.y += (target - pivot.current.rotation.y) * (1 - Math.exp(-12 * dt))
  })
  return <group ref={pivot} position={[.61, .04, .138]} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); toggle() }}>
    <mesh position={[0, .3335, .1715]} castShadow receiveShadow>
      <boxGeometry args={[.018, .667, .343]} />
      <meshStandardMaterial color="#c4a47e" roughness={.75} />
    </mesh>
    <mesh position={[-.018, .34, .285]} castShadow>
      <boxGeometry args={[.025, .09, .014]} />
      <meshStandardMaterial color="#535953" metalness={.5} roughness={.4} />
    </mesh>
  </group>
}
