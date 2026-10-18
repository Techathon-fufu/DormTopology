import { useEffect, useMemo } from 'react'
import { BufferGeometry, EdgesGeometry, Float32BufferAttribute } from 'three'
import type { SceneObject } from '@/types/project'
import { localCollision } from './collisionGeometry'

/** Selection and interference outlines use the same solid parts as placement/routing. */
export function CollisionOutline({ object, color, opacity }: { object: SceneObject; color: string; opacity: number }) {
  const body = localCollision(object)
  const geometry = useMemo(() => {
    const positions: number[] = []
    for (const part of body.parts) {
      const source = new BufferGeometry()
      source.setAttribute('position', new Float32BufferAttribute(part.vertices_m.flat(), 3))
      source.setIndex(part.faces.flat())
      const edges = new EdgesGeometry(source)
      positions.push(...edges.getAttribute('position').array)
      edges.dispose()
      source.dispose()
    }
    const merged = new BufferGeometry()
    merged.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return merged
  }, [body])
  useEffect(() => () => geometry.dispose(), [geometry])
  return <lineSegments geometry={geometry} position={[0, -object.dimensions.height / 2, 0]} raycast={() => {}} renderOrder={2}>
    <lineBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
  </lineSegments>
}
