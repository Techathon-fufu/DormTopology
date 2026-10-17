import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.PLAYWRIGHT_REAL_ORGANIZATION !== '1', 'Requires a running Python backend and the Vite source development server.')

async function moduleUrl(page: Page, path: string) {
  return page.evaluate((pathname) => {
    const resource = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === pathname).at(-1)
    if (!resource) throw new Error(`Module not loaded: ${pathname}`)
    return resource
  }, path)
}

async function readProject(page: Page, id: string) {
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  return page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    return useProjectsStore.getState().projects[id]
  }, { url, id })
}

async function readPlan(page: Page) {
  const url = await moduleUrl(page, '/src/state/organizeStore.ts')
  return page.evaluate(async (url) => {
    const { useOrganizeStore } = await import(url)
    return useOrganizeStore.getState().plan
  }, url)
}

async function openConfirmedPreview(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  const id = `http-organization-${crypto.randomUUID()}`
  await page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    const source = useProjectsStore.getState().projects['demo-dorm-101']
    const project = structuredClone(source)
    project.id = id
    project.name = 'HTTP organization regression'
    project.room.furnitureModel = undefined
    project.room.desk = { width: 1.6, depth: .8, height: .75, thickness: .025 }
    project.room.shelf = { enabled: true, levels: 1, heightAboveDesk: .38, depth: .2 }
    project.cables = []
    project.objects = [-0.2, -0.16, 0.55].map((x, index) => ({
      ...structuredClone(source.objects[0]),
      id: `${id}-item-${index}`, projectId: id, name: `Box ${index + 1}`,
      dimensions: { width: 0.12, height: 0.12, depth: 0.12 },
      transform: { position: [x, project.room.desk.height, index === 2 ? 0.7 : 0.42], rotationY: 0 },
      category: 'nonElectrical', model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
      ports: [], source: 'manual', frequent: false, fixed: index === 2, locked: false, visible: true,
    }))
    useProjectsStore.getState().upsert(project)
  }, { url, id })
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  const original = await readProject(page, id)
  await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  const confirm = page.getByRole('checkbox', { name: '我已核对物品尺寸及整理前位置' })
  await expect(confirm).toBeVisible()
  await confirm.check()
  const synchronized = page.waitForResponse((response) => response.request().method() === 'PUT' && response.url().includes(`/projects/${id}/scene`))
  await page.getByRole('button', { name: '生成整理方案', exact: true }).last().click()
  const sync = await synchronized
  expect(sync.status()).toBe(200)
  const canonical = await sync.json()
  expect(canonical.scene_id).not.toBe(id)
  expect(canonical.scene_revision).toBe(1)
  expect(canonical.baseline_id).toBeTruthy()
  expect(canonical.items[0].position[0]).toBeCloseTo(original.objects[0].transform.position[0] + original.room.desk.width / 2)
  await expect.poll(async () => (await readPlan(page))?.serviceMeta?.source, { timeout: 30_000 }).toBe('real')
  const plan = await readPlan(page)
  expect(plan.serviceMeta.applicable).toBe(true)
  expect(plan.serviceMeta.algorithmVersion).toBeTruthy()
  expect((await readProject(page, id)).objects).toEqual(original.objects)
  // The mobile drawer closes after generation so the resulting scene stays visible.
  if (!await page.getByRole('button', { name: '接受方案', exact: true }).isVisible()) {
    await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  }
  await expect(page.getByRole('button', { name: '接受方案', exact: true })).toBeEnabled()
  return { id, original, plan, baselineSourceId: sync.request().postDataJSON().baseline_source_id }
}

test('previews Python packing and applies its exact version without moving fixed objects', async ({ page }, testInfo) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  const { id, original, plan } = await openConfirmedPreview(page)
  let release!: () => void
  let reached!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const requested = new Promise<void>((resolve) => { reached = resolve })
  await page.route(`**/jobs/${plan.serviceMeta.jobId}/apply`, async (route) => {
    const response = await route.fetch()
    reached()
    await held
    await route.fulfill({ response })
  })
  const applied = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/jobs/${plan.serviceMeta.jobId}/apply`))
  await page.getByRole('button', { name: '接受方案', exact: true }).click()
  await requested
  await expect(page.getByRole('button', { name: '正在应用…', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: '正在应用…', exact: true })).toBeVisible()
  release()
  const response = await applied
  expect(response.status()).toBe(200)
  const canonical = await response.json()
  expect(canonical.scene_revision).toBe(plan.serviceMeta.sceneRevision + 1)
  await expect.poll(async () => (await readProject(page, id)).layoutSource).toBe('algorithm')
  const current = await readProject(page, id)
  expect(current.objects[2].transform).toEqual(original.objects[2].transform)
  expect(current.objects[0].transform).not.toEqual(original.objects[0].transform)
  for (const object of current.objects) {
    const stored = canonical.items.find((item: { id: string }) => item.id === object.id)
    expect(stored.position[0]).toBeCloseTo(object.transform.position[0] + current.room.desk.width / 2)
    expect(stored.position[1]).toBeCloseTo(object.transform.position[1])
    expect(stored.position[2]).toBeCloseTo(object.transform.position[2] - 0.05)
    expect(stored.rotation_y_rad).toBeCloseTo(object.transform.rotationY)
  }
  const storedResponse = await page.request.get(`/api/v1/projects/${id}/scene`)
  expect(await storedResponse.json()).toEqual(canonical)
  await page.keyboard.press('Escape')
  const screenshot = testInfo.outputPath('real-organization-applied.png')
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('real-organization-applied', { path: screenshot, contentType: 'image/png' })
  expect(failures).toEqual([])
})

test('rejects a consumed result after a later backend edit without changing local objects', async ({ page }) => {
  const { id, original, plan, baselineSourceId } = await openConfirmedPreview(page)
  const externalApply = await page.request.post(`/api/v1/jobs/${plan.serviceMeta.jobId}/apply`, {
    data: { scene_id: plan.serviceMeta.sceneId, scene_revision: plan.serviceMeta.sceneRevision },
  })
  expect(externalApply.status()).toBe(200)
  const saved = await externalApply.json()
  saved.items[0].name = 'Edited by another client'
  const edited = await page.request.put(`/api/v1/projects/${id}/scene`, {
    data: { scene: saved, expected_revision: saved.scene_revision, baseline_source_id: baselineSourceId },
  })
  expect(edited.status()).toBe(200)
  expect((await edited.json()).scene_revision).toBe(plan.serviceMeta.sceneRevision + 2)
  const rejected = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/jobs/${plan.serviceMeta.jobId}/apply`))
  await page.getByRole('button', { name: '接受方案', exact: true }).click()
  expect((await rejected).status()).toBe(409)
  await expect(page.getByRole('alert')).toBeVisible()
  expect((await readProject(page, id)).objects).toEqual(original.objects)
})

test('centres the monitor, places the printer beside it and keeps ordinary objects above the floor', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  const id = `floor-policy-${crypto.randomUUID()}`
  await page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    const project = structuredClone(useProjectsStore.getState().projects['demo-dorm-101'])
    project.id = id
    project.name = 'Floor placement regression'
    project.cables = []
    project.objects.forEach((object: { projectId: string }) => { object.projectId = id })
    useProjectsStore.getState().upsert(project)
  }, { url, id })
  await page.goto(`/projects/${id}/workspace`)
  const original = await readProject(page, id)
  expect(original.objects).toHaveLength(14)
  await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  await page.getByRole('checkbox', { name: '我已核对物品尺寸及整理前位置' }).check()
  await page.getByRole('button', { name: '生成整理方案', exact: true }).last().click()
  await expect.poll(async () => (await readPlan(page))?.serviceMeta?.source, { timeout: 90_000 }).toBe('real')
  const plan = await readPlan(page)
  expect(plan.serviceMeta.status).toBe('success')
  expect(plan.serviceMeta.applicable).toBe(true)
  expect(plan.unplaced).toEqual([])
  expect(plan.assignments).toHaveLength(14)
  expect(new Set(plan.assignments.map((a: { objectId: string }) => a.objectId)).size).toBe(14)
  expect(plan.metrics.movableCount).toBe(13)
  expect(plan.metrics.placedCount).toBe(13)
  expect(plan.metrics.unplacedCount).toBe(0)
  expect(plan.metrics.overlapCount).toBe(0)
  expect(plan.metrics.outOfBoundsCount).toBe(0)
  expect(plan.serviceMeta.issues).toEqual([])
  const monitor = plan.assignments.find((assignment: { objectId: string }) => assignment.objectId === 'demo-monitor')
  expect(monitor.position[0]).toBeCloseTo(plan.preferences.typingOffsetX, 3)
  expect(monitor.rotationY).toBe(0)
  expect(monitor.reason).toContain('中央主视位')
  expect(plan.serviceMeta.warnings ?? []).not.toContainEqual(expect.stringContaining('显示器'))
  const printer = plan.assignments.find((assignment: { objectId: string }) => assignment.objectId === 'demo-printer')
  expect(printer.targetRegionId).toMatch(/^printer-side-/)
  expect(printer.rotationY).toBe(0)
  const screenWidth = original.objects.find((object: { id: string }) => object.id === 'demo-monitor').dimensions.width
  const printerWidth = original.objects.find((object: { id: string }) => object.id === 'demo-printer').dimensions.width
  expect(Math.abs(printer.position[0] - monitor.position[0])).toBeGreaterThan((screenWidth + printerWidth) / 2)
  expect((await readProject(page, id)).objects).toEqual(original.objects)
  for (const assignment of plan.assignments) {
    const object = original.objects.find((entry: { id: string }) => entry.id === assignment.objectId)
    if (object.fixed || object.locked) continue
    if (assignment.position[1] === 0) expect(object.model.shape).toBe('computerTower')
  }
  expect(plan.assignments.find((assignment: { objectId: string }) => assignment.objectId === 'demo-storage-box').zone).toBe('shelf')
  if (!await page.getByRole('button', { name: '接受方案', exact: true }).isVisible()) {
    await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  }
  const appliedResponse = page.waitForResponse((response) => response.request().method() === 'POST' && response.url().endsWith(`/jobs/${plan.serviceMeta.jobId}/apply`))
  await page.getByRole('button', { name: '接受方案', exact: true }).click()
  const response = await appliedResponse
  expect(response.status()).toBe(200)
  const canonical = await response.json()
  expect(canonical.scene_revision).toBe(plan.serviceMeta.sceneRevision + 1)
  await expect.poll(async () => (await readProject(page, id)).layoutSource).toBe('algorithm')
  const applied = await readProject(page, id)
  for (const object of applied.objects) {
    const before = original.objects.find((entry: { id: string }) => entry.id === object.id)
    expect(object.model).toEqual(before.model)
    expect(object.dimensions).toEqual(before.dimensions)
  }
  const appliedMonitor = applied.objects.find((object: { id: string }) => object.id === 'demo-monitor')
  expect(appliedMonitor.transform.position[0]).toBeCloseTo(plan.preferences.typingOffsetX, 3)
  expect(appliedMonitor.transform.rotationY).toBe(0)
  const appliedPrinter = applied.objects.find((object: { id: string }) => object.id === 'demo-printer')
  expect(appliedPrinter.transform.position).toEqual(printer.position)
  expect(appliedPrinter.transform.rotationY).toBe(0)
  const saved = await page.request.get(`/api/v1/projects/${id}/scene`)
  expect(saved.status()).toBe(200)
  const scene = await saved.json()
  expect(scene).toEqual(canonical)
  for (const object of applied.objects) {
    const assignment = plan.assignments.find((entry: { objectId: string }) => entry.objectId === object.id)
    expect(object.transform.position).toEqual(assignment.position)
    expect(object.transform.rotationY).toBe(assignment.rotationY)
    const stored = scene.items.find((item: { id: string }) => item.id === object.id)
    expect(stored.position[0]).toBeCloseTo(object.transform.position[0] + (applied.room.furnitureModel ? .45 : applied.room.desk.width / 2))
    expect(stored.position[1]).toBeCloseTo(object.transform.position[1])
    expect(stored.position[2]).toBeCloseTo(object.transform.position[2] - (applied.room.furnitureModel ? .042 : .05))
    expect(stored.rotation_y_rad).toBeCloseTo(object.transform.rotationY)
    if (!object.fixed && !object.locked && object.transform.position[1] === 0) expect(object.model.shape).toBe('computerTower')
  }
  await page.keyboard.press('Escape')
  const screenshot = testInfo.outputPath('devices-demo-applied.png')
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('devices-demo-applied', { path: screenshot, contentType: 'image/png' })
})
