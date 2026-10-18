import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { useDrawerStore } from '@/state/drawerStore'
import { SCENE_BACKGROUND } from './renderProfile'

/** Shared daylight rig; a single shadow caster keeps the preview inexpensive. */
export function SceneLighting() {
  const invalidate = useThree((s) => s.invalidate)
  // Drawer motion is imperative. Wake a demand canvas on its first state change and
  // every subsequent animation step, including hover material changes and dragging.
  useEffect(() => useDrawerStore.subscribe(() => invalidate()), [invalidate])

  return <>
    <color attach="background" args={[SCENE_BACKGROUND]} />
    <ambientLight intensity={0.55} />
    <hemisphereLight args={['#EEF5FA', '#C9D2CB', 0.75]} />
    <directionalLight position={[-2.5, 4.5, 3]} intensity={2.4} color="#FFFAF2" castShadow
      shadow-mapSize-width={1024} shadow-mapSize-height={1024}
      shadow-camera-left={-2.5} shadow-camera-right={2.5}
      shadow-camera-top={3} shadow-camera-bottom={-2}
      shadow-camera-near={0.5} shadow-camera-far={12}
      shadow-bias={-0.00015} shadow-normalBias={0.003} />
    <directionalLight position={[3, 3, 4]} intensity={0.7} color="#EDF6FF" />
  </>
}
