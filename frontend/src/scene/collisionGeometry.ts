import { Euler, Matrix4, Vector3 } from 'three'
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js'
import type { SceneObject, Vec3 } from '@/types/project'
import { describePrimitive, primitivePartGeometry } from './primitiveGeometry'

export const COLLISION_EPSILON=1e-7
export interface ConvexPart { vertices_m:Vec3[]; faces:[number,number,number][] }
export interface CompoundCollision { type:'compound'; parts:ConvexPart[] }
export interface Bounds { min:Vec3; max:Vec3 }
interface Solid extends ConvexPart { normals:Vec3[]; edges:Vec3[]; bounds:Bounds }
export interface ObjectCollision { parts:Solid[]; bounds:Bounds }
const localCache=new Map<string,ObjectCollision>()
const worldCache=new WeakMap<SceneObject,{key:string; value:ObjectCollision}>()
const vec=(p:Vec3)=>new Vector3(...p)
const tuple=(v:Vector3):Vec3=>[v.x,v.y,v.z]
function uniqueAxes(values:Vec3[]):Vec3[] {
  const result:Vec3[]=[]
  for(const value of values) {
    const v=vec(value)
    if(v.lengthSq()<1e-20) continue
    v.normalize()
    if(!result.some(a=>Math.abs(vec(a).dot(v))>1-1e-9)) result.push(tuple(v))
  }
  return result
}
export function boundsOf(vertices:Vec3[]):Bounds {
  return {min:[0,1,2].map(i=>Math.min(...vertices.map(v=>v[i]))) as Vec3,
    max:[0,1,2].map(i=>Math.max(...vertices.map(v=>v[i]))) as Vec3}
}
function solid(part:ConvexPart):Solid {
  const normals:Vec3[]=[], edges:Vec3[]=[]
  for(const [i,j,k] of part.faces) {
    const a=vec(part.vertices_m[i]),b=vec(part.vertices_m[j]),c=vec(part.vertices_m[k])
    normals.push(tuple(b.clone().sub(a).cross(c.clone().sub(a))))
    edges.push(tuple(b.clone().sub(a)),tuple(c.clone().sub(b)),tuple(a.clone().sub(c)))
  }
  return {...part,normals:uniqueAxes(normals),edges:uniqueAxes(edges),bounds:boundsOf(part.vertices_m)}
}
export function localCollision(object:SceneObject):ObjectCollision {
  const key=JSON.stringify([object.model.shape,object.dimensions,object.powerStrip?.socketCount])
  const cached=localCache.get(key)
  if(cached) return cached
  const description=describePrimitive(object.model.shape,object.dimensions,undefined,object.powerStrip?.socketCount)
  const parts=description.parts.map(part=>{
    const geometry=primitivePartGeometry(part)
    const attr=geometry.getAttribute('position')
    const matrix=new Matrix4().makeRotationFromEuler(new Euler(...part.rotation))
    matrix.setPosition(...part.position)
    const points:Vector3[]=[]
    for(let i=0;i<attr.count;i++) points.push(new Vector3().fromBufferAttribute(attr,i).applyMatrix4(matrix))
    const hull=new ConvexHull().setFromPoints(points)
    const vertices:Vec3[]=[], faces:[number,number,number][]=[]
    const indices=new Map<Vector3,number>()
    for(const face of hull.faces) {
      const faceIds:number[]=[]
      let edge=face.edge
      do {
        const p=edge.head().point
        if(!indices.has(p)) {indices.set(p,vertices.length);vertices.push(tuple(p))}
        faceIds.push(indices.get(p)!)
        edge=edge.next
      } while(edge!==face.edge)
      for(let i=1;i<faceIds.length-1;i++) faces.push([faceIds[0],faceIds[i],faceIds[i+1]])
    }
    return solid({vertices_m:vertices,faces})
  })
  // Dropping a part fully contained in a box is exact, not a shape approximation.
  const filtered=parts.filter((p,i)=>!description.parts.some((q,j)=>j!==i && q.kind==='box' && q.rotation.every(a=>a===0) &&
    p.vertices_m.every(v=>v.every((x,k)=>Math.abs(x-q.position[k])<=q.size[k]/2+1e-9)) &&
    (q.size.reduce((a,b)=>a*b,1)>description.parts[i].size.reduce((a,b)=>a*b,1))))
  const result={parts:filtered,bounds:boundsOf(filtered.flatMap(p=>p.vertices_m))}
  if(localCache.size>=512) localCache.delete(localCache.keys().next().value!)
  localCache.set(key,result)
  return result
}
export function exportCollision(object:SceneObject):CompoundCollision {
  return {type:'compound',parts:localCollision(object).parts.map(p=>({vertices_m:p.vertices_m.map(v=>[...v] as Vec3),faces:p.faces.map(f=>[...f])}))}
}
export function worldCollision(object:SceneObject,position:Vec3=object.transform.position):ObjectCollision {
  const key=JSON.stringify([position,object.transform.rotationY,object.dimensions,object.model.shape,object.powerStrip?.socketCount])
  const cached=worldCache.get(object)
  if(cached?.key===key) return cached.value
  const angle=object.transform.rotationY,c=Math.cos(angle),s=Math.sin(angle)
  const rotate=(v:Vec3):Vec3=>[c*v[0]+s*v[2],v[1],-s*v[0]+c*v[2]]
  const parts=localCollision(object).parts.map(p=>({...p,
    vertices_m:p.vertices_m.map(v=>{const r=rotate(v);return r.map((x,i)=>x+position[i]) as Vec3}),
    normals:p.normals.map(rotate),edges:p.edges.map(rotate),
  })).map(p=>({...p,bounds:boundsOf(p.vertices_m)}))
  const value={parts,bounds:boundsOf(parts.flatMap(p=>p.vertices_m))}
  worldCache.set(object,{key,value})
  return value
}
function boundsOverlap(a:Bounds,b:Bounds):boolean {
  return [0,1,2].every(i=>Math.min(a.max[i],b.max[i])-Math.max(a.min[i],b.min[i])>COLLISION_EPSILON)
}
function solidsOverlap(a:Solid,b:Solid):boolean {
  if(!boundsOverlap(a.bounds,b.bounds)) return false
  const separated=(axis:Vec3)=>{
    const n=vec(axis), len=n.length()
    if(len<1e-10) return false
    n.multiplyScalar(1/len)
    const ap=a.vertices_m.map(v=>vec(v).dot(n)),bp=b.vertices_m.map(v=>vec(v).dot(n))
    return Math.min(Math.max(...ap),Math.max(...bp))-Math.max(Math.min(...ap),Math.min(...bp))<=COLLISION_EPSILON
  }
  if([...a.normals,...b.normals].some(separated)) return false
  for(const ea of a.edges) for(const eb of b.edges) if(separated(tuple(vec(ea).cross(vec(eb))))) return false
  return true
}
export function collisionsOverlap(a:ObjectCollision,b:ObjectCollision):boolean {
  return boundsOverlap(a.bounds,b.bounds) && a.parts.some(pa=>b.parts.some(pb=>solidsOverlap(pa,pb)))
}
export function objectsCollide(a:SceneObject,aPos:Vec3,b:SceneObject,bPos:Vec3):boolean {
  return collisionsOverlap(worldCollision(a,aPos),worldCollision(b,bPos))
}
export function worldToObject(point:Vec3,object:SceneObject,position=object.transform.position):Vec3 {
  const [x,y,z]=point.map((v,i)=>v-position[i]),a=object.transform.rotationY
  return [Math.cos(a)*x-Math.sin(a)*z,y,Math.sin(a)*x+Math.cos(a)*z]
}
export function objectToWorld(point:Vec3,object:SceneObject,position=object.transform.position):Vec3 {
  const a=object.transform.rotationY
  return [Math.cos(a)*point[0]+Math.sin(a)*point[2]+position[0],point[1]+position[1],-Math.sin(a)*point[0]+Math.cos(a)*point[2]+position[2]]
}
export function containedInCavity(inner:SceneObject,innerPos:Vec3,outer:SceneObject,outerPos:Vec3):boolean {
  const cavity=describePrimitive(outer.model.shape,outer.dimensions).cavity
  if(!cavity) return false
  return worldCollision(inner,innerPos).parts.every(p=>p.vertices_m.every(v=>{
    const local=worldToObject(v,outer,outerPos)
    return local.every((x,i)=>x>=cavity.min[i]-COLLISION_EPSILON && x<=cavity.max[i]+COLLISION_EPSILON)
  }))
}
/** Convex face halfspaces; inflated planes conservatively include cable radius/clearance. */
export function segmentHitsObject(start:Vec3,end:Vec3,object:SceneObject,inflate=0):boolean {
  const a=worldToObject(start,object),b=worldToObject(end,object)
  return localCollision(object).parts.some(p=>{
    let lo=0,hi=1
    for(const [i,j,k] of p.faces) {
      const v=vec(p.vertices_m[i]),n=vec(p.vertices_m[j]).sub(v).cross(vec(p.vertices_m[k]).sub(v)).normalize()
      const da=n.dot(vec(a).sub(v))-inflate, db=n.dot(vec(b).sub(v))-inflate
      if(da>0 && db>0) return false
      if(da<=0 && db<=0) continue
      const t=da/(da-db)
      if(da>0) lo=Math.max(lo,t);else hi=Math.min(hi,t)
      if(lo>hi) return false
    }
    return true
  })
}
/** Bottom contact samples, not the full object's visual envelope. */
export function bottomContacts(object:SceneObject,position=object.transform.position):Vec3[] {
  const body=worldCollision(object,position),bottom=body.bounds.min[1]
  const lowest=body.parts.filter(p=>p.bounds.min[1]<=bottom+COLLISION_EPSILON)
  return lowest.flatMap(p=>{
    const contact=p.vertices_m.filter(v=>v[1]<=bottom+COLLISION_EPSILON)
    return contact.length>=3?contact:p.vertices_m.map(v=>[v[0],bottom,v[2]] as Vec3)
  })
}
