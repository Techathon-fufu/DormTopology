import type { ObjectCategory, ObjectDimensions, PrimitiveShape } from '@/types/project'
import { describePrimitive, primitivePartGeometry } from './primitiveGeometry'
import { standardMaterial } from './resources'

export const CATEGORY_COLORS: Record<ObjectCategory,string> = {
  electrical:'#4F5A66', nonElectrical:'#B7A98F', storage:'#8FA89B',
}

/** Same solid descriptors as collisionGeometry; outer caller centres the display vertically. */
export function PrimitiveModel({shape,dims,color,sockets=4,backboard=false}: {
  shape?: PrimitiveShape; dims:ObjectDimensions; color:string; sockets?:number; backboard?:boolean
}) {
  const description=describePrimitive(shape,dims,color,sockets,backboard)
  return <group position={[0,-dims.height/2,0]}>
    {description.parts.map(part=><mesh key={part.id} castShadow receiveShadow
      position={part.position} rotation={part.rotation}
      geometry={primitivePartGeometry(part)} material={standardMaterial(part.color,{roughness:.65})} />)}
  </group>
}
