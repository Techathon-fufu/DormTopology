import * as THREE from 'three'

/**
 * 场景几何体 / 材质缓存（性能优化）。
 *
 * 同一尺寸、同一配色的几何体与材质在整场景中只创建一个实例：
 * - 家具（四根立柱、桌腿、梯子横档等）与占位模型（床头灯、多口排插等）自动复用；
 * - 选中 / 悬停高亮框同样复用（拖拽、反复悬停不会反复创建资源）；
 * - 缓存以毫米为精度取整作为键，键空间有限，不会随拖拽无限增长。
 */
const geoCache = new Map<string, THREE.BufferGeometry>()
const matCache = new Map<string, THREE.Material>()

/** 毫米精度取整（避免浮点抖动产生重复键） */
const r3 = (n: number) => Math.round(n * 1000) / 1000

export function boxGeometry(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `box|${r3(w)}|${r3(h)}|${r3(d)}`
  let geo = geoCache.get(key) as THREE.BoxGeometry | undefined
  if (!geo) {
    geo = new THREE.BoxGeometry(r3(w), r3(h), r3(d))
    geoCache.set(key, geo)
  }
  return geo
}

export function cylinderGeometry(
  radiusTop: number,
  radiusBottom: number,
  height: number,
  radialSegments: number,
  openEnded = false,
): THREE.CylinderGeometry {
  const key = `cyl|${r3(radiusTop)}|${r3(radiusBottom)}|${r3(height)}|${radialSegments}|${openEnded ? 1 : 0}`
  let geo = geoCache.get(key) as THREE.CylinderGeometry | undefined
  if (!geo) {
    geo = new THREE.CylinderGeometry(
      r3(radiusTop),
      r3(radiusBottom),
      r3(height),
      radialSegments,
      1,
      openEnded,
    )
    geoCache.set(key, geo)
  }
  return geo
}

export function torusGeometry(
  radius: number,
  tube: number,
  radialSegments: number,
  tubularSegments: number,
  arc: number = Math.PI * 2,
): THREE.TorusGeometry {
  const key = `tor|${r3(radius)}|${r3(tube)}|${radialSegments}|${tubularSegments}|${r3(arc)}`
  let geo = geoCache.get(key) as THREE.TorusGeometry | undefined
  if (!geo) {
    geo = new THREE.TorusGeometry(r3(radius), r3(tube), radialSegments, tubularSegments, r3(arc))
    geoCache.set(key, geo)
  }
  return geo
}

export function planeGeometry(w: number, h: number): THREE.PlaneGeometry {
  const key = `pln|${r3(w)}|${r3(h)}`
  let geo = geoCache.get(key) as THREE.PlaneGeometry | undefined
  if (!geo) {
    geo = new THREE.PlaneGeometry(r3(w), r3(h))
    geoCache.set(key, geo)
  }
  return geo
}

export function sphereGeometry(radius: number, widthSegments: number, heightSegments: number): THREE.SphereGeometry {
  const key = `sph|${r3(radius)}|${widthSegments}|${heightSegments}`
  let geo = geoCache.get(key) as THREE.SphereGeometry | undefined
  if (!geo) {
    geo = new THREE.SphereGeometry(r3(radius), widthSegments, heightSegments)
    geoCache.set(key, geo)
  }
  return geo
}

export function ringGeometry(innerRadius: number, outerRadius: number, thetaSegments: number): THREE.RingGeometry {
  const key = `rng|${r3(innerRadius)}|${r3(outerRadius)}|${thetaSegments}`
  let geo = geoCache.get(key) as THREE.RingGeometry | undefined
  if (!geo) {
    geo = new THREE.RingGeometry(r3(innerRadius), r3(outerRadius), thetaSegments)
    geoCache.set(key, geo)
  }
  return geo
}

export interface StandardMaterialOptions {
  metalness?: number
  roughness?: number
  emissive?: string
  emissiveIntensity?: number
  doubleSide?: boolean
}

export function standardMaterial(
  color: string,
  opts: StandardMaterialOptions = {},
): THREE.MeshStandardMaterial {
  const key = `std|${color}|${opts.metalness ?? 0}|${opts.roughness ?? 1}|${opts.emissive ?? ''}|${
    opts.emissiveIntensity ?? 1
  }|${opts.doubleSide ? 'd' : 's'}`
  let mat = matCache.get(key) as THREE.MeshStandardMaterial | undefined
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color,
      metalness: opts.metalness ?? 0,
      roughness: opts.roughness ?? 1,
      emissive: opts.emissive ?? '#000000',
      emissiveIntensity: opts.emissiveIntensity ?? 1,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    })
    matCache.set(key, mat)
  }
  return mat
}

export interface BasicMaterialOptions {
  wireframe?: boolean
  opacity?: number
  doubleSide?: boolean
}

export function basicMaterial(color: string, opts: BasicMaterialOptions = {}): THREE.MeshBasicMaterial {
  const key = `bas|${color}|${opts.wireframe ? 'w' : 's'}|${opts.opacity ?? 1}|${opts.doubleSide ? 'd' : 's'}`
  let mat = matCache.get(key) as THREE.MeshBasicMaterial | undefined
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({
      color,
      wireframe: opts.wireframe ?? false,
      transparent: (opts.opacity ?? 1) < 1,
      depthWrite: (opts.opacity ?? 1) >= 1,
      opacity: opts.opacity ?? 1,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
    })
    matCache.set(key, mat)
  }
  return mat
}
