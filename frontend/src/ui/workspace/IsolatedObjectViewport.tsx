import { Suspense, useEffect, useRef } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import type { OrbitControls as Controls } from 'three-stdlib'
import type { Project, SceneObject } from '@/types/project'
import { SceneObjectMesh } from '@/scene/SceneObjectMesh'
import { SurfacePointOverlay } from '@/features/connections/SurfacePointOverlay'

function FocusCamera({ object }: { object: SceneObject }) {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)
  const controls = useRef<Controls>(null)
  const [x, y, z] = object.transform.position
  const { width, height, depth } = object.dimensions
  useEffect(() => {
    const d = Math.max(width, height, depth) * 2.5 * Math.max(1, size.height / size.width)
    camera.position.set(x + d * .65, y + height / 2 + d * .45, z + d)
    controls.current?.target.set(x, y + height / 2, z)
    controls.current?.update()
  }, [camera, x, y, z, width, height, depth, size.width, size.height])
  return <OrbitControls ref={controls} makeDefault enableDamping minDistance={.08} maxDistance={6} />
}

export function IsolatedObjectViewport({ project, objectId }: { project: Project; objectId: string | null }) {
  const object = project.objects.find((o) => o.id === objectId)
  if (!object) return null
  const isolated = { ...project, objects: [object], cables: [] }
  return <div className="absolute inset-x-0 bottom-0 top-14 right-[344px]" aria-label={`单独预览：${object.name}`}>
    <Canvas camera={{ fov: 40 }} dpr={[1, 2]}>
      <color attach="background" args={['#F4F1EA']} />
      <ambientLight intensity={1.1} />
      <directionalLight position={[3, 5, 4]} intensity={1.8} />
      <Suspense fallback={null}>
        <SceneObjectMesh project={project} object={object} selected={false} onSelect={() => {}} />
        <SurfacePointOverlay project={isolated} />
      </Suspense>
      <FocusCamera object={object} />
    </Canvas>
  </div>
}
