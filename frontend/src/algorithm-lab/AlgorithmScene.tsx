import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { Edges, Html, Line, OrbitControls } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import { detectWebGL } from '@/lib/webgl'
import type { BoxZone, Scene, RoutingResult, RoutingSupport, Vec3 } from './contract'

export type Layers = { regions: boolean; collisions: boolean; network: boolean; cables: boolean; reserved: boolean; supports: boolean; trayCandidates: boolean }
export type CameraView = 'perspective' | 'top' | 'front' | 'underside'

export const itemColors = ['#168b82', '#4779c8', '#bd6357', '#829943', '#9a6caa', '#b38732']
export const supportColors = { surface: '#42835b', cable_tie: '#d78c24', cable_tray: '#3669b2' }
export const supportLabels = { surface: '承托表面', cable_tie: '固定扎带', cable_tray: '集线槽' }
const cableColors = ['#c34637', '#2970be', '#078276', '#ae6b13', '#8246a2', '#3d4a59', '#b1376f']

export function cableColor(id: string): string {
  let hash = 0
  for (const character of id) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0
  return cableColors[hash % cableColors.length]
}

function supportBox(support: RoutingSupport, obstacle: BoxZone): BoxZone {
  const normalAxis = { x: 0, y: 1, z: 2 }[support.face[0] as 'x' | 'y' | 'z']
  const axes = [0, 1, 2].filter(axis => axis !== normalAxis)
  const negative = support.face.endsWith('min')
  const plane = (negative ? obstacle.min : obstacle.max)[normalAxis]
  const min: Vec3 = [0, 0, 0]
  const max: Vec3 = [0, 0, 0]
  min[normalAxis] = negative ? plane - support.stand_off_m : plane
  max[normalAxis] = negative ? plane : plane + support.stand_off_m
  axes.forEach((axis, index) => {
    min[axis] = support.bounds_uv_m[index * 2]
    max[axis] = support.bounds_uv_m[index * 2 + 1]
  })
  return { id: support.id, min, max }
}

function Support({ support, obstacle, selected, onSelect, candidate = false }: {
  support: RoutingSupport; obstacle: BoxZone; selected: boolean; onSelect: (id: string) => void; candidate?: boolean
}) {
  const zone = supportBox(support, obstacle)
  const size = zone.max.map((value, axis) => value - zone.min[axis]) as Vec3
  const center = zone.min.map((value, axis) => (value + zone.max[axis]) / 2) as Vec3
  const color = selected ? '#e9b548' : candidate ? '#a66d12' : supportColors[support.kind]
  return <mesh position={center} onClick={event => { event.stopPropagation(); onSelect(support.id) }}>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} transparent opacity={candidate ? selected ? 0.20 : 0.08 : selected ? 0.75 : 0.45} depthWrite={false} />
    <Edges color={color} />
    {selected && <Html center style={{ pointerEvents: 'none' }}>
      <span className="lab-object-label">{candidate ? '待安装集线槽' : supportLabels[support.kind]} · {support.id}</span>
    </Html>}
  </mesh>
}

function Zone({ zone, color, opacity = 0.12 }: { zone: BoxZone; color: string; opacity?: number }) {
  const size = zone.max.map((value, i) => value - zone.min[i]) as Vec3
  const center = zone.min.map((value, i) => (value + zone.max[i]) / 2) as Vec3
  return (
    <mesh position={center}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} transparent opacity={opacity} depthWrite={false} />
      <Edges color={color} transparent opacity={0.5} />
    </mesh>
  )
}

function Camera({ bounds, view, reset, onMove }: {
  bounds: Box3; view: CameraView; reset: number; onMove: (position: string) => void
}) {
  const { camera, size: viewportSize } = useThree()
  const controls = useRef<OrbitControlsImpl>(null)
  useEffect(() => {
    const center = bounds.getCenter(new Vector3())
    const size = bounds.getSize(new Vector3())
    const aspect = 'aspect' in camera ? Number(camera.aspect) : 1
    const span = Math.max(size.x, size.y, size.z, 0.5)
    const distance = span * 1.8 / Math.min(1, aspect)
    const direction = view === 'top' ? new Vector3(0, 1, 0.001)
      : view === 'front' ? new Vector3(0, 0.15, 1) : view === 'underside' ? new Vector3(0.75, -0.55, 1.2)
        : new Vector3(0.9, 0.65, 1.2)
    camera.position.copy(center).add(direction.normalize().multiplyScalar(distance))
    camera.near = distance / 1000
    camera.far = distance * 30
    camera.updateProjectionMatrix()
    controls.current?.target.copy(center)
    controls.current?.update()
    onMove(camera.position.toArray().map(n => n.toFixed(5)).join(','))
  }, [bounds, view, reset, camera, onMove, viewportSize.width, viewportSize.height])
  return <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.12}
    minDistance={0.05} maxDistance={Math.max(100, bounds.getSize(new Vector3()).length() * 50)} onChange={() => {
      onMove(camera.position.toArray().map(n => n.toFixed(5)).join(','))
    }} />
}

class RenderBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() {
    return this.state.error ? <div className="lab-render-error" role="alert">
      <p>三维渲染失败：{this.state.error}</p>
      <button onClick={() => this.setState({ error: null })}>重试</button>
    </div> : this.props.children
  }
}

export function AlgorithmScene({ scene, routing, layers, selected, onSelect, view, reset, onMove }: {
  scene: Scene; routing?: RoutingResult; layers: Layers; selected: string | null
  onSelect: (id: string | null) => void; view: CameraView; reset: number
  onMove: (position: string) => void
}) {
  const webgl = useMemo(detectWebGL, [])
  const bounds = useMemo(() => {
    const box = new Box3(new Vector3(0, 0, 0), new Vector3(scene.desk.width_m, scene.desk.top_height_m, scene.desk.depth_m))
    for (const item of scene.items) {
      const radius = Math.hypot(item.size_m[0], item.size_m[2]) / 2
      box.expandByPoint(new Vector3(item.position[0] - radius, item.position[1], item.position[2] - radius))
      box.expandByPoint(new Vector3(item.position[0] + radius, item.position[1] + item.size_m[1], item.position[2] + radius))
    }
    for (const obstacle of scene.obstacles) {
      box.expandByPoint(new Vector3(...obstacle.min)); box.expandByPoint(new Vector3(...obstacle.max))
    }
    for (const support of [...(scene.routing_graph.supports ?? []), ...(scene.routing_graph.tray_candidates ?? [])]) {
      const obstacle = scene.obstacles.find(entry => entry.id === support.obstacle_id)!
      const zone = supportBox(support, obstacle)
      box.expandByPoint(new Vector3(...zone.min)); box.expandByPoint(new Vector3(...zone.max))
    }
    for (const zone of scene.reserved_zones) {
      box.expandByPoint(new Vector3(...zone.min)); box.expandByPoint(new Vector3(...zone.max))
    }
    for (const region of scene.regions) {
      box.expandByPoint(new Vector3(region.bounds_xz_m[0], region.surface_y_m, region.bounds_xz_m[2]))
      box.expandByPoint(new Vector3(region.bounds_xz_m[1], region.surface_y_m, region.bounds_xz_m[3]))
    }
    for (const node of scene.routing_graph.nodes) box.expandByPoint(new Vector3(...node.position))
    for (const cable of routing?.cables ?? []) {
      for (const point of cable.path_points) box.expandByPoint(new Vector3(...point))
    }
    return box
  }, [scene, routing])
  const span = Math.max(...bounds.getSize(new Vector3()).toArray(), 1)
  const nodes = new Map(scene.routing_graph.nodes.map(node => [node.id, node]))
  if (!webgl) return <div className="lab-render-error" role="alert">WebGL 不可用，三维视图无法加载。</div>
  return <RenderBoundary>
    <Canvas dpr={[1, 1.5]} camera={{ fov: 40 }} gl={{ preserveDrawingBuffer: true }}
      onPointerMissed={() => onSelect(null)}>
      <color attach="background" args={['#f1f4f5']} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[2, 5, 4]} intensity={2} />
      <gridHelper args={[Math.ceil(span * 3), Math.min(100, Math.ceil(span * 3) * 10), '#b8c7ca', '#dce4e6']} position={[scene.desk.width_m / 2, -0.012, scene.desk.depth_m / 2]} />
      {layers.collisions && scene.obstacles.map(zone => <Zone key={zone.id} zone={zone} color="#6f858e" opacity={0.24} />)}
      {layers.supports && scene.routing_graph.supports?.map(support => <Support key={support.id} support={support}
        obstacle={scene.obstacles.find(entry => entry.id === support.obstacle_id)!}
        selected={selected === support.id} onSelect={onSelect} />)}
      {layers.trayCandidates && scene.routing_graph.tray_candidates?.map(candidate => <Support key={candidate.id} support={candidate}
        obstacle={scene.obstacles.find(entry => entry.id === candidate.obstacle_id)!}
        selected={selected === candidate.id} onSelect={onSelect} candidate />)}
      {layers.reserved && scene.reserved_zones.map(zone => <Zone key={zone.id} zone={zone} color="#cd5d50" />)}
      {layers.regions && scene.regions.map(region => {
        const [x0, x1, z0, z1] = region.bounds_xz_m
        return <mesh key={region.id} position={[(x0 + x1) / 2, region.surface_y_m + 0.001, (z0 + z1) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[x1 - x0, z1 - z0]} />
          <meshBasicMaterial color="#31a296" transparent opacity={0.16} depthWrite={false} side={2} />
          <Edges color="#31a296" />
        </mesh>
      })}
      {scene.items.map((item, index) => <group key={item.id} position={item.position} rotation={[0, item.rotation_y_rad, 0]}>
        <mesh position={[0, item.size_m[1] / 2, 0]} onClick={event => { event.stopPropagation(); onSelect(item.id) }}>
          <boxGeometry args={item.size_m} />
          <meshStandardMaterial color={selected === item.id ? '#e9b548' : itemColors[index % itemColors.length]} roughness={0.65} />
          <Edges color={selected === item.id ? '#704a08' : '#344c53'} />
        </mesh>
        {item.ports.map(port => <group key={port.id}>
          <mesh position={port.local_position}>
            <sphereGeometry args={[Math.max(0.006, span * 0.003), 12, 8]} />
            <meshBasicMaterial color="#202e3a" />
          </mesh>
          <Line points={[port.local_position, port.local_position.map((v, i) => v + port.local_direction[i] * 0.04) as Vec3]} color="#202e3a" lineWidth={1.5} />
        </group>)}
        {selected === item.id && <Html center position={[0, item.size_m[1] + 0.04, 0]} style={{ pointerEvents: 'none' }}>
          <span className="lab-object-label">{item.name}</span>
        </Html>}
      </group>)}
      {layers.network && scene.routing_graph.edges.map(edge => <Line key={edge.id}
        points={[nodes.get(edge.from_node_id)!.position, nodes.get(edge.to_node_id)!.position]}
        color={edge.modes.includes('slot') ? '#7b65a5' : '#b37530'} dashed dashSize={0.018} gapSize={0.012} lineWidth={1.5} />)}
      {layers.network && scene.routing_graph.nodes.map(node => <mesh key={node.id} position={node.position}>
        <sphereGeometry args={[0.008, 10, 8]} /><meshBasicMaterial color={node.kind === 'slot' ? '#7b65a5' : '#b37530'} />
      </mesh>)}
      {layers.cables && routing?.cables.filter(cable => cable.status === 'valid').map(cable =>
        <Line key={cable.id} points={cable.path_points} color={cableColor(cable.id)} lineWidth={4} />)}
      <Camera bounds={bounds} view={view} reset={reset} onMove={onMove} />
    </Canvas>
  </RenderBoundary>
}
