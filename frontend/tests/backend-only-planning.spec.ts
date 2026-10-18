import { expect, test, type Page } from '@playwright/test'
import type { Project } from '../src/types/project'

test.skip(process.env.PLAYWRIGHT_REAL_ORGANIZATION !== '1', 'Requires a running Python backend and the Vite source development server.')
test.setTimeout(60_000)

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

async function readPlan(page: Page) {
  const url = await moduleUrl(page, '/src/state/organizeStore.ts')
  return page.evaluate(async (url) => {
    const { useOrganizeStore } = await import(url)
    return useOrganizeStore.getState().plan
  }, url)
}

async function createProject(page: Page, withCable = false) {
  await page.addInitScript(() => localStorage.setItem('dormtopology.api-mode-override', 'mock'))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  const id = `backend-only-${crypto.randomUUID()}`
  await page.evaluate(async ({ url, id, withCable }) => {
    const { useProjectsStore } = await import(url)
    const source = useProjectsStore.getState().projects['demo-dorm-101']
    const project = structuredClone(source)
    project.id = id
    project.name = 'Backend planning regression'
    project.room.furnitureModel = undefined
    project.room.desk = { width: 1.6, depth: .8, height: .75, thickness: .025 }
    project.room.shelf = { enabled: true, levels: 1, heightAboveDesk: .38, depth: .2 }
    project.isDemo = false
    project.source = 'user'
    project.stage = 'organize'
    delete project.demoSeedVersion
    delete project.lastAppliedPlan
    project.objects = [-0.2, -0.16].map((x, index) => ({
      ...structuredClone(source.objects[0]),
      id: `${id}-box-${index}`, projectId: id, name: `Box ${index + 1}`,
      dimensions: { width: 0.12, height: 0.12, depth: 0.12 },
      transform: { position: [x, project.room.desk.height, 0.42], rotationY: 0 },
      category: withCable ? 'electrical' : 'nonElectrical',
      model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
      ports: withCable ? [{ id: `${id}-port-${index}`, type: 'rj45', powered: false, confirmed: true }] : [],
      source: 'manual', needsPower: false, frequent: false, fixed: false, locked: false, visible: true,
    }))
    project.cables = withCable ? [{
      id: `${id}-cable`, projectId: id, kind: 'network', status: 'existing', accessories: [],
      from: { objectId: project.objects[0].id, portId: project.objects[0].ports[0].id, position: [...project.objects[0].transform.position] },
      to: { objectId: project.objects[1].id, portId: project.objects[1].ports[0].id, position: [...project.objects[1].transform.position] },
      route: { channels: [], points: project.objects.map((object: Project['objects'][number]) => [...object.transform.position]) },
      actualLengthM: 1, reserveLengthM: 0.1,
    }] : []
    useProjectsStore.getState().upsert(project)
  }, { url, id, withCable })
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  const plansUrl = await moduleUrl(page, '/src/state/plansStore.ts')
  await expect.poll(() => page.evaluate(async ({ plansUrl, id }) => {
    const { usePlansStore } = await import(plansUrl)
    return usePlansStore.getState().baselines[id]?.projectId
  }, { plansUrl, id })).toBe(id)
  expect(await page.evaluate(() => localStorage.getItem('dormtopology.api-mode-override'))).toBe('mock')
  return id
}

async function expectBackendOnlyControls(page: Page) {
  await expect(page.getByRole('contentinfo')).toContainText('后端整理 / 理线')
  await expect(page.getByText(/规则式?演示|恢复真实模式|切换到演示模式/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /切换.*演示|恢复真实/ })).toHaveCount(0)
  const tasks = page.getByRole('button', { name: /^任务 \d+/ })
  await tasks.click()
  await expect(page.getByText('服务状态', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /切换.*演示|恢复真实/ })).toHaveCount(0)
  await tasks.click()
}

test('ignores the old demo override, preserves failed scenes, and retries the real backend', async ({ page }, testInfo) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  const id = await createProject(page)
  const original = await readProject(page, id)
  await expectBackendOnlyControls(page)
  await page.getByTitle('打开空间整理面板：分区归位与整理方案').click()
  const confirmation = page.getByRole('checkbox', { name: '我已核对物品尺寸及整理前位置' })
  const generate = page.getByRole('button', { name: '生成整理方案', exact: true }).last()
  await expect(confirmation).not.toBeChecked()
  await expect(generate).toBeDisabled()
  await confirmation.check()
  await expect(generate).toBeEnabled()

  const scenePath = `/api/v1/projects/${id}/scene`
  const scenePattern = `**${scenePath}`
  const planningRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() === 'POST' && /\/api\/v1\/(organization|cables)\/plan$/.test(new URL(request.url()).pathname)) planningRequests.push(request.url())
  })
  await page.route(scenePattern, async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Planning backend temporarily unavailable' }) })
  })
  const rejected = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === scenePath)
  await generate.click()
  expect((await rejected).status()).toBe(503)
  await expect(page.getByRole('alert')).toContainText('HTTP 503')
  await expect(page.getByRole('alert')).toContainText('Planning backend temporarily unavailable')
  expect((await readProject(page, id)).objects).toEqual(original.objects)
  expect(await readPlan(page)).toBeNull()
  expect(planningRequests).toEqual([])
  await expect(page.getByRole('button', { name: '接受方案', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /切换.*演示|恢复真实/ })).toHaveCount(0)
  await expect(generate).toBeEnabled()
  const screenshot = testInfo.outputPath('backend-only-failure.png')
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('backend-only-failure', { path: screenshot, contentType: 'image/png' })

  await page.unroute(scenePattern)
  const recovered = page.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname === scenePath)
  await generate.click()
  expect((await recovered).status()).toBe(200)
  await expect.poll(async () => (await readPlan(page))?.serviceMeta?.source, { timeout: 30_000 }).toBe('real')
  expect((await readPlan(page)).kind).toBe('algorithm')
  expect((await readProject(page, id)).objects).toEqual(original.objects)
  expect(planningRequests).toHaveLength(1)
  expect(failures).toEqual([])
})

test('blocks cable planning until the scene is confirmed despite the old demo override', async ({ page }, testInfo) => {
  const id = await createProject(page, true)
  const original = await readProject(page, id)
  const requests: string[] = []
  page.on('request', (request) => {
    if (['PUT', 'POST'].includes(request.method()) && new URL(request.url()).pathname.startsWith('/api/v1/')) requests.push(request.url())
  })
  await page.getByRole('button', { name: '连线', exact: true }).click()
  await page.getByRole('button', { name: '规划全部走线', exact: true }).click()
  await expect(page.getByRole('contentinfo')).toContainText('请先核对并确认物品尺寸、位置与接口')
  expect(requests).toEqual([])
  expect((await readProject(page, id)).cables).toEqual(original.cables)
  await expect(page.getByRole('checkbox', { name: '已核对尺寸、位置与接口' })).not.toBeChecked()
  await expect(page.getByText(/规则式?演示|恢复真实模式|切换到演示模式/)).toHaveCount(0)
  const screenshot = testInfo.outputPath('backend-only-routing-confirmation.png')
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('backend-only-routing-confirmation', { path: screenshot, contentType: 'image/png' })
})

test('shows historical demo-rule planned paths as unverified and needing recalculation', async ({ page }, testInfo) => {
  const id = await createProject(page, true)
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  await page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    useProjectsStore.getState().update(id, (project: Project) => ({
      ...project,
      cables: project.cables.map((cable) => ({ ...cable, status: 'planned', planSource: 'demo-rule' })),
    }))
  }, { url, id })
  const original = await readProject(page, id)
  expect(original.cables[0].status).toBe('planned')
  expect(original.cables[0].planSource).toBe('demo-rule')
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: '连线', exact: true }).click()
  if (!await page.getByRole('checkbox', { name: '已核对尺寸、位置与接口' }).isVisible()) {
    await page.getByRole('button', { name: '打开物品面板', exact: true }).click()
  }
  const list = page.locator('aside:visible').filter({ has: page.getByRole('heading', { name: /^线缆列表/ }) })
  await expect(list).toContainText('历史未验证路径 1 条')
  await expect(list).toContainText('需重新计算')
  await expect(list.getByText('已规划', { exact: true })).toHaveCount(0)
  await expect(list.getByText(/已规划走线/)).toHaveCount(0)
  await expect(page.getByRole('contentinfo')).toContainText('需重算 1')
  await list.getByRole('button', { name: /Box 1 → Box 2/ }).click()
  const details = page.locator('aside:visible').filter({ has: page.getByRole('heading', { name: '线缆属性', exact: true }) })
  await expect(details.getByText('历史路径 · 未验证', { exact: true })).toBeVisible()
  await expect(details.getByText('需重新计算', { exact: true })).toBeVisible()
  await expect(details.getByText('已规划', { exact: true })).toHaveCount(0)
  await expect(details.getByText(/后端曲线已验证/)).toHaveCount(0)
  expect((await readProject(page, id)).cables).toEqual(original.cables)
  const screenshot = testInfo.outputPath('historical-demo-rule-unverified.png')
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('historical-demo-rule-unverified', { path: screenshot, contentType: 'image/png' })
})

test('plans a verified route without asking for actual length and shows the computed requirement', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  const id = await createProject(page, true)
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  await page.evaluate(async ({ url, id }) => {
    const { useProjectsStore } = await import(url)
    useProjectsStore.getState().update(id, (project: Project) => {
      const objects = project.objects.map((object, index) => ({
        ...object,
        dimensions: { width: 0.08, height: 0.04, depth: 0.08 },
        transform: { position: [index === 0 ? -0.55 : -0.15, 0.75, 0.19], rotationY: 0 },
        ports: [{ ...object.ports[0], type: 'hdmi', offset: [0, 0.02, -0.04], direction: 'back', confirmed: true }],
      }))
      const cables = project.cables.map(cable => ({
        ...cable, kind: 'video', visibility: 'hidden', thickness: 'thin', actualLengthM: undefined,
        from: { ...cable.from, position: [-0.55, 0.77, 0.15] },
        to: { ...cable.to, position: [-0.15, 0.77, 0.15] },
      }))
      return { ...project, objects, cables, room: { ...project.room, shelf: { ...project.room.shelf, enabled: false }, posts: [] } }
    })
  }, { url, id })
  await page.reload()
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: '连线', exact: true }).click()
  if (!await page.getByRole('checkbox', { name: '已核对尺寸、位置与接口' }).isVisible()) {
    await page.getByRole('button', { name: '打开物品面板', exact: true }).click()
  }
  await page.getByRole('checkbox', { name: '已核对尺寸、位置与接口' }).check()
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && new URL(response.url()).pathname === `/api/v1/projects/${id}/scene`)
  await page.getByRole('button', { name: '规划全部走线（真实后端）', exact: true }).click()
  const sceneResponse = await saved
  expect(sceneResponse.status()).toBe(200)
  expect((await sceneResponse.json()).cables[0].length_m).toBeNull()
  await expect(page.locator('aside:visible').getByText('理线方案预览（本地）', {exact:true})).toBeVisible({timeout:30_000})
  expect((await readProject(page,id)).cables[0].route.verification).toBeUndefined()
  await page.getByRole('button',{name:'接受理线方案',exact:true}).click()
  await expect.poll(async () => (await readProject(page, id)).cables[0].route.verification?.status, { timeout: 30_000 }).toBe('valid')
  const cable = (await readProject(page, id)).cables[0]
  expect(cable.actualLengthM).toBeUndefined()
  expect(cable.route.pathLengthM).toBeGreaterThan(0)
  expect(cable.note).toContain('现有线材长度未校验')
  await page.getByRole('button', { name: /Box 1 → Box 2/ }).click()
  const details = page.locator('aside:visible').filter({ has: page.getByRole('heading', { name: '线缆属性', exact: true }) })
  await expect(details.getByLabel('实际线长', { exact: true })).toHaveCount(0)
  await expect(details.getByText(/实际线长尚未填写|请填写.*线长/)).toHaveCount(0)
  await expect(details.getByLabel('预留长度', { exact: true })).toHaveValue('100')
  const requiredMm = Math.round((cable.route.pathLengthM! + cable.reserveLengthM!) * 1000)
  await expect(details.getByText(/^所需线长：/)).toContainText(`${requiredMm} mm`)
  await details.getByText(/^所需线长：/).scrollIntoViewIfNeeded()
  const screenshot = testInfo.outputPath('routing-without-length.png')
  await page.screenshot({ path: screenshot, animations: 'disabled' })
  await testInfo.attach('routing-without-length', { path: screenshot, contentType: 'image/png' })
  expect(errors).toEqual([])
})
