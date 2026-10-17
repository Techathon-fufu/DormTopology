import { expect, test, type Page } from '@playwright/test'
import * as THREE from 'three'

// 临时探针（用后删除）：复现「拖物品到抽屉 → 消失」，打印落点归属

const VIEW = {
  position: [-1.05, 1.35, 1.95] as const,
  target: [0.55, 0.6, 0.7] as const,
  fov: 42,
}

function projectPoint(box: { x: number; y: number; width: number; height: number }, point: readonly [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(VIEW.fov, box.width / box.height, 0.1, 200)
  camera.position.set(...VIEW.position)
  camera.lookAt(new THREE.Vector3(...VIEW.target))
  camera.updateMatrixWorld()
  const p = new THREE.Vector3(point[0], point[1], point[2]).project(camera)
  return { x: box.x + ((p.x + 1) / 2) * box.width, y: box.y + ((1 - p.y) / 2) * box.height }
}

async function setCamera(page: Page, pos: readonly [number, number, number], look: readonly [number, number, number]) {
  await page.evaluate(
    async ({ pos, look }) => {
      const names = performance.getEntriesByType('resource').map((e) => e.name)
      const fiberUrl = names.filter((n) => n.includes('@react-three_fiber')).at(-1)!
      const fiber = await import(fiberUrl)
      const roots = fiber._roots as Map<unknown, { getState?: () => any; store?: { getState: () => any } }>
      for (const [, root] of roots) {
        const state = root.getState ? root.getState() : root.store!.getState()
        state.camera.position.set(pos[0], pos[1], pos[2])
        state.camera.lookAt(look[0], look[1], look[2])
        state.controls?.target?.set?.(look[0], look[1], look[2])
      }
    },
    { pos, look },
  )
  await page.waitForTimeout(250)
}

async function moduleAt(page: Page, pathname: string) {
  const url = await page.evaluate(
    (p) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === p).at(-1),
    pathname,
  )
  if (!url) throw new Error(`module not found: ${pathname}`)
  return url
}

async function readDrawerProgress(page: Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)!
    const mod = await import(url)
    const s = mod.useDrawerStore.getState()
    return { topTarget: s.drawers.top.target, topProgress: s.drawers.top.progress }
  })
}

async function readObjectPos(page: Page, objectId: string) {
  const url = await moduleAt(page, '/src/state/projectsStore.ts')
  return page.evaluate(
    async ({ url, objectId }) => {
      const mod = await import(url)
      const o = mod.useProjectsStore.getState().projects['demo-dorm-101'].objects.find((x: { id: string }) => x.id === objectId)
      return o ? { name: o.name, position: o.transform.position } : null
    },
    { url, objectId },
  )
}

async function readDragState(page: Page) {
  const url = await moduleAt(page, '/src/state/workspaceStore.ts')
  return page.evaluate(async (url) => {
    const mod = await import(url)
    const d = mod.useWorkspaceStore.getState().drag
    return d ? { objectId: d.objectId, position: d.position, support: d.support, valid: d.valid } : null
  }, url)
}

async function dragBetween(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 14) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps)
  }
  await page.waitForTimeout(120)
}

test('tmp: item dropped onto drawer - where does it land', async ({ page }) => {
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()

  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)
    if (!url) return
    const mod = await import(url)
    mod.useDrawerStore.getState()
  })
  await expect.poll(async () => (await readDrawerProgress(page)).topTarget).toBe(0)

  await setCamera(page, VIEW.position, VIEW.target)
  const box = (await page.locator('canvas').boundingBox())!

  // ── A：打开上层抽屉，把鼠标拖进抽屉
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)!
    const mod = await import(url)
    mod.useDrawerStore.getState().toggle('top')
  })
  await expect.poll(async () => (await readDrawerProgress(page)).topProgress).toBeGreaterThan(0.9)
  await page.waitForTimeout(300)

  const mouseBefore = await readObjectPos(page, 'demo-mouse')
  console.log('A| mouse before:', JSON.stringify(mouseBefore))
  const grabA = projectPoint(box, [0, 0.775, 0.49])
  const dropA = projectPoint(box, [0.47, 0.6, 0.67])
  console.log('A| grab px:', JSON.stringify(grabA), 'drop px:', JSON.stringify(dropA))

  await dragBetween(page, grabA, dropA)
  console.log('A| drag preview before release:', JSON.stringify(await readDragState(page)))
  await page.screenshot({ path: 'test-results/drop-A-before-release.png', scale: 'css' })
  await page.mouse.up()
  await page.waitForTimeout(200)
  console.log('A| mouse after:', JSON.stringify(await readObjectPos(page, 'demo-mouse')))
  await page.screenshot({ path: 'test-results/drop-A-after-release.png', scale: 'css' })

  // 关抽屉，看物品是否像用户说的「消失」
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)!
    const mod = await import(url)
    mod.useDrawerStore.getState().toggle('top')
  })
  await expect.poll(async () => (await readDrawerProgress(page)).topProgress).toBeLessThan(0.1)
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/drop-A-after-close.png', scale: 'css' })

  // ── B：关上抽屉，把电源适配器拖到抽屉正面
  const adaptBefore = await readObjectPos(page, 'demo-power-adapter')
  console.log('B| adapter before:', JSON.stringify(adaptBefore))
  const grabB = projectPoint(box, [-0.1, 0.7675, 0.34])
  const dropB = projectPoint(box, [0.619, 0.6175, 0.6705])
  console.log('B| grab px:', JSON.stringify(grabB), 'drop px:', JSON.stringify(dropB))

  await dragBetween(page, grabB, dropB)
  console.log('B| drag preview before release:', JSON.stringify(await readDragState(page)))
  await page.screenshot({ path: 'test-results/drop-B-before-release.png', scale: 'css' })
  await page.mouse.up()
  await page.waitForTimeout(200)
  console.log('B| adapter after:', JSON.stringify(await readObjectPos(page, 'demo-power-adapter')))
  await page.screenshot({ path: 'test-results/drop-B-after-release.png', scale: 'css' })
})
