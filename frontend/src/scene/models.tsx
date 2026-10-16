import type { ObjectCategory, ObjectDimensions, PrimitiveShape } from '@/types/project'
import {
  boxGeometry,
  cylinderGeometry,
  planeGeometry,
  sphereGeometry,
  standardMaterial,
  torusGeometry,
} from './resources'

/** 场景内三大分类的占位配色（真实材质接入前） */
export const CATEGORY_COLORS: Record<ObjectCategory, string> = {
  electrical: '#4F5A66',
  nonElectrical: '#B7A98F',
  storage: '#8FA89B',
}

interface Dims {
  w: number
  h: number
  d: number
}

const METAL = { metalness: 0.35, roughness: 0.5 }

function Laptop({ w, h, d }: Dims) {
  const baseH = 0.018
  const screenH = Math.max(0.05, h - baseH)
  return (
    <group>
      <mesh
        castShadow
        position={[0, -h / 2 + baseH / 2, 0]}
        geometry={boxGeometry(w, baseH, d)}
        material={standardMaterial('#5A6470', METAL)}
      />
      <mesh
        castShadow
        position={[0, -h / 2 + baseH + screenH / 2 - 0.005, -d / 2 + 0.02]}
        rotation={[-0.16, 0, 0]}
        geometry={boxGeometry(w, screenH, 0.014)}
        material={standardMaterial('#39424C', METAL)}
      />
      <mesh
        position={[0, -h / 2 + baseH + screenH / 2 - 0.005, -d / 2 + 0.029]}
        rotation={[-0.16, 0, 0]}
        geometry={planeGeometry(w * 0.92, screenH * 0.86)}
        material={standardMaterial('#2E4A5A', { emissive: '#7FB6C9', emissiveIntensity: 0.25 })}
      />
    </group>
  )
}

function Monitor({ w, h, d }: Dims) {
  const baseH = 0.014
  const colH = 0.1
  const panelH = Math.max(0.08, h - baseH - colH)
  return (
    <group>
      <mesh
        castShadow
        position={[0, -h / 2 + baseH / 2, 0.02]}
        geometry={boxGeometry(w * 0.36, baseH, d * 0.8)}
        material={standardMaterial('#4A5560', METAL)}
      />
      <mesh
        castShadow
        position={[0, -h / 2 + baseH + colH / 2, -d / 2 + 0.06]}
        geometry={boxGeometry(0.04, colH, 0.04)}
        material={standardMaterial('#39424C', METAL)}
      />
      <mesh
        castShadow
        position={[0, -h / 2 + baseH + colH + panelH / 2, 0]}
        geometry={boxGeometry(w, panelH, 0.022)}
        material={standardMaterial('#39424C', METAL)}
      />
      <mesh
        position={[0, -h / 2 + baseH + colH + panelH / 2, 0.013]}
        geometry={planeGeometry(w * 0.94, panelH * 0.88)}
        material={standardMaterial('#2E4A5A', { emissive: '#7FB6C9', emissiveIntensity: 0.22 })}
      />
    </group>
  )
}

function Keyboard({ w, h, d }: Dims) {
  return (
    <group>
      <mesh castShadow geometry={boxGeometry(w, h, d)} material={standardMaterial('#525C66', METAL)} />
      <mesh
        position={[0, h / 2 + 0.002, 0]}
        geometry={boxGeometry(w * 0.92, 0.004, d * 0.62)}
        material={standardMaterial('#3B444E', { roughness: 0.6 })}
      />
    </group>
  )
}

function MouseDims({ w, h, d }: Dims) {
  return (
    <mesh
      castShadow
      scale={[w, h, d]}
      geometry={sphereGeometry(0.5, 20, 14)}
      material={standardMaterial('#4F5A66', METAL)}
    />
  )
}

function Lamp({ w, h, d }: Dims) {
  const baseR = Math.min(w, d) / 2
  const armH = h * 0.72
  return (
    <group>
      <mesh
        castShadow
        position={[0, -h / 2 + 0.008, 0]}
        geometry={cylinderGeometry(baseR, baseR * 1.1, 0.016, 20)}
        material={standardMaterial('#3B444E', METAL)}
      />
      <mesh
        castShadow
        position={[0, -h / 2 + 0.016 + armH / 2, -0.01]}
        rotation={[0.08, 0, 0]}
        geometry={cylinderGeometry(0.009, 0.009, armH, 10)}
        material={standardMaterial('#3B444E', METAL)}
      />
      <mesh
        position={[0, h / 2 - 0.035, 0.02]}
        rotation={[0.5, 0, 0]}
        geometry={cylinderGeometry(w * 0.32, w * 0.44, 0.055, 16, true)}
        material={standardMaterial('#3B444E', { ...METAL, doubleSide: true })}
      />
    </group>
  )
}

const BOOK_COLORS = ['#B96A4B', '#8A99A8', '#C9A06A']

function Books({ w, h, d }: Dims) {
  const each = h / 3
  return (
    <group>
      {BOOK_COLORS.map((color, i) => (
        <mesh
          key={color}
          castShadow
          position={[
            (i - 1) * 0.008,
            -h / 2 + each / 2 + i * each,
            (i % 2 === 0 ? 1 : -1) * 0.006,
          ]}
          rotation={[0, (i - 1) * 0.06, (i % 2 === 0 ? -1 : 1) * 0.015]}
          geometry={boxGeometry(w, each * 0.92, d)}
          material={standardMaterial(color, { roughness: 0.8 })}
        />
      ))}
    </group>
  )
}

function Cup({ w, h, d }: Dims) {
  const r = Math.min(w, d) / 2
  return (
    <group>
      <mesh
        castShadow
        geometry={cylinderGeometry(r, r * 0.92, h, 20)}
        material={standardMaterial('#E8E4DA', { roughness: 0.5 })}
      />
      <mesh
        position={[r + 0.006, 0.01, 0]}
        rotation={[0, 0, Math.PI / 2]}
        geometry={torusGeometry(0.014, 0.004, 8, 16, Math.PI)}
        material={standardMaterial('#D9D4C8', { roughness: 0.5 })}
      />
    </group>
  )
}

function StorageBox({ w, h, d }: Dims) {
  return (
    <group>
      <mesh castShadow geometry={boxGeometry(w, h, d)} material={standardMaterial('#9DB4A8', { roughness: 0.75 })} />
      <mesh
        position={[0, h / 2 - 0.006, 0]}
        geometry={boxGeometry(w, 0.012, d)}
        material={standardMaterial('#87A093', { roughness: 0.7 })}
      />
    </group>
  )
}

function PowerStrip({ w, h, d }: Dims) {
  return (
    <group>
      <mesh castShadow geometry={boxGeometry(w, h, d)} material={standardMaterial('#E5E2DA', { roughness: 0.5 })} />
      {[0, 1, 2, 3].map((i) => (
        <mesh
          key={i}
          position={[(i - 1.5) * (w / 4), h / 2 + 0.002, 0]}
          geometry={cylinderGeometry(0.008, 0.008, 0.004, 12)}
          material={standardMaterial('#6B7280', { roughness: 0.6 })}
        />
      ))}
      <mesh
        position={[w / 2 + 0.014, -0.002, 0]}
        rotation={[0, 0, Math.PI / 2]}
        geometry={cylinderGeometry(0.004, 0.004, 0.03, 8)}
        material={standardMaterial('#3B444E')}
      />
    </group>
  )
}

function GenericBox({ w, h, d, color }: Dims & { color: string }) {
  return (
    <mesh
      castShadow
      receiveShadow
      geometry={boxGeometry(w, h, d)}
      material={standardMaterial(color, { roughness: 0.7, metalness: 0.1 })}
    />
  )
}

/** 语义化占位几何体：真实 GLB 资产接入前的通用渲染形态（几何体 / 材质全局复用） */
export function PrimitiveModel({
  shape,
  dims,
  color,
}: {
  shape?: PrimitiveShape
  dims: ObjectDimensions
  color: string
}) {
  const { width: w, height: h, depth: d } = dims
  switch (shape) {
    case 'laptop':
      return <Laptop w={w} h={h} d={d} />
    case 'monitor':
      return <Monitor w={w} h={h} d={d} />
    case 'keyboard':
      return <Keyboard w={w} h={h} d={d} />
    case 'mouse':
      return <MouseDims w={w} h={h} d={d} />
    case 'lamp':
      return <Lamp w={w} h={h} d={d} />
    case 'books':
      return <Books w={w} h={h} d={d} />
    case 'cup':
      return <Cup w={w} h={h} d={d} />
    case 'storageBox':
      return <StorageBox w={w} h={h} d={d} />
    case 'powerStrip':
      return <PowerStrip w={w} h={h} d={d} />
    default:
      return <GenericBox w={w} h={h} d={d} color={color} />
  }
}
