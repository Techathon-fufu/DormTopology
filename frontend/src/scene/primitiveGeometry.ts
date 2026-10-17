import { BoxGeometry, CylinderGeometry, SphereGeometry, type BufferGeometry } from 'three'
import type { ObjectDimensions, PrimitiveShape, Vec3 } from '@/types/project'

/** Local metres, bottom-centre origin. Rendering and convex collision consume these same solids. */
export interface PrimitivePart {
  id: string
  kind: 'box' | 'cylinder' | 'ellipsoid'
  size: Vec3
  position: Vec3
  rotation: Vec3
  color: string
}
export interface PrimitiveDescription {
  parts: PrimitivePart[]
  /** A real, open cavity, independent from the solid walls. */
  cavity?: { min: Vec3; max: Vec3 }
}
const cache = new Map<string, PrimitiveDescription>()
const geometryCache = new Map<string, BufferGeometry>()

export function describePrimitive(shape: PrimitiveShape | undefined, dims: ObjectDimensions, color = '#687681', sockets = 4): PrimitiveDescription {
  const { width: w, height: h, depth: d } = dims
  if (![w,h,d].every(v => Number.isFinite(v) && v > 0)) throw new Error('物品尺寸必须为有限正数')
  const key = JSON.stringify([shape,w,h,d,color,sockets])
  const cached = cache.get(key)
  if (cached) return cached
  const parts: PrimitivePart[] = []
  const add = (id: string, kind: PrimitivePart['kind'], size: Vec3, position: Vec3, tint: string, rotation: Vec3 = [0,0,0]) => {
    parts.push({ id, kind, size, position, rotation, color: tint })
  }
  const box = (id: string, size: Vec3, position: Vec3, tint = color, rotation?: Vec3) => add(id,'box',size,position,tint,rotation)
  const cyl = (id: string, size: Vec3, position: Vec3, tint = color, rotation?: Vec3) => add(id,'cylinder',size,position,tint,rotation)
  let cavity: PrimitiveDescription['cavity']
  switch (shape) {
    case 'monitor': {
      const b = h * .035, stem = h * .22, panel = h - b - stem
      box('base',[w*.36,b,d*.8],[0,b/2,d*.05],'#4A5560')
      box('stem',[w*.075,stem,d*.18],[0,b+stem/2,-d*.25],'#39424C')
      box('panel',[w,panel,Math.min(.022,d*.2)],[0,b+stem+panel/2,0],'#39424C')
      box('screen',[w*.94,panel*.88,.0005],[0,b+stem+panel/2,Math.min(.022,d*.2)/2-.00025],'#2E4A5A')
      break
    }
    case 'laptop': {
      const b = Math.min(.018,h*.12), t = Math.min(.014,d*.08), a = -.16
      const screen = Math.min((h-b)*.97, d*.85/Math.abs(Math.sin(a)))
      box('base',[w,b,d],[0,b/2,0],'#5A6470')
      // Tilt and thickness kept inside the declared depth/height.
      const z = -d/2+t/2 + Math.abs(Math.sin(a))*screen/2
      const y = b + Math.cos(a)*screen/2
      box('panel',[w,screen,t],[0,y,z],'#39424C',[a,0,0])
      box('screen',[w*.92,screen*.86,t*.04],[0,y,z+t*.48],'#2E4A5A',[a,0,0])
      break
    }
    case 'lamp': {
      cyl('base',[w*.9,h*.04,Math.min(w,d)*.9],[0,h*.02,0],'#3B444E')
      cyl('arm',[w*.10,h*.70,d*.08],[0,h*.39,-d*.07],'#53626B',[.08,0,0])
      cyl('head',[w*.72,h*.12,d*.68],[0,h*.88,0],'#3B444E',[.35,0,0])
      break
    }
    case 'storageBox': {
      const wall = Math.min(.006,w*.08,d*.08,h*.1)
      box('bottom',[w,wall,d],[0,wall/2,0],'#9DB4A8')
      box('left',[wall,h-wall,d],[-(w-wall)/2,(h+wall)/2,0],'#87A093')
      box('right',[wall,h-wall,d],[(w-wall)/2,(h+wall)/2,0],'#87A093')
      box('back',[w-wall*2,h-wall,wall],[0,(h+wall)/2,-(d-wall)/2],'#87A093')
      box('front',[w-wall*2,h-wall,wall],[0,(h+wall)/2,(d-wall)/2],'#87A093')
      cavity = { min:[-w/2+wall,wall,-d/2+wall], max:[w/2-wall,h,d/2-wall] }
      break
    }
    case 'cup': {
      // Cup contents are not an enabled storage region; handle opening remains free.
      const bodyW = w*.70
      cyl('body',[bodyW,h,d*.86],[-w*.1,h/2,0],'#E8E4DA')
      box('handle-top',[w*.25,h*.045,d*.10],[w*.275,h*.72,0],'#D9D4C8')
      box('handle-outer',[w*.06,h*.40,d*.10],[w*.43,h*.50,0],'#D9D4C8')
      box('handle-bottom',[w*.25,h*.045,d*.10],[w*.275,h*.28,0],'#D9D4C8')
      break
    }
    case 'thermos':
      cyl('body',[w*.94,h*.88,d*.94],[0,h*.44,0],'#678C8A')
      cyl('lid',[w,h*.12,d],[0,h*.94,0],'#303E45')
      break
    case 'mouse':
      add('body','ellipsoid',[w,h,d],[0,h/2,0],'#4F5A66')
      break
    case 'book': {
      const c = Math.min(.002,h*.12), tint = w>.22?'#638B94':w<.20?'#C5A062':'#B96A4B'
      box('pages',[w*.95,h-c*2,d*.94],[0,h/2,0],'#F1EBDD')
      box('bottom',[w,c,d],[0,c/2,0],tint)
      box('top',[w,c,d],[0,h-c/2,0],tint)
      box('spine',[c,h,d],[-w/2+c/2,h/2,0],tint)
      break
    }
    case 'books':
      ['#B96A4B','#8A99A8','#C9A06A'].forEach((tint,i)=>box(`book-${i}`,[w,h/3,d],[0,h*(i+.5)/3,0],tint))
      break
    case 'keyboard':
      box('body',[w,h,d],[0,h/2,0],'#525C66')
      box('keys',[w*.92,h*.12,d*.62],[0,h*.94,0],'#3B444E')
      break
    case 'printer':
      box('body',[w,h,d],[0,h/2,0],'#DCDDD8')
      box('lid',[w*.9,h*.12,d*.86],[0,h*.90,0],'#687681')
      box('slot',[w*.72,h*.18,d*.01],[0,h*.38,d*.495],'#303A43')
      box('paper',[w*.55,h*.025,d*.002],[0,h*.34,d*.499],'#F7F3EA')
      break
    case 'computerTower':
      box('body',[w,h,d],[0,h/2,0],'#39434E')
      box('front',[w*.86,h*.94,d*.02],[0,h/2,d*.49],'#252D35')
      for(let i=0;i<5;i++) box(`vent-${i}`,[w*.62,h*.018,d*.002],[0,h*.20+i*h*.065,d*.499],'#647887')
      box('button',[w*.06,h*.025,d*.002],[w*.22,h*.86,d*.499],'#70C5BA')
      break
    case 'powerAdapter':
      box('body',[w,h,d],[0,h/2,0],'#323B44')
      box('label',[w*.55,h*.01,d*.58],[0,h*.995,0],'#BFC8C9')
      box('port',[w*.01,h*.26,d*.32],[w*.495,h/2,0],'#111B23')
      break
    case 'powerStrip': {
      box('body',[w,h,d],[0,h/2,0],'#E5E2DA')
      const count=Math.max(1,Math.min(12,Math.round(sockets)))
      for(let i=0;i<count;i++) cyl(`socket-${i}`,[Math.min(.016,d*.45),h*.12,Math.min(.016,d*.45)],[(i-(count-1)/2)*Math.max(0,w-.06)/Math.max(1,count-1),h*.94,0],'#6B7280')
      break
    }
    default:
      box('body',[w,h,d],[0,h/2,0])
  }
  const result={parts,cavity}
  if(cache.size>=512) cache.delete(cache.keys().next().value!)
  cache.set(key,result)
  return result
}

/** Exact parameter cache: do not round thin geometry to millimetres. */
export function primitivePartGeometry(part: PrimitivePart): BufferGeometry {
  const key=JSON.stringify([part.kind,part.size])
  const cached=geometryCache.get(key)
  if(cached) return cached
  const [w,h,d]=part.size
  let geometry: BufferGeometry
  if(part.kind==='box') geometry=new BoxGeometry(w,h,d)
  else if(part.kind==='cylinder') {
    geometry=new CylinderGeometry(.5,.5,1,16,1,false)
    geometry.scale(w,h,d)
  } else {
    geometry=new SphereGeometry(.5,12,6)
    geometry.scale(w,h,d)
  }
  geometryCache.set(key,geometry)
  return geometry
}
