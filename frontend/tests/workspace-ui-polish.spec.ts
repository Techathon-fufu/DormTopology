import { expect, test, type Page, type TestInfo } from '@playwright/test'

const demoProjectId = 'demo-dorm-101'

// 1x1 transparent PNG
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
const PNG_BUFFER = Buffer.from(PNG_BASE64, 'base64')

function collectFailures(page: Page) {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  return failures
}

async function openWorkspace(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/projects/${demoProjectId}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  await expect(page.getByRole('contentinfo')).toBeVisible()
}

async function attachViewport(page: Page, testInfo: TestInfo, name: string, width: number, height: number) {
  const path = testInfo.outputPath(`${name}-${width}x${height}.png`)
  await page.screenshot({ path, fullPage: false, scale: 'css', animations: 'disabled' })
  await testInfo.attach(`${name}-${width}x${height}`, { path, contentType: 'image/png' })
}

function leftRegion(page: Page) { return page.getByRole('complementary', { name: '物体与连线', exact: true }) }
function rightRegion(page: Page) { return page.getByRole('complementary', { name: '整理与理线', exact: true }) }
async function openTools(page: Page) {
  await expect(leftRegion(page)).toBeVisible()
  return leftRegion(page)
}
async function openGuide(page: Page) {
  await expect(rightRegion(page)).toBeVisible()
  return rightRegion(page)
}

test('photo drawer previews a local upload without issuing generation requests', async ({ page }) => {
  const failures = collectFailures(page)
  const generation: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.startsWith('/api/') && request.method() !== 'GET') generation.push(`${request.method()} ${path}`)
  })

  await openWorkspace(page)

  const tools = await openTools(page)
  await tools.getByRole('button', { name: '照片生成模型', exact: true }).click()
  const draft = tools.getByRole('region', { name: '照片生成模型' })
  await draft.getByLabel('选择照片', { exact: true }).setInputFiles({ name: 'preview.png', mimeType: 'image/png', buffer: PNG_BUFFER })
  await expect(draft.getByAltText('照片预览')).toBeVisible()
  await expect(draft.getByRole('button', { name: '生成模型（待接入）', exact: true })).toBeDisabled()
  await expect(draft.getByText('界面预览 · 生成服务待接入')).toBeVisible()
  await draft.getByLabel('选择照片', { exact: true }).setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') })
  await expect(draft.getByRole('alert')).toContainText('仅支持')
  await draft.getByRole('button', { name: '清除图片', exact: true }).click()
  await expect(draft.getByAltText('照片预览')).toHaveCount(0)
  expect(generation).toEqual([])
  expect(failures).toEqual([])
})

test('selecting an object from the left list keeps the right guide visible', async ({ page }) => {
  const failures = collectFailures(page)
  await openWorkspace(page)

  const tools = await openTools(page)
  await tools.getByRole('button', { name: /笔记本电脑/ }).first().click()
  await expect(tools.getByRole('heading', { name: '对象属性' })).toBeVisible()
  if (await rightRegion(page).isVisible()) await expect(rightRegion(page).getByRole('heading', { name: '整理与理线' })).toBeVisible()
  await tools.getByRole('button', { name: /返回物体清单/ }).click()
  await expect(tools.getByRole('heading', { name: '场景物体' })).toBeVisible()
  const guide = await openGuide(page)
  await expect(guide.getByRole('heading', { name: '整理与理线' })).toBeVisible()
  expect(failures).toEqual([])
})

test('cable tab switches the left panel into cable mode without fake features', async ({ page }) => {
  const failures = collectFailures(page)
  await openWorkspace(page)

  const tools = await openTools(page)
  await tools.getByRole('button', { name: '连线', exact: true }).click()
  await expect(tools.getByRole('heading', { name: /线缆列表/ })).toBeVisible()
  await expect(tools.getByRole('button', { name: '规划全部走线（真实后端）', exact: true })).toHaveCount(0)
  const guide = await openGuide(page)
  const confirm = guide.getByRole('checkbox', { name: '已核对尺寸、位置与接口', exact: true })
  await expect(confirm).toBeVisible()
  const plan = guide.getByRole('button', { name: '生成走线', exact: true })
  await expect(plan).toBeDisabled()
  await confirm.check()
  await expect(plan).toBeEnabled()
  expect(failures).toEqual([])
})

test('renders without overflow and keeps the canvas visible across viewports', async ({ page }, testInfo) => {
  const failures = collectFailures(page)
  await openWorkspace(page)

  const viewports: Array<{ name: string; width: number; height: number }> = [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'laptop', width: 1366, height: 768 },
  ]

  for (const vp of viewports) {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await expect(page.locator('canvas')).toBeVisible()
    await page.waitForTimeout(150)

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow, `no horizontal overflow at ${vp.name} (${vp.width}x${vp.height})`).toBeLessThanOrEqual(1)

    await attachViewport(page, testInfo, 'workspace-ui', vp.width, vp.height)
  }

  expect(failures).toEqual([])
})
