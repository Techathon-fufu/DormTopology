import { expect, test, type Page, type TestInfo } from '@playwright/test'
import type { GenerationJob } from '../src/types/project'

const demoProjectId = 'demo-dorm-101'

function collectRuntimeFailures(page: Page) {
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  page.on('console', message => {
    if (/Maximum update depth exceeded|The result of getSnapshot should be cached/i.test(message.text())) {
      failures.push(message.text())
    }
  })
  return failures
}

async function openWorkspace(page: Page, expectedModelStatus: 'loaded' | 'failed' = 'loaded') {
  await page.goto(`/projects/${demoProjectId}/workspace`)
  await expect(page.getByRole('banner').getByTitle('示例：上床下桌·四人间')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toContainText(/物品 \d+/)
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(async () => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .filter(name => new URL(name).pathname === '/src/state/deskModelStore.ts').at(-1)
    if (!url) return 'missing'
    const { useDeskModelStore } = await import(url)
    return useDeskModelStore.getState().status
  }), { message: 'The split desk GLBs should reach the expected state before visual checks.' }).toBe(expectedModelStatus)
}

async function deskState(page: Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === '/src/state/deskModelStore.ts').at(-1)
    if (!url) throw new Error('deskModelStore.ts was not loaded')
    const { useDeskModelStore } = await import(url)
    const { status, metrics } = useDeskModelStore.getState()
    return { status, metrics }
  })
}

async function expectNonblankCanvas(page: Page) {
  let lastMetrics: unknown
  try {
  await expect.poll(async () => {
    // The production WebGL buffer is discarded after presentation, so inspect the displayed image.
    const screenshot = await page.locator('canvas').screenshot({ scale: 'css', animations: 'disabled' })
    const metrics = await page.evaluate(async (base64) => {
      const image = new Image()
      image.src = `data:image/png;base64,${base64}`
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0)
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
      let count = 0
      let sum = 0
      let squareSum = 0
      const cells = new Map<number, { count: number; sum: number }>()
      const stride = Math.max(1, Math.floor((canvas.width * canvas.height) / 10_000))
      for (let index = 0; index < pixels.length; index += stride * 4) {
        if (pixels[index + 3] < 128) continue
        const luminance = 0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]
        count += 1
        sum += luminance
        squareSum += luminance * luminance
        const pixel = index / 4
        const x = pixel % canvas.width
        const y = Math.floor(pixel / canvas.width)
        const cellId = Math.floor(y * 4 / canvas.height) * 4 + Math.floor(x * 4 / canvas.width)
        const cell = cells.get(cellId) ?? { count: 0, sum: 0 }
        cell.count += 1
        cell.sum += luminance
        cells.set(cellId, cell)
      }
      const samples = Math.ceil(canvas.width * canvas.height / stride)
      const coverage = count / samples
      const variance = count ? squareSum / count - (sum / count) ** 2 : 0
      const means = [...cells.values()].map(cell => cell.sum / cell.count)
      const spatialRange = means.length ? Math.max(...means) - Math.min(...means) : 0
      return { coverage, variance, cells: cells.size, spatialRange }
    }, screenshot.toString('base64'))
    lastMetrics = metrics
    return metrics.coverage > 0.5 && metrics.variance > 25 && metrics.cells >= 8 && metrics.spatialRange > 5
  }, { message: 'The workspace should render nonuniform geometry across the canvas.' }).toBe(true)
  } catch (error) {
    throw new Error(`Canvas metrics: ${JSON.stringify(lastMetrics)}`, { cause: error })
  }
}

async function attachViewport(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: false, scale: 'css', animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function selectView(page: Page, value: 'top' | 'front') {
  const select = page.getByRole('combobox', { name: '场景视角', exact: true })
  if (await select.isVisible()) {
    await select.selectOption(value)
  } else {
    const menu = page.locator('summary[aria-label="更多操作"]')
    await menu.click()
    await page.getByRole('combobox', { name: '更多操作中的场景视角', exact: true }).selectOption(value)
    await menu.click()
  }
}

type JobMutation =
  | { action: 'create'; projectId: string; title: string }
  | { action: 'update'; id: string; patch: Partial<GenerationJob> }
  | { action: 'remove'; id: string }

async function mutateJob(page: Page, mutation: JobMutation): Promise<string | null> {
  return page.evaluate(async (input) => {
    // Import the exact Vite module already used by the page, including its HMR version.
    const moduleUrl = performance.getEntriesByType('resource')
      .map(entry => entry.name)
      .filter(name => new URL(name).pathname === '/src/state/jobsStore.ts')
      .at(-1)
    if (!moduleUrl) throw new Error('The workspace did not load jobsStore.ts')
    const { useJobsStore } = await import(moduleUrl)
    const store = useJobsStore.getState()
    if (input.action === 'create') {
      return store.create({ projectId: input.projectId, type: 'model', title: input.title }).id
    }
    if (input.action === 'update') store.update(input.id, input.patch)
    else store.remove(input.id)
    return null
  }, mutation)
}

test('opens the example workspace without a render loop and keeps its scene visible', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page)
  const loaded = new Set<string>()
  page.on('response', (response) => {
    if (response.status() === 200 && response.url().includes('/models/dormdesk_parts/')) loaded.add(new URL(response.url()).pathname)
  })
  await openWorkspace(page)
  await expect.poll(async () => (await deskState(page)).status).toBe('loaded')
  expect(loaded.size).toBe(4)
  expect((await deskState(page)).metrics?.deskTopY).toBeCloseTo(.75)
  await expectNonblankCanvas(page)
  await selectView(page, 'top')
  await expectNonblankCanvas(page)
  await selectView(page, 'front')
  await expectNonblankCanvas(page)
  await attachViewport(page, testInfo, 'workspace-rendered')
  await page.reload()
  await expect(page.getByRole('contentinfo')).toContainText(/物品 \d+/)
  await expectNonblankCanvas(page)
  expect(failures).toEqual([])
})

test('keeps the fixed furniture visible after a partial asset failure and recovers on retry', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page)
  const asset = '**/models/dormdesk_parts/drawer_middle.glb'
  await page.route(asset, (route) => route.fulfill({ status: 404, body: 'Missing drawer' }))
  await openWorkspace(page, 'failed')
  await expect.poll(async () => (await deskState(page)).status).toBe('failed')
  await expectNonblankCanvas(page)
  await attachViewport(page, testInfo, 'fixed-furniture-fallback')
  await page.unroute(asset)
  await page.getByText('简化桌体', { exact: true }).click()
  await page.getByRole('button', { name: '重新加载', exact: true }).click()
  await expect.poll(async () => (await deskState(page)).status).toBe('loaded')
  await expectNonblankCanvas(page)
  await attachViewport(page, testInfo, 'fixed-furniture-recovered')
  expect(failures).toEqual([])
})

test('uses the solid prefab desktop in setup without invented hole controls', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page)
  await page.goto(`/projects/${demoProjectId}/setup`)
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: '书架', exact: true })).toBeDisabled()
  await expect(page.getByLabel('离桌高度（最下层）', { exact: true })).toBeDisabled()
  await expect(page.getByText('未发现数值越界或明显结构冲突', { exact: true })).toBeVisible()
  await expectNonblankCanvas(page)
  await expect(page.getByText('正式桌面没有穿线孔，按模型原样显示；线缆沿桌后边缘走线。')).toBeVisible()
  await expect(page.getByLabel('孔 X（左右）', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '前往照片导入', exact: true })).toBeEnabled()
  await attachViewport(page, testInfo, 'fixed-furniture-setup')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
  expect(failures).toEqual([])
})

test('updates the status bar when project jobs change and excludes other projects', async ({ page }, testInfo) => {
  const failures = collectRuntimeFailures(page)
  await openWorkspace(page)
  const statusBar = page.getByRole('contentinfo')
  const otherId = await mutateJob(page, { action: 'create', projectId: 'unrelated-project', title: '其他项目模型任务' })
  expect(otherId).toBeTruthy()
  await expect(statusBar).not.toContainText('其他项目模型任务')

  const jobId = await mutateJob(page, { action: 'create', projectId: demoProjectId, title: '工作台模型任务' })
  expect(jobId).toBeTruthy()
  await expect(statusBar).toContainText('工作台模型任务')
  await mutateJob(page, { action: 'update', id: jobId!, patch: { status: 'awaiting', stageLabel: '等待尺寸确认' } })
  await expect(statusBar).toContainText('工作台模型任务 · 等待尺寸确认 · 1 待确认')
  await mutateJob(page, { action: 'update', id: jobId!, patch: { status: 'failed', error: '测试失败状态' } })
  await expect(statusBar).toContainText('1 个任务未完成')
  // 状态栏把失败重试收进「服务与任务」折叠区，展开后断言可见
  await statusBar.locator('summary').click()
  await expect(statusBar.getByRole('button', { name: '重试', exact: true })).toBeVisible()
  await expect(statusBar).not.toContainText('工作台模型任务')

  await mutateJob(page, { action: 'remove', id: jobId! })
  await expect(statusBar).not.toContainText('个任务未完成')
  await expect(statusBar.getByRole('button', { name: '重试', exact: true })).toHaveCount(0)
  await expect(statusBar).not.toContainText('其他项目模型任务')
  await mutateJob(page, { action: 'remove', id: otherId! })
  // 收起「服务与任务」折叠区，避免展开的任务面板遮挡画布像素采样
  if (await statusBar.locator('details[open]').count()) await statusBar.locator('summary').click()
  await expectNonblankCanvas(page)
  await attachViewport(page, testInfo, 'workspace-jobs-updated')
  expect(failures).toEqual([])
})
