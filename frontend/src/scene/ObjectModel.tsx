import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { PrimitiveShape, SceneObject } from '@/types/project'
import { resolvePublicAssetUrl } from './deskModel'
import { loadModelFromUrl } from './modelLoader'
import { PrimitiveModel } from './models'
import { prefabItemOf } from './prefabItems'
import { createPrefabInstance, normalizePrefabTemplate, type PrefabTemplate } from './prefabModelGeometry'

// Registry URLs are a fixed set. Templates own shared geometry and materials.
const templateCache = new Map<string, Promise<PrefabTemplate>>()

function loadPrefabTemplate(url: string): Promise<PrefabTemplate> {
  const cached = templateCache.get(url)
  if (cached) return cached
  const promise = loadModelFromUrl(url).then(({ scene }) => normalizePrefabTemplate(scene))
  templateCache.set(url, promise)
  void promise.catch(() => templateCache.delete(url))
  return promise
}

export function PrefabItemModel({ url, fallback, dimensions }: {
  url: string
  fallback: ReactNode
  dimensions: SceneObject['dimensions']
}) {
  const resolved = resolvePublicAssetUrl(url)
  const [loaded, setLoaded] = useState<{ url: string; template: PrefabTemplate } | null>(null)
  useEffect(() => {
    let alive = true
    void loadPrefabTemplate(resolved).then((template) => {
      if (alive) setLoaded({ url: resolved, template })
    }).catch(() => {})
    return () => { alive = false }
  }, [resolved])
  const template = loaded?.url === resolved ? loaded.template : null
  const { width, height, depth } = dimensions
  const instance = useMemo(
    () => template ? createPrefabInstance(template, { width, height, depth }) : null,
    [template, width, height, depth],
  )
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
  const fallback = <PrimitiveModel shape={shape} dims={object.dimensions} color={color} sockets={sockets} backboard={object.powerStrip?.mount === 'backboard'} />
  if (!def) return fallback
  return <PrefabItemModel url={def.url} dimensions={object.dimensions} fallback={fallback} />
}
