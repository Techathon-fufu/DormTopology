import { expect, test, type Page, type TestInfo } from '@playwright/test'
import { itemSpacingViolations } from '../src/scene/itemSpacing'
import type { Project } from '../src/types/project'

test.skip(process.env.PLAYWRIGHT_REAL_ORGANIZATION !== '1', 'Requires the real Python backend and the Vite source development server.')
test.setTimeout(120_000)
test.use({ actionTimeout: 15_000 })

async function moduleUrl(page: Page, pathname: string) {
  return page.evaluate((pathname) => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === pathname).at(-1)
    if (!url) throw new Error(`Module not loaded: ${pathname}`)
    return url
  }, pathname)
}

async function readProject(page: Page, id: string): Promise<Project> {
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  return page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    return useProjectsStore.getState().projects[id]
  }, { url, id })
}

async function createProject(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  const id = `cable-management-${crypto.randomUUID()}`
  await page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    const source = useProjectsStore.getState().projects['demo-dorm-101']
    const project = structuredClone(source)
    project.id = id
    project.name = 'Cable management regression'
    project.isDemo = false
    project.source = 'user'
    delete project.demoSeedVersion
    delete project.lastAppliedPlan
    delete project.cableTrayAnalysis
    project.room = { ...project.room, furnitureModel: undefined,
      desk: { width: 1.6, depth: .8, height: .75, thickness: .025 },
      shelf: { enabled: false, levels: 1, heightAboveDesk: .38, depth: .2 },
      posts: [], cableHoles: [], cableManagement: undefined }
    project.objects = [-.55, -.15, .15, .55].map((x, index) => ({
      ...structuredClone(source.objects[0]),
      id: `${id}-box-${index}`, projectId: id, name: `Box ${index + 1}`,
      dimensions: { width: .08, height: .04, depth: .08 },
      transform: { position: [x, .75, .19], rotationY: 0 }, category: 'electrical',
      model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
      ports: [{ id: `${id}-port-${index}`, type: 'hdmi', powered: false,
        offset: [0, .02, -.04], direction: 'back', confirmed: true }],
      source: 'manual', needsPower: false, frequent: false, fixed: false, locked: false, visible: true,
    }))
    project.cables = [0, 2].map((start, index) => ({
      id: `${id}-cable-${index}`, projectId: id, kind: 'video', status: 'existing',
      visibility: 'hidden', thickness: 'thin', accessories: [], reserveLengthM: .1,
      from: { objectId: project.objects[start].id, portId: project.objects[start].ports[0].id,
        position: [project.objects[start].transform.position[0], .77, .15] },
      to: { objectId: project.objects[start + 1].id, portId: project.objects[start + 1].ports[0].id,
        position: [project.objects[start + 1].transform.position[0], .77, .15] },
      route: { channels: [], points: [[project.objects[start].transform.position[0], .77, .15],
        [project.objects[start + 1].transform.position[0], .77, .15]] },
    }))
    useProjectsStore.getState().upsert(project)
  }, { url, id })
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  const plansUrl = await moduleUrl(page, '/src/state/plansStore.ts')
  await expect.poll(() => page.evaluate(async ({ plansUrl, id }) => {
    const { usePlansStore } = await import(plansUrl)
    return usePlansStore.getState().baselines[id]?.projectId
  }, { plansUrl, id })).toBe(id)
  return id
}

async function openPanel(page: Page) {
  const tools = page.getByRole('complementary', { name: '物体与连线', exact: true })
  await expect(tools).toBeVisible()
  await tools.getByRole('button', { name: '连线', exact: true }).click()
  const panel = page.getByTestId('cable-management-panel')
  await expect(panel).toBeVisible()
  return panel
}

async function openRoutingGuide(page: Page) {
  // 仅桌面端：右侧引导面板始终停靠，不需要抽屉开合
  const guide = page.getByRole('complementary', { name: '整理与理线', exact: true }).filter({ visible: true })
  await expect(guide).toBeVisible()
  return guide
}

async function acceptRoutingCandidate(page: Page, id: string, count: number, timeout: number) {
  const previewUrl = await moduleUrl(page, '/src/features/connections/routingPreview.ts')
  await expect.poll(() => page.evaluate(async ({ url, id }) => {
    const { useRoutingPreviewStore } = await import(url)
    const candidate = useRoutingPreviewStore.getState().candidate
    return candidate?.projectId === id ? candidate.validation : null
  }, { url: previewUrl, id }), { timeout }).toMatchObject({ validCount: count, failedCount: 0 })
  const beforeAcceptance = await readProject(page, id)
  expect(beforeAcceptance.cables.every(cable => cable.route.verification?.status !== 'valid')).toBe(true)
  expect(beforeAcceptance.cableTrayAnalysis).toBeUndefined()
  await openPanel(page)
  await page.getByRole('button', { name: '接受理线方案', exact: true }).filter({ visible: true }).click()
  await expect.poll(async () => (await readProject(page, id)).cables.filter(cable => cable.route.verification?.status === 'valid').length).toBe(count)
}

async function historyAction(page: Page, action: '撤销' | '重做') {
  const button = page.getByRole('button', { name: action, exact: true }).filter({ visible: true })
  if (await button.count()) {
    await button.click()
  } else {
    const menu = page.locator('summary[aria-label="更多操作"]')
    await menu.click()
    await page.getByRole('button', { name: action, exact: true }).filter({ visible: true }).click()
    await menu.click()
  }
  await openPanel(page)
}

async function expectScene(page: Page, count: number) {
  await expect.poll(() => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname.includes('@react-three_fiber'))
    if (!url) throw new Error('React Three Fiber module was not loaded')
    const { _roots } = await import(url)
    const scene = _roots.get(document.querySelector('canvas'))?.store.getState().scene
    const group = scene?.getObjectByName('cable-management')
    let meshes = 0
    group?.traverse((object: { isMesh?: boolean }) => { if (object.isMesh) meshes++ })
    return { mounts: group?.children.length ?? 0, meshes }
  })).toMatchObject({ mounts: count })
  await expect.poll(async () => {
    const screenshot = await page.locator('canvas').screenshot({ scale: 'css', animations: 'disabled' })
    return page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      const colors = new Set<number>()
      const stride = Math.max(1, Math.floor(canvas.width * canvas.height / 10_000))
      for (let index = 0; index < pixels.length; index += stride * 4) {
        if (pixels[index + 3]) colors.add((pixels[index] << 16) + (pixels[index + 1] << 8) + pixels[index + 2])
      }
      return colors.size
    }, screenshot.toString('base64'))
  }).toBeGreaterThan(32)
}

async function screenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled', scale: 'css' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test('edits installed accessories, persists history, and renders real tray analysis', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => {
    if (/Maximum update depth exceeded|The result of getSnapshot should be cached/i.test(message.text())) errors.push(message.text())
  })
  const id = await createProject(page)
  let panel = await openPanel(page)
  await expect(panel.getByRole('checkbox', { name: '复核已安装配件的支撑跨距' })).not.toBeChecked()
  for (const preset of ['rear-clips', 'underside-ties', 'underside-tray']) {
    const previous = (await readProject(page, id)).room.cableManagement?.mounts.length ?? 0
    await panel.getByRole('combobox', { name: '理线配件预设' }).selectOption(preset)
    await panel.getByRole('button', { name: '添加配件建议' }).click()
    await expect.poll(async () => (await readProject(page, id)).room.cableManagement?.mounts.length ?? 0).toBeGreaterThan(previous)
    await expect(panel.getByRole('button', { name: '添加配件建议' })).toBeDisabled()
  }
  const config = (await readProject(page, id)).room.cableManagement!
  expect(new Set(config.mounts.map(mount => mount.preset))).toEqual(new Set(['rear-clips', 'underside-ties', 'underside-tray']))
  expect(config.mounts.every(mount => !mount.installed)).toBe(true)
  const first = config.mounts[0]
  await panel.getByRole('checkbox', { name: `确认已安装 ${first.label}`, exact: true }).check()
  await expect(panel.getByText('已确认安装', { exact: true })).toHaveCount(1)
  await panel.getByRole('button', { name: `删除 ${first.label}`, exact: true }).click()
  await expect(panel.getByTestId('cable-mount-row')).toHaveCount(config.mounts.length - 1)
  await historyAction(page, '撤销')
  panel = await openPanel(page)
  await expect(panel.getByTestId('cable-mount-row')).toHaveCount(config.mounts.length)
  await expect(panel.getByRole('checkbox', { name: `确认已安装 ${first.label}`, exact: true })).toBeChecked()
  await historyAction(page, '重做')
  panel = await openPanel(page)
  await expect(panel.getByTestId('cable-mount-row')).toHaveCount(config.mounts.length - 1)
  await panel.getByRole('checkbox', { name: `确认已安装 ${config.mounts[1].label}`, exact: true }).check()
  await panel.getByRole('checkbox', { name: '复核已安装配件的支撑跨距' }).check()
  await panel.getByRole('textbox', { name: '最大悬空跨距' }).fill('500')
  await panel.getByRole('textbox', { name: '最大悬空跨距' }).blur()
  await expect.poll(async () => (await readProject(page, id)).room.cableManagement?.maxUnsupportedSpanM).toBe(.5)
  await panel.getByRole('checkbox', { name: '复核已安装配件的支撑跨距' }).uncheck()
  const savedConfig = (await readProject(page, id)).room.cableManagement
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(async () => (await readProject(page, id)).room.cableManagement).toEqual(savedConfig)
  panel = await openPanel(page)
  await expect(panel.getByTestId('cable-mount-row')).toHaveCount(config.mounts.length - 1)
  await expect(panel.getByRole('checkbox', { name: `确认已安装 ${config.mounts[1].label}`, exact: true })).toBeChecked()
  await expect(panel.getByRole('checkbox', { name: '复核已安装配件的支撑跨距' })).not.toBeChecked()
  await expect(page.getByText('避让操作区', { exact: true })).toHaveCount(0)
  await expectScene(page, config.mounts.length - 1)
  await screenshot(page, testInfo, 'accessory-controls')
  const guide = await openRoutingGuide(page)
  await guide.getByRole('checkbox', { name: '已核对尺寸、位置与接口' }).check()
  const planned = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/v1/cables/plan')
  await guide.getByRole('button', { name: '生成走线', exact: true }).click()
  const response = await planned
  expect(response.status()).toBe(202)
  await acceptRoutingCandidate(page, id, 2, 30_000)
  panel = await openPanel(page)
  await expect.poll(async () => (await readProject(page, id)).cableTrayAnalysis?.optimizations.length).toBeGreaterThan(0)
  await expect(panel.getByTestId('tray-analysis')).toBeVisible()
  await expect(panel.getByText('集线槽复查', { exact: true })).toBeVisible()
  await expect(panel.getByTestId('tray-analysis')).toContainText(/已验证汇聚|建议安装|未采用/)
  const project = await readProject(page, id)
  expect(project.cableTrayAnalysis?.sceneId).toBeTruthy()
  expect(project.cables.every(cable => cable.route.verification?.sceneId === project.cableTrayAnalysis?.sceneId
    && cable.route.verification?.sceneRevision === project.cableTrayAnalysis?.sceneRevision)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  await panel.getByTestId('tray-analysis').scrollIntoViewIfNeeded()
  await screenshot(page, testInfo, 'real-tray-analysis')
  await expectScene(page, config.mounts.length - 1)
  await screenshot(page, testInfo, 'accessory-scene')
  panel = await openPanel(page)
  await panel.getByRole('checkbox', { name: `确认已安装 ${config.mounts[1].label}`, exact: true }).uncheck()
  await expect(panel.getByTestId('tray-analysis')).toHaveCount(0)
  expect((await readProject(page, id)).cables.every(cable => cable.status === 'stale')).toBe(true)
  expect(errors).toEqual([])
})

test('organizes the default 17 items and verifies all seven cables on the applied scene revision', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'The full default scene is exercised once; accessory controls have separate mobile coverage.')
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  const id = `default-routing-${crypto.randomUUID()}`
  await page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    const project = structuredClone(useProjectsStore.getState().projects['demo-dorm-101'])
    project.id = id
    project.name = 'Default organization and routing regression'
    project.isDemo = false
    project.source = 'user'
    delete project.demoSeedVersion
    delete project.lastAppliedPlan
    delete project.cableTrayAnalysis
    project.objects.forEach((object: { projectId: string }) => { object.projectId = id })
    project.cables.forEach((cable: { projectId: string }) => { cable.projectId = id })
    useProjectsStore.getState().upsert(project)
  }, { url, id })
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  const original = await readProject(page, id)
  expect(original.objects).toHaveLength(17)
  expect(original.cables).toHaveLength(7)
  const organizeUrl = await moduleUrl(page, '/src/state/organizeStore.ts')
  const readPlan = () => page.evaluate(async (url) => {
    const { useOrganizeStore } = await import(url)
    return useOrganizeStore.getState().plan
  }, organizeUrl)
  await page.getByRole('banner').getByRole('button', { name: '整理桌面', exact: true }).click()
  await page.getByRole('checkbox', { name: '我已核对物品尺寸及整理前位置' }).check()
  const initialSave = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `/api/v1/projects/${id}/scene`)
  await page.getByRole('button', { name: '生成整理方案', exact: true }).last().click()
  const initial = await initialSave
  expect(initial.status()).toBe(200)
  const before = await initial.json()
  expect(before.scene_revision).toBe(1)
  await expect.poll(async () => (await readPlan())?.serviceMeta?.source, { timeout: 90_000 }).toBe('real')
  const plan = await readPlan()
  expect(plan.serviceMeta.status).toBe('success')
  expect(plan.serviceMeta.applicable).toBe(true)
  expect(plan.unplaced).toEqual([])
  expect((await readProject(page, id)).objects).toEqual(original.objects)
  const applyResponse = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === `/api/v1/jobs/${plan.serviceMeta.jobId}/apply`)
  await page.getByRole('button', { name: '接受方案', exact: true }).click()
  const appliedResponse = await applyResponse
  expect(appliedResponse.status()).toBe(200)
  const appliedScene = await appliedResponse.json()
  expect(appliedScene.scene_id).toBe(before.scene_id)
  expect(appliedScene.scene_revision).toBe(before.scene_revision + 1)
  expect(appliedScene.constraints).toEqual({ min_item_gap_m: .02 })
  await expect.poll(async () => (await readProject(page, id)).layoutSource).toBe('algorithm')
  const applied = await readProject(page, id)
  expect(itemSpacingViolations(applied.objects, .02)).toEqual([])
  await page.keyboard.press('Escape')
  await openPanel(page)
  const guide = await openRoutingGuide(page)
  await guide.getByRole('checkbox', { name: '已核对尺寸、位置与接口' }).check()
  expect((await readProject(page, id)).objects.every(object => object.ports.every(port => port.type === 'wireless' || port.confirmed))).toBe(true)
  const routingSave = page.waitForResponse(response => response.request().method() === 'PUT'
    && new URL(response.url()).pathname === `/api/v1/projects/${id}/scene`)
  const routingJob = page.waitForResponse(response => response.request().method() === 'POST'
    && new URL(response.url()).pathname === '/api/v1/cables/plan')
  await guide.getByRole('button', { name: '生成走线', exact: true }).click()
  const synchronized = await routingSave
  expect(synchronized.status()).toBe(200)
  expect(synchronized.request().postDataJSON().expected_revision).toBe(appliedScene.scene_revision)
  const routingScene = await synchronized.json()
  expect(routingScene.scene_id).toBe(appliedScene.scene_id)
  expect(routingScene.scene_revision).toBe(appliedScene.scene_revision + 1)
  expect((await routingJob).status()).toBe(202)
  await acceptRoutingCandidate(page, id, 7, 180_000)
  await expect.poll(async () => {
    const project = await readProject(page, id)
    return project.cables.map(cable => ({ id: cable.id, status: cable.route.verification?.status,
      reason: cable.route.verification?.reasonCode }))
  }, { timeout: 180_000 }).toEqual(original.cables.map(cable => ({ id: cable.id, status: 'valid', reason: undefined })))
  const current = await readProject(page, id)
  expect(current.cables.every(cable => cable.planSource === 'algorithm' && cable.status === 'planned'
    && cable.route.verification?.sceneId === routingScene.scene_id
    && cable.route.verification?.sceneRevision === routingScene.scene_revision)).toBe(true)
  expect(current.objects.map(object => object.transform)).toEqual(applied.objects.map(object => object.transform))
  const saved = await page.request.get(`/api/v1/projects/${id}/scene`)
  expect(saved.status()).toBe(200)
  expect(await saved.json()).toEqual(routingScene)
  await expectScene(page, 0)
  await screenshot(page, testInfo, 'default-seven-cables-valid')
  expect(errors).toEqual([])
})
