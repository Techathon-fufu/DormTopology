import { expect, test, type Page } from '@playwright/test'
import * as THREE from 'three'

// Software WebGL and concurrent development can delay navigation and context cleanup.
test.setTimeout(120_000)

async function moduleUrl(page: Page, path: string) {
  return page.evaluate((path) => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).findLast((url) => new URL(url).pathname === path)
    if (!url) throw new Error(`Missing loaded module: ${path}`)
    return url
  }, path)
}

async function setup(page: Page) {
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const projectsUrl = await moduleUrl(page, '/src/state/projectsStore.ts')
  const workspaceUrl = await moduleUrl(page, '/src/state/workspaceStore.ts')
  const id = `resize-${crypto.randomUUID()}`
  await page.evaluate(async ({ projectsUrl, id }) => {
    const { useProjectsStore } = await import(projectsUrl)
    const p = structuredClone(useProjectsStore.getState().projects['demo-dorm-101'])
    p.id = id
    p.name = '模型缩放验收'
    p.room.furnitureModel = undefined
    p.room.desk = { width: 1.6, depth: .8, height: .75, thickness: .025 }
    p.room.shelf.enabled = false
    p.cables = []
    p.objects = [{ ...p.objects[0], projectId: id, id: 'resize-item', name: '笔记本缩放',
      dimensions: { width: .35, height: .228, depth: .346 },
      transform: { position: [-.1, .75, .4], rotationY: Math.PI / 4 },
      fixed: false, locked: false, visible: true,
      ports: [{ id: 'resize-port', type: 'usb-c', powered: false, confirmed: true, offset: [.1, .03, -.04] }],
    }]
    useProjectsStore.getState().upsert(p)
  }, { projectsUrl, id })
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  await page.evaluate(async (workspaceUrl) => {
    const { useWorkspaceStore } = await import(workspaceUrl)
    const s = useWorkspaceStore.getState()
    s.setMode('organize')
    s.setViewPreset('top')
    s.select('resize-item')
  }, workspaceUrl)
  const snapshot = () => page.evaluate(async ({ projectsUrl, workspaceUrl, id }) => {
    const { useProjectsStore } = await import(projectsUrl)
    const { useWorkspaceStore } = await import(workspaceUrl)
    return { object: useProjectsStore.getState().projects[id].objects[0], past: useWorkspaceStore.getState().past.length }
  }, { projectsUrl, workspaceUrl, id })
  return { id, snapshot, projectsUrl, workspaceUrl }
}

async function corner(page: Page) {
  const box = (await page.locator('canvas').boundingBox())!
  const target = new THREE.Vector3(0, .75, .45)
  const distanceScale = Math.max(1, 1.1 / (box.width / box.height))
  const camera = new THREE.PerspectiveCamera(42, box.width / box.height, .1, 100)
  camera.position.copy(new THREE.Vector3(0, 2.7, .46).sub(target).multiplyScalar(distanceScale).add(target))
  camera.lookAt(target)
  camera.updateMatrixWorld()
  const project = (v: THREE.Vector3) => {
    const p = v.project(camera)
    return { x: box.x + (p.x + 1) * box.width / 2, y: box.y + (1 - p.y) * box.height / 2 }
  }
  const base = new THREE.Vector3(-.1, .75, .4)
  const point = project(new THREE.Vector3(.175, .228, .173).applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4).add(base))
  const origin = project(base)
  return { point, dx: point.x - origin.x, dy: point.y - origin.y }
}

test('Ctrl corners preview real prefab size and commit once with undo and redo', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile'), 'Ctrl resize uses a physical keyboard; mobile viewing is covered separately.')
  const failures: string[] = []
  page.on('pageerror', (e) => failures.push(e.message))
  const { snapshot } = await setup(page)
  const before = await snapshot()
  await page.keyboard.down('Control')
  await expect(page.getByTestId('object-resize-hint')).toBeVisible()
  const { point, dx, dy } = await corner(page)
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await expect(page.getByTestId('object-resize-panel')).toBeVisible()
  await page.mouse.move(point.x + dx * .3, point.y + dy * .3, { steps: 8 })
  await expect(page.getByTestId('object-resize-panel')).toContainText('mm')
  expect((await snapshot()).object).toEqual(before.object)
  expect((await snapshot()).past).toBe(before.past)
  await page.screenshot({ path: info.outputPath('ctrl-resize-during-drag.png') })
  // Releasing Ctrl mid-gesture must still allow mouseup to finish and close the panel.
  await page.keyboard.up('Control')
  await expect(page.getByTestId('object-resize-panel')).toBeVisible()
  await page.mouse.up()
  await expect(page.getByTestId('object-resize-panel')).toHaveCount(0)
  const after = await snapshot()
  const scale = after.object.dimensions.width / before.object.dimensions.width
  expect(scale).toBeCloseTo(1.3, 1)
  expect(after.object.dimensions.height / before.object.dimensions.height).toBeCloseTo(scale, 6)
  expect(after.object.dimensions.depth / before.object.dimensions.depth).toBeCloseTo(scale, 6)
  expect(after.object.transform).toEqual(before.object.transform)
  expect(after.object.model).toEqual(before.object.model)
  expect(after.object.ports[0].offset[0]).toBeCloseTo(before.object.ports[0].offset[0] * scale, 6)
  expect(after.object.ports[0].confirmed).toBe(false)
  expect(after.past).toBe(before.past + 1)
  await page.keyboard.press('Control+z')
  expect((await snapshot()).object).toEqual(before.object)
  await page.keyboard.press('Control+Shift+z')
  expect((await snapshot()).object).toEqual(after.object)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  expect((await snapshot()).object.dimensions).toEqual(after.object.dimensions)
  expect(failures).toEqual([])
})

test('Escape, pointer cancellation and focus loss discard resize without history', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile'), 'Keyboard resize is a desktop interaction.')
  const { snapshot, workspaceUrl } = await setup(page)
  const before = await snapshot()
  for (const cancel of ['Escape', 'pointercancel', 'blur']) {
    await page.evaluate(async (url) => {
      const { useWorkspaceStore } = await import(url)
      useWorkspaceStore.getState().select('resize-item')
    }, workspaceUrl)
    await page.keyboard.down('Control')
    await expect(page.getByTestId('object-resize-hint')).toBeVisible()
    const { point, dx, dy } = await corner(page)
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    await expect(page.getByTestId('object-resize-panel')).toBeVisible()
    await page.mouse.move(point.x + dx * .2, point.y + dy * .2, { steps: 4 })
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 999 })))
    await expect(page.getByTestId('object-resize-panel')).toBeVisible()
    if (cancel === 'Escape') await page.keyboard.press('Escape')
    else await page.evaluate((cancel) => {
      window.dispatchEvent(cancel === 'blur' ? new Event('blur') : new PointerEvent('pointercancel', { pointerId: 1 }))
    }, cancel)
    await expect(page.getByTestId('object-resize-panel')).toHaveCount(0)
    await page.mouse.up()
    await page.keyboard.up('Control')
    expect(await snapshot()).toEqual(before)
  }
})

test('mobile workspace remains viewable without Ctrl overlays', async ({ page }, info) => {
  test.skip(!info.project.name.includes('mobile'), 'Mobile viewing smoke check.')
  await setup(page)
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByTestId('object-resize-panel')).toHaveCount(0)
  await expect(page.getByTestId('object-resize-hint')).toHaveCount(0)
})

test('locked objects and cable or planning modes do not offer resize handles', async ({ page }, info) => {
  test.skip(info.project.name.includes('mobile'), 'Desktop keyboard guard checks.')
  const { id, projectsUrl, workspaceUrl, snapshot } = await setup(page)
  const before = await snapshot()
  await page.evaluate(async ({ id, projectsUrl }) => {
    const { useProjectsStore } = await import(projectsUrl)
    useProjectsStore.getState().update(id, (p: any) => ({ ...p, objects: p.objects.map((o: any) => ({ ...o, locked: true })) }))
  }, { id, projectsUrl })
  await page.keyboard.down('Control')
  await expect(page.getByTestId('object-resize-hint')).toHaveCount(0)
  await page.keyboard.up('Control')
  await page.evaluate(async ({ id, projectsUrl, workspaceUrl }) => {
    const { useProjectsStore } = await import(projectsUrl)
    const { useWorkspaceStore } = await import(workspaceUrl)
    useProjectsStore.getState().update(id, (p: any) => ({ ...p, objects: p.objects.map((o: any) => ({ ...o, locked: false })) }))
    useWorkspaceStore.getState().setMode('cable')
  }, { id, projectsUrl, workspaceUrl })
  await page.keyboard.down('Control')
  await expect(page.getByTestId('object-resize-hint')).toHaveCount(0)
  await page.keyboard.up('Control')
  const organizeUrl = await moduleUrl(page, '/src/state/organizeStore.ts')
  await page.evaluate(async ({ workspaceUrl, organizeUrl }) => {
    const { useWorkspaceStore } = await import(workspaceUrl)
    const { useOrganizeStore } = await import(organizeUrl)
    useWorkspaceStore.getState().setMode('organize')
    useOrganizeStore.getState().setStatus('planning')
  }, { workspaceUrl, organizeUrl })
  await page.keyboard.down('Control')
  await expect(page.getByTestId('object-resize-hint')).toHaveCount(0)
  await expect(page.getByTestId('object-resize-panel')).toHaveCount(0)
  await page.keyboard.up('Control')
  expect((await snapshot()).object.dimensions).toEqual(before.object.dimensions)
})
