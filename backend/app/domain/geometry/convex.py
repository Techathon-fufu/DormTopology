"""Validated convex compound solids. Pure geometry, no vendor/runtime dependency."""
import math
from collections import Counter
from functools import lru_cache

TOLERANCE = 1e-7


def sub(a, b):
    return tuple(x-y for x, y in zip(a, b))


def dot(a, b):
    return sum(x*y for x, y in zip(a, b))


def cross(a, b):
    return (a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0])


def unit(a):
    norm = math.hypot(*a)
    return tuple(x/norm for x in a) if norm > 1e-12 else None


def rotate(v, angle):
    c, s = math.cos(angle), math.sin(angle)
    return (c*v[0]+s*v[2], v[1], -s*v[0]+c*v[2])


def validate_compound(collision):
    parts = collision.get('parts')
    if not isinstance(parts, list) or not 1 <= len(parts) <= 128:
        raise ValueError('compound needs 1..128 convex parts')
    for part in parts:
        if not isinstance(part, dict):
            raise ValueError('convex part must be an object')
        vertices, faces = part.get('vertices_m'), part.get('faces')
        if not isinstance(vertices, list) or not 4 <= len(vertices) <= 128:
            raise ValueError('convex part needs 4..128 vertices')
        if not isinstance(faces, list) or not 4 <= len(faces) <= 256:
            raise ValueError('convex part needs 4..256 triangle faces')
        for v in vertices:
            if not isinstance(v, list) or len(v) != 3 or any(isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) for x in v):
                raise ValueError('vertices_m must contain finite 3D coordinates')
        if len(set(map(tuple, vertices))) != len(vertices):
            raise ValueError('duplicate convex vertices')
        edges, directed, used = Counter(), Counter(), set()
        volume = 0.0
        for face in faces:
            if not isinstance(face, list) or len(face) != 3 or any(type(i) is not int or not 0 <= i < len(vertices) for i in face) or len(set(face)) != 3:
                raise ValueError('invalid triangle indices')
            i, j, k = face
            a, b, c = vertices[i], vertices[j], vertices[k]
            n = unit(cross(sub(b, a), sub(c, a)))
            if n is None:
                raise ValueError('degenerate convex face')
            if any(dot(n, sub(v, a)) > TOLERANCE for v in vertices):
                raise ValueError('part is non-convex or faces are not outward')
            volume += dot(a, cross(b, c))/6
            used.update(face)
            for x, y in ((i,j),(j,k),(k,i)):
                edges[tuple(sorted((x,y)))] += 1
                directed[(x,y)] += 1
        if used != set(range(len(vertices))) or any(count != 2 for count in edges.values()) or any(directed[(b,a)] != count for (a,b),count in directed.items()):
            raise ValueError('convex part must be a closed consistently oriented manifold')
        if not math.isfinite(volume) or volume <= 1e-15:
            raise ValueError('convex part must have positive finite volume')


def _axes(values):
    result = []
    for value in values:
        n = unit(value)
        if n and not any(abs(dot(n, p)) > 1-1e-9 for p in result):
            result.append(n)
    return tuple(result)


@lru_cache(maxsize=4096)
def prepare(vertices, faces):
    normals, edges = [], []
    for i,j,k in faces:
        a,b,c = vertices[i],vertices[j],vertices[k]
        normals.append(cross(sub(b,a), sub(c,a)))
        edges.extend((sub(b,a),sub(c,b),sub(a,c)))
    return vertices, _axes(normals), _axes(edges)


def local_parts(item):
    collision = item.get('collision', {'type':'box'})
    if collision['type'] == 'compound':
        return tuple(prepare(tuple(map(tuple,p['vertices_m'])),tuple(map(tuple,p['faces']))) for p in collision['parts'])
    w,h,d = item['size_m']
    vertices = tuple((x,y,z) for x in (-w/2,w/2) for y in (0,h) for z in (-d/2,d/2))
    return ((vertices,((1,0,0),(0,1,0),(0,0,1)),((1,0,0),(0,1,0),(0,0,1))),)


def world_parts(item):
    angle, position = item['rotation_y_rad'], item['position']
    return tuple((tuple(tuple(a+b for a,b in zip(rotate(v,angle),position)) for v in vertices),
                  tuple(rotate(n,angle) for n in normals),tuple(rotate(e,angle) for e in edges))
                 for vertices,normals,edges in local_parts(item))


def bounds(vertices):
    return tuple(min(v[i] for v in vertices) for i in range(3)), tuple(max(v[i] for v in vertices) for i in range(3))


def overlap(a, b):
    av,an,ae = a
    bv,bn,be = b
    amin,amax,bmin,bmax = *bounds(av),*bounds(bv)
    if any(min(amax[i],bmax[i])-max(amin[i],bmin[i]) <= TOLERANCE for i in range(3)):
        return False
    for axis in (*an,*bn,*(cross(x,y) for x in ae for y in be)):
        n = unit(axis)
        if n is None:
            continue
        pa,pb = [dot(v,n) for v in av],[dot(v,n) for v in bv]
        if min(max(pa),max(pb))-max(min(pa),min(pb)) <= TOLERANCE:
            return False
    return True


def items_overlap(a, b):
    return any(overlap(pa,pb) for pa in world_parts(a) for pb in world_parts(b))


@lru_cache(maxsize=4096)
def _support_slabs(vertices, normals):
    slabs = []
    for n in normals:
        projections = [dot(n,v) for v in vertices]
        slabs.append((n,min(projections),max(projections)))
    return tuple(slabs)


def segment_interval(start, direction, part, inflate=0.0):
    """Clip a line to both support planes of every face axis."""
    vertices,normals,_edges = part
    lo,hi = -math.inf,math.inf
    # SAT axes discard orientation; both sides must bound the line interval.
    for n,minimum,maximum in _support_slabs(vertices,normals):
        lower, upper = minimum-inflate, maximum+inflate
        origin, slope = dot(n,start), dot(n,direction)
        if abs(slope) < 1e-12:
            if origin < lower or origin > upper:
                return None
            continue
        near, far = (lower-origin)/slope, (upper-origin)/slope
        lo,hi = max(lo,min(near,far)), min(hi,max(near,far))
        if lo > hi:
            return None
    return lo,hi


def segment_hits(start, end, parts, inflate=0.0):
    for part in parts:
        interval = segment_interval(start,sub(end,start),part,inflate)
        if interval and interval[0] <= 1 and interval[1] >= 0:
            return True
    return False
