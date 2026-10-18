import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.PLAYWRIGHT_REAL_ORGANIZATION !== '1', 'Requires the real Python packing backend.')
test.setTimeout(120_000)

async function moduleUrl(page: Page, path: string) {
  return page.evaluate((path) => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name).findLast((url) => new URL(url).pathname === path)
    if (!url) throw new Error(`Missing module: ${path}`)
    return url
  }, path)
}

test('real packing stands books, previews, applies, restores and preserves fixed books', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const projectsUrl = await moduleUrl(page, '/src/state/projectsStore.ts')
  const id = `book-regression-${crypto.randomUUID()}`
  await page.evaluate(async ({ projectsUrl, id }) => {
    const { useProjectsStore } = await import(projectsUrl)
    const project = structuredClone(useProjectsStore.getState().projects['demo-dorm-101'])
    project.id = id
    project.name = '书本立放验证'
    project.room.furnitureModel = undefined
    project.room.desk = { width: 1.6, depth: .8, height: .75, thickness: .025 }
    project.room.shelf = { enabled: true, levels: 1, heightAboveDesk: .38, depth: .25 }
    project.cables = []
    project.objects = [0, 1, 2, 3].map((index) => ({
      ...structuredClone(project.objects[0]), id: `book-${index}`, projectId: id, name: `书本 ${index + 1}`,
      dimensions: { width: .16, height: .025, depth: .2 },
      transform: { position: [index === 3 ? .6 : -.2 + index * .02, .75, index === 3 ? .7 : .42], rotationY: 0 },
      category: 'nonElectrical', model: { status: 'placeholder', source: 'demo', shape: 'book' },
      ports: [], source: 'manual', frequent: false, fixed: index === 3, locked: false, visible: true,
    }))
    useProjectsStore.getState().upsert(project)
  }, { projectsUrl, id })
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  const organizeUrl = await moduleUrl(page, '/src/state/organizeStore.ts')
  const snapshot = () => page.evaluate(async ({ projectsUrl, organizeUrl, id }) => {
    const { useProjectsStore } = await import(projectsUrl)
    const { useOrganizeStore } = await import(organizeUrl)
    return { objects: useProjectsStore.getState().projects[id].objects, plan: useOrganizeStore.getState().plan,
      overrides: useOrganizeStore.getState().overrides }
  }, { projectsUrl, organizeUrl, id })
  const original = (await snapshot()).objects
  await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  await page.getByRole('checkbox', { name: '我已核对物品尺寸及整理前位置' }).check()
  await page.getByRole('button', { name: '生成整理方案', exact: true }).last().click()
  await expect.poll(async () => (await snapshot()).plan?.serviceMeta?.source, { timeout: 60_000 }).toBe('real')
  const preview = await snapshot()
  expect(preview.plan.serviceMeta.applicable).toBe(true)
  expect(preview.objects).toEqual(original)
  for (const object of original.slice(0, 3)) {
    expect(preview.overrides[object.id].bookPose).toBe('upright')
    expect(preview.overrides[object.id].position[1]).toBeGreaterThan(.75)
  }
  await expect(page.getByRole('button', { name: '接受方案', exact: true })).toBeEnabled()
  const appliedResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/jobs/${preview.plan.serviceMeta.jobId}/apply`), { timeout: 20_000 })
  await page.screenshot({ path: info.outputPath('books-upright-preview.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '接受方案', exact: true }).click()
  expect((await appliedResponse).status()).toBe(200)
  await expect.poll(async () => (await snapshot()).objects[0].transform.bookPose).toBe('upright')
  const applied = (await snapshot()).objects
  for (const object of applied.slice(0, 3)) expect(object.dimensions).toEqual(original[0].dimensions)
  const collisionUrl = await moduleUrl(page, '/src/scene/collisionGeometry.ts')
  const extents = await page.evaluate(async ({ collisionUrl, applied }) => {
    const { worldCollision } = await import(collisionUrl)
    return applied.slice(0, 3).map((object: Parameters<typeof worldCollision>[0]) => {
      const { min, max } = worldCollision(object).bounds
      return max.map((value: number, axis: number) => value - min[axis])
    })
  }, { collisionUrl, applied })
  for (const extent of extents) {
    expect(extent[1]).toBeCloseTo(.2)
    expect(Math.min(extent[0], extent[2])).toBeCloseTo(.025)
  }
  const portsUrl = await moduleUrl(page, '/src/scene/ports.ts')
  const markingUrl = await moduleUrl(page, '/src/features/connections/model.ts')
  const hit = await page.evaluate(async ({ portsUrl, markingUrl, applied }) => {
    const { portWorldPosition, portWorldDirection } = await import(portsUrl)
    const { surfaceHit } = await import(markingUrl)
    const port = { id: 'book-point', type: 'usb-c', label: '测试', offset: [0, 0, -.1], localDirection: [0, 0, -1] }
    return surfaceHit(applied[0], portWorldPosition(applied[0], port), portWorldDirection(applied[0], port))
  }, { portsUrl, markingUrl, applied })
  expect(hit.offset[2]).toBeCloseTo(-.1)
  expect(hit.localDirection[2]).toBeCloseTo(-1)
  expect(applied[3].transform.bookPose ?? 'original').toBe('original')
  expect(applied[3].transform.position).toEqual(original[3].transform.position)
  const canonical = await (await page.request.get(`/api/v1/projects/${id}/scene`)).json()
  expect(canonical.items.slice(0, 3).every((item: { book_pose: string }) => item.book_pose === 'upright')).toBe(true)
  const workspaceUrl = await moduleUrl(page, '/src/state/workspaceStore.ts')
  await page.evaluate(async ({ workspaceUrl, id }) => {
    const { useWorkspaceStore } = await import(workspaceUrl)
    useWorkspaceStore.getState().undo(id)
  }, { workspaceUrl, id })
  expect((await snapshot()).objects).toEqual(original)
  await page.evaluate(async ({ workspaceUrl, id }) => {
    const { useWorkspaceStore } = await import(workspaceUrl)
    useWorkspaceStore.getState().redo(id)
  }, { workspaceUrl, id })
  expect((await snapshot()).objects).toEqual(applied)
  await page.screenshot({ path: info.outputPath('books-upright-applied.png'), animations: 'disabled' })
  expect(errors).toEqual([])
})
