import { expect, test, type Page } from '@playwright/test'
import type { LayoutPlan, Project } from '../src/types/project'

test.skip(process.env.PLAYWRIGHT_REAL_ORGANIZATION !== '1', 'Requires a running Python backend and VITE_ORGANIZATION_API_MODE=real.')
test.setTimeout(90_000)

async function moduleUrl(page: Page, path: string) {
  return page.evaluate((pathname) => {
    const resource = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === pathname).at(-1)
    if (!resource) throw new Error(`Module not loaded: ${pathname}`)
    return resource
  }, path)
}

async function readProject(page: Page, id: string): Promise<Project> {
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  return page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    return useProjectsStore.getState().projects[id]
  }, { url, id })
}

async function readBaseline(page: Page, id: string): Promise<LayoutPlan | undefined> {
  const url = await moduleUrl(page, '/src/state/plansStore.ts')
  return page.evaluate(async ({ url, id }) => {
    const { usePlansStore } = await import(url)
    return usePlansStore.getState().baselines[id]
  }, { url, id })
}

async function readPlan(page: Page) {
  const url = await moduleUrl(page, '/src/state/organizeStore.ts')
  return page.evaluate(async (url) => {
    const { useOrganizeStore } = await import(url)
    return useOrganizeStore.getState().plan
  }, url)
}

async function createIsolatedProject(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  const id = `scene-sync-${crypto.randomUUID()}`
  await page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    const source = useProjectsStore.getState().projects['demo-dorm-101']
    const project = structuredClone(source)
    project.id = id
    project.name = 'Scene sync regression'
    project.isDemo = false
    project.source = 'user'
    project.createdAt = Date.now()
    project.stage = 'organize'
    delete project.demoSeedVersion
    delete project.lastAppliedPlan
    project.objects = [-0.2, -0.16, 0.55].map((x, index) => ({
      ...structuredClone(source.objects[0]),
      id: `${id}-item-${index}`, projectId: id, name: `Box ${index + 1}`,
      dimensions: { width: 0.12, height: 0.12, depth: 0.12 },
      transform: { position: [x, project.room.desk.height, index === 2 ? 0.7 : 0.42], rotationY: 0 },
      category: 'nonElectrical', model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
      ports: [], source: 'manual', needsPower: false, frequent: false, fixed: index === 2, locked: false, visible: true,
    }))
    const from = project.objects[0]
    const to = project.objects[2]
    project.cables = [{
      id: `${id}-cable`, projectId: id, kind: 'data', status: 'existing', accessories: [],
      from: { objectId: from.id, position: [...from.transform.position] },
      to: { objectId: to.id, position: [...to.transform.position] },
      route: { channels: [], points: [[...from.transform.position], [...to.transform.position]] },
    }]
    useProjectsStore.getState().upsert(project)
  }, { url, id })
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(async () => (await readBaseline(page, id))?.projectId).toBe(id)
  return id
}

async function openAndConfirm(page: Page) {
  await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  const confirmation = page.getByRole('checkbox', { name: '我已核对物品尺寸及整理前位置' })
  await expect(confirmation).toBeVisible()
  await confirmation.check()
}

async function generate(page: Page) {
  await page.getByRole('button', { name: '生成整理方案', exact: true }).last().click()
  await expect.poll(async () => (await readPlan(page))?.serviceMeta?.source, { timeout: 30_000 }).toBe('real')
  const plan = await readPlan(page)
  expect(plan.serviceMeta.applicable).toBe(true)
  return plan
}

async function apply(page: Page, id: string) {
  const plan = await readPlan(page)
  if (!await page.getByRole('button', { name: '接受方案', exact: true }).isVisible()) {
    await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  }
  const applied = page.waitForResponse((response) => response.request().method() === 'POST'
    && response.url().endsWith(`/jobs/${plan.serviceMeta.jobId}/apply`))
  await page.getByRole('button', { name: '接受方案', exact: true }).click()
  const response = await applied
  expect(response.status()).toBe(200)
  await expect.poll(async () => (await readProject(page, id)).layoutSource).toBe('algorithm')
  await expect.poll(async () => await readPlan(page)).toBeNull()
  return response.json()
}

test('rebinds a missing local reference to the exact applied scene without another write', async ({ page }) => {
  const id = await createIsolatedProject(page)
  await openAndConfirm(page)
  await generate(page)
  const applied = await apply(page, id)
  expect(applied.scene_revision).toBeGreaterThan(1)
  const originalBaseline = await readBaseline(page, id)
  await page.evaluate((id) => {
    const keys = Object.keys(localStorage).filter((key) => key.startsWith('dormtopology.organization-scene:') && key.endsWith(`:${id}`))
    if (keys.length !== 1) throw new Error(`Expected one scene reference, found ${keys.length}`)
    localStorage.removeItem(keys[0])
  }, id)
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  expect(await readBaseline(page, id)).toEqual(originalBaseline)
  await openAndConfirm(page)
  const writes: number[] = []
  page.on('response', (response) => {
    if (response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1/projects/${id}/scene`) writes.push(response.status())
  })
  const rejectedCreation = page.waitForResponse((response) => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `/api/v1/projects/${id}/scene`)
  const rebound = await generate(page)
  expect((await rejectedCreation).status()).toBe(409)
  expect(writes).toEqual([409])
  expect(rebound.serviceMeta.sceneId).toBe(applied.scene_id)
  expect(rebound.serviceMeta.sceneRevision).toBe(applied.scene_revision)
  expect(rebound.serviceMeta.baselineId).toBe(applied.baseline_id)
  const saved = await page.request.get(`/api/v1/projects/${id}/scene`)
  expect(saved.status()).toBe(200)
  expect(await saved.json()).toEqual(applied)
  expect(await readBaseline(page, id)).toEqual(originalBaseline)
  await expect(page.getByRole('button', { name: '创建独立副本', exact: true })).toHaveCount(0)
})

test('keeps conflicting scene data and continues in an independently confirmed copy', async ({ page }, testInfo) => {
  const id = await createIsolatedProject(page)
  const original = await readProject(page, id)
  const originalBaseline = await readBaseline(page, id)
  const urls = {
    projects: await moduleUrl(page, '/src/state/projectsStore.ts'),
    plans: await moduleUrl(page, '/src/state/plansStore.ts'),
    packing: await moduleUrl(page, '/src/api/core/packingWire.ts'),
    preferences: await moduleUrl(page, '/src/types/organization.ts'),
  }
  const draft = await page.evaluate(async ({ urls, id }) => {
    const { useProjectsStore } = await import(urls.projects)
    const { usePlansStore } = await import(urls.plans)
    const { toPackingScene, packingBaseline } = await import(urls.packing)
    const { resolveOrganizationPreferences } = await import(urls.preferences)
    const project = useProjectsStore.getState().projects[id]
    const baseline = usePlansStore.getState().baselines[id]
    const input = { projectId: id, objects: project.objects, room: project.room, preferences: resolveOrganizationPreferences(project), confirmed: true }
    return { scene: toPackingScene(input), baseline: packingBaseline(baseline, input), baselineSourceId: baseline.id }
  }, { urls, id })
  const created = await page.request.put(`/api/v1/projects/${id}/scene`, {
    data: { scene: draft.scene, baseline: draft.baseline, expected_revision: null, baseline_source_id: `${draft.baselineSourceId}-other-client` },
  })
  expect(created.status()).toBe(200)
  const remote = await created.json()
  await openAndConfirm(page)
  await page.getByRole('button', { name: '生成整理方案', exact: true }).last().click()
  await expect(page.getByRole('alert')).toContainText('本地场景与后端保存的版本不一致')
  const duplicate = page.getByRole('button', { name: '创建独立副本', exact: true })
  await expect(duplicate).toBeVisible()
  await duplicate.scrollIntoViewIfNeeded()
  const screenshot = testInfo.outputPath('scene-conflict-recovery.png')
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('scene-conflict-recovery', { path: screenshot, contentType: 'image/png' })
  await duplicate.click()
  await expect(page).toHaveURL(/\/projects\/proj-[^/]+\/workspace$/)
  const copyId = new URL(page.url()).pathname.split('/')[2]
  await expect(page.getByRole('dialog', { name: '属性与方案面板' })).toBeHidden()
  expect(copyId).not.toBe(id)
  await expect.poll(async () => (await readBaseline(page, copyId))?.projectId).toBe(copyId)
  const copy = await readProject(page, copyId)
  expect(copy.isDemo).toBe(false)
  expect(copy.source).toBe('user')
  expect(copy.createdAt).toBeGreaterThanOrEqual(original.createdAt)
  expect(copy.updatedAt).toBeGreaterThanOrEqual(copy.createdAt)
  expect(copy.objects.map((object) => ({ ...object, projectId: id }))).toEqual(original.objects)
  expect(copy.cables).toHaveLength(1)
  expect(copy.cables.map((cable) => ({ ...cable, projectId: id }))).toEqual(original.cables)
  expect(copy.objects.every((object) => object.projectId === copyId)).toBe(true)
  expect(copy.cables.every((cable) => cable.projectId === copyId)).toBe(true)
  expect(await readProject(page, id)).toEqual(original)
  expect(await readBaseline(page, id)).toEqual(originalBaseline)
  const copyBaseline = await readBaseline(page, copyId)
  expect(copyBaseline?.id).not.toBe(originalBaseline?.id)
  expect(copyBaseline?.scene?.objects).toEqual(copy.objects)
  await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  const confirmation = page.getByRole('checkbox', { name: '我已核对物品尺寸及整理前位置' })
  await expect(confirmation).not.toBeChecked()
  await expect(page.getByRole('button', { name: '生成整理方案', exact: true }).last()).toBeDisabled()
  await confirmation.check()
  await generate(page)
  const copiedScene = await apply(page, copyId)
  expect(copiedScene.scene_id).not.toBe(remote.scene_id)
  expect(copiedScene.scene_revision).toBe(2)
  const savedOriginal = await page.request.get(`/api/v1/projects/${id}/scene`)
  expect(await savedOriginal.json()).toEqual(remote)
  expect(await readProject(page, id)).toEqual(original)
  expect(await readBaseline(page, id)).toEqual(originalBaseline)
})
