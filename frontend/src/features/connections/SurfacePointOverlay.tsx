import { Quaternion, Vector3 } from 'three'
import type { Project } from '@/types/project'
import { localToWorld, rotateLocalVecY } from '@/scene/ports'
import { bookPoseDirection } from '@/scene/bookPose'
import { useConnectionsStore } from './store'
export function SurfacePointOverlay({project, markerScale = 1}: {project:Project; markerScale?: number}) {
  const session = useConnectionsStore()
  const hit = session.projectId === project.id ? session.hit ?? session.hover : null
  const object = hit && project.objects.find(o => o.id === hit.objectId)
  if (!hit || !object) return null
  const direction = new Vector3(...rotateLocalVecY(bookPoseDirection(object, hit.localDirection), object.transform.rotationY)).normalize()
  const q = new Quaternion().setFromUnitVectors(new Vector3(0,1,0), direction)
  return <group position={localToWorld(object,hit.offset)} quaternion={q} scale={markerScale}>
    <mesh raycast={() => {}}><sphereGeometry args={[.009,12,12]}/><meshBasicMaterial color="#0F9D8A" depthTest={false}/></mesh>
    <mesh position={[0,.035,0]} raycast={() => {}}><cylinderGeometry args={[.002,.002,.07,8]}/><meshBasicMaterial color="#0F9D8A"/></mesh>
    <mesh position={[0,.075,0]} raycast={() => {}}><coneGeometry args={[.008,.02,8]}/><meshBasicMaterial color="#0F9D8A"/></mesh>
  </group>
}
