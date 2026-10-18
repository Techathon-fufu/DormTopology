import { bookTurned, bookPoseDimensions } from './bookPose'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { AnimationMixer } from 'three'
import type { PrimitiveShape, SceneObject } from '@/types/project'
import { resolvePublicAssetUrl } from './deskModel'
import { loadModelFromUrl } from './modelLoader'
import { PrimitiveModel } from './models'
import { prefabItemOf } from './prefabItems'
import { createPrefabInstance, normalizePrefabTemplate, removeDuplicatePrefabPrimitives, type PrefabTemplate } from './prefabModelGeometry'
import { preparePrefabAppearance } from './prefabAppearance'
import { batchStaticPrefab } from './batchPrefab'
import { repairPrefabWinding } from './meshWinding'
import { createPreviewUrl } from '@/state/storage/idb'

// Registry URLs are a fixed set. Templates own shared geometry and materials.
const templateCache = new Map<string, Promise<PrefabTemplate>>()
const WINDING_REPAIR_PREFABS = new Set(['mousepad', 'monitor', 'phone', 'cup', 'stainless_bottle'])

function useObjectAssetUrl(object: SceneObject): string | null {
  const directUrl = object.model.assetUrl ?? null
  const assetId = object.model.assetId
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    let createdUrl: string | undefined
    setLocalUrl(null)
    if (!assetId || directUrl || object.model.status !== 'ready') return () => { alive = false }
    void createPreviewUrl('modelFiles', assetId).then((url) => {
      createdUrl = url
      if (alive) setLocalUrl(url ?? null)
      else if (url) URL.revokeObjectURL(url)
    })
    return () => {
      alive = false
      if (createdUrl) URL.revokeObjectURL(createdUrl)
    }
  }, [assetId, directUrl, object.model.status])
  return directUrl ?? localUrl
}

function loadItemTemplate(url: string, sourceKey: string, appearanceId?: string, repairClosedShells = false): Promise<PrefabTemplate> {
  const cacheKey = `${appearanceId ?? 'import'}|${repairClosedShells ? 'repair' : 'authored'}|${sourceKey}`
  const cached = templateCache.get(cacheKey)
  if (cached) return cached
  const promise = loadModelFromUrl(url).then(({ scene, animations }) => {
    if (url.endsWith('/laptop_fold.glb')) removeDuplicatePrefabPrimitives(scene)
    if (repairClosedShells || (appearanceId && WINDING_REPAIR_PREFABS.has(appearanceId))) repairPrefabWinding(scene)
    if (appearanceId) preparePrefabAppearance(scene, appearanceId)
    if (appearanceId === 'keyboard' || appearanceId === 'mouse') batchStaticPrefab(scene)
    return normalizePrefabTemplate(scene, animations)
  })
  templateCache.set(cacheKey, promise)
  void promise.catch(() => templateCache.delete(cacheKey))
  return promise
}

export function PrefabItemModel({ url, sourceKey = url, fallback, dimensions, appearanceId, repairClosedShells = false }: {
  url: string
  /** Stable identity for blob-backed assets whose temporary URL changes per mount. */
  sourceKey?: string
  fallback: ReactNode
  dimensions: SceneObject['dimensions']
  appearanceId?: string
  repairClosedShells?: boolean
}) {
  const resolved = /^(?:https?:|blob:|data:)/i.test(url) || url.startsWith('/') ? url : resolvePublicAssetUrl(url)
  const [loaded, setLoaded] = useState<{ url: string; template: PrefabTemplate } | null>(null)
  useEffect(() => {
    let alive = true
    void loadItemTemplate(resolved, sourceKey, appearanceId, repairClosedShells).then((template) => {
      if (alive) setLoaded({ url: resolved, template })
    }).catch(() => {})
    return () => { alive = false }
  }, [resolved, sourceKey, appearanceId, repairClosedShells])
  const template = loaded?.url === resolved ? loaded.template : null
  const { width, height, depth } = dimensions
  const instance = useMemo(
    () => template ? createPrefabInstance(template, { width, height, depth }) : null,
    [template, width, height, depth],
  )
  const mixer = useMemo(() => instance && template?.animations.length ? new AnimationMixer(instance) : null, [instance, template])
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    if (!mixer || !template) return
    const actions = template.animations.map((clip) => mixer.clipAction(clip).play())
    invalidate()
    return () => {
      actions.forEach((action) => action.stop())
      mixer.stopAllAction()
      if (instance) mixer.uncacheRoot(instance)
    }
  }, [instance, invalidate, mixer, template])
  useFrame((_, delta) => {
    if (!mixer) return
    mixer.update(delta)
    invalidate()
  })
  if (!instance) return <>{fallback}</>
  return <primitive object={instance} dispose={null} />
}

/** Centered local geometry, matching PrimitiveModel and callers' half-height offset. */
export function ObjectModel({ object, shape, color, sockets }: {
  object: SceneObject
  shape?: PrimitiveShape
  color: string
  sockets?: number
}) {
  const def = prefabItemOf(object)
  const assetUrl = useObjectAssetUrl(object)
  const fallback = <PrimitiveModel shape={shape} dims={object.dimensions} color={color} sockets={sockets} backboard={object.powerStrip?.mount === 'backboard'} />
  const importedUrl = !def && object.model.status === 'ready' && assetUrl &&
    (object.model.format === 'glb' || object.model.format === 'gltf') ? assetUrl : null
  const model = def
    ? <PrefabItemModel url={def.url} sourceKey={`prefab:${def.id}`} appearanceId={def.id} dimensions={object.dimensions} fallback={fallback} />
    : importedUrl
      ? <PrefabItemModel url={importedUrl} sourceKey={object.model.assetId ? `asset:${object.model.assetId}` : importedUrl}
        repairClosedShells dimensions={object.dimensions} fallback={fallback} />
      : fallback
  if (!bookTurned(object)) return model
  return <group position={[0, (bookPoseDimensions(object).height - object.dimensions.height) / 2, 0]} rotation={[-Math.PI / 2, 0, 0]}>{model}</group>
}
