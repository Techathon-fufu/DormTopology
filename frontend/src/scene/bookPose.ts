import type { BookPose, SceneObject, Vec3 } from '@/types/project'

export const isBook = (object: SceneObject) => object.model.shape === 'book' || object.model.shape === 'books'

export function bookPoseRotation(size: Vec3, pose: BookPose | undefined): number {
  const [, height, depth] = size
  return (pose === 'upright' ? height < depth : pose === 'flat' ? height >= depth : false) ? -Math.PI / 2 : 0
}

export function bookLocalPoint(size: Vec3, pose: BookPose | undefined, point: Vec3): Vec3 {
  const [, height, depth] = size
  return bookPoseRotation(size, pose) ? [point[0], point[2] + depth / 2, height / 2 - point[1]] : point
}

export function bookTurned(object: SceneObject): boolean {
  if (!isBook(object)) return false
  const { width, height, depth } = object.dimensions
  return bookPoseRotation([width, height, depth], object.transform.bookPose) !== 0
}

export function bookPosePoint(object: SceneObject, point: Vec3, inverse = false): Vec3 {
  if (!bookTurned(object)) return point
  const { depth, height } = object.dimensions
  const [x, y, z] = point
  return inverse ? [x, height / 2 - z, y - depth / 2] : [x, z + depth / 2, height / 2 - y]
}

export function bookPoseDirection(object: SceneObject, vector: Vec3, inverse = false): Vec3 {
  if (!bookTurned(object)) return vector
  const [x, y, z] = vector
  return inverse ? [x, -z, y] : [x, z, -y]
}

export function bookPoseDimensions(object: SceneObject) {
  const { width, height, depth } = object.dimensions
  return bookTurned(object) ? { width, height: depth, depth: height } : object.dimensions
}

export function validBookPose(value: unknown): value is BookPose {
  return value === 'original' || value === 'upright' || value === 'flat'
}
