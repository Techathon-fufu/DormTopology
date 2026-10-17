import { expect, test } from '@playwright/test'
import * as THREE from 'three'

// 临时调试（用后删除）：经 fiber._roots 拿真实 scene / camera，查抽屉 pivot 与像素命中

const LEFT = { position: [-2.6, 1.3, 0.7] as const, target: [0, 0.9, 0.45] as const, fov: 42 }
const CLOSED = [0.619, 0.6175, 0.6705] as const
const OPEN = [0.319, 0.6175, 0.6705] as const

function project(box: { x: number; y: number; width: number; height: number }, point: readonly [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(LEFT.fov, box.width / box.height, 0.1, 200)
  camera.position.set(...LEFT.position)
  camera.lookAt(new THREE.Vector3(...LEFT.target))
  camera.updateMatrixWorld()
  const p = new THREE.Vector3(point[0], point[1], point[2]).project(camera)
  return { x: box.x + ((p.x + 1) / 2) * box.width, y: box.y + ((1 - p.y) / 2) * box.height }
}

test('debug drawer scene state', async ({ page }) => {
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)
        if (!url) return 0
        const mod = await import(url)
        return mod.useDrawerStore.getState().loadedIds.length
      }),
    )
    .toBe(3)

  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/workspaceStore.ts').at(-1)
    const mod = await import(url)
    mod.useWorkspaceStore.getState().setViewPreset('left')
  })
  await page.waitForTimeout(400)

  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)
    const mod = await import(url)
    mod.useDrawerStore.getState().toggle('top')
  })
  await page.waitForTimeout(700)
  const progress = await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)
    const mod = await import(url)
    return mod.useDrawerStore.getState().drawers
  })
  console.log('store drawers', JSON.stringify(progress))

  const box = (await page.locator('canvas').boundingBox())!
  const closedPx = project(box, CLOSED)
  const openPx = project(box, OPEN)

  const info = await page.evaluate(
    async ({ closedPx, openPx }) => {
      const names = performance.getEntriesByType('resource').map((e) => e.name)
      const fiberUrl = names.filter((n) => n.includes('@react-three_fiber')).at(-1)
      const threeUrl = names.filter((n) => new URL(n).pathname.endsWith('/node_modules/.vite/deps/three.js')).at(-1)
      if (!fiberUrl || !threeUrl) return { error: `modules not found: fiber=${!!fiberUrl} three=${!!threeUrl}` }
      const fiber = await import(fiberUrl)
      const THREE = await import(threeUrl)
      const roots = fiber._roots as Map<unknown, { getState?: () => any; store?: { getState: () => any } }>
      const out: Record<string, unknown> = { rootCount: roots.size, roots: [] as unknown[] }
      const list: unknown[] = []
      for (const [, root] of roots) {
        const state = root.getState ? root.getState() : root.store!.getState()
        const canvas = state.gl.domElement as HTMLCanvasElement
        const rect = canvas.getBoundingClientRect()
        const camera = state.camera
        const toNdc = (p: { x: number; y: number }) => ({
          x: ((p.x - rect.left) / rect.width) * 2 - 1,
          y: -((p.y - rect.top) / rect.height) * 2 + 1,
        })
        const cast = (p: { x: number; y: number }) => {
          state.raycaster.setFromCamera(toNdc(p), camera)
          return state.raycaster
            .intersectObject(state.scene, true)
            .slice(0, 5)
            .map((h: any) => ({ name: h.object.name || h.object.type, dist: +h.distance.toFixed(2), p: [+h.point.x.toFixed(3), +h.point.y.toFixed(3), +h.point.z.toFixed(3)] as number[] }))
        }
        const fronts: unknown[] = []
        state.scene.traverse((n: any) => {
          if (n.isMesh && n.name === 'front') {
            const wp = new THREE.Vector3()
            n.getWorldPosition(wp)
            const chain: string[] = []
            let o: any = n
            while (o && chain.length < 5) {
              chain.push(`${o.type}${o.name ? `:${o.name}` : ''}@(${o.position.x.toFixed(3)},${o.position.y.toFixed(3)},${o.position.z.toFixed(3)})`)
              o = o.parent
            }
            fronts.push({ world: [+wp.x.toFixed(3), +wp.y.toFixed(3), +wp.z.toFixed(3)], chain })
          }
        })
        list.push({
          canvas: [+rect.left, +rect.top, +rect.width, +rect.height],
          camera: [+camera.position.x.toFixed(3), +camera.position.y.toFixed(3), +camera.position.z.toFixed(3)],
          hitClosed: cast(closedPx),
          hitOpen: cast(openPx),
          fronts,
        })
      }
      out.roots = list
      return out
    },
    { closedPx, openPx },
  )
  console.log('scene debug', JSON.stringify(info, null, 1))
})
