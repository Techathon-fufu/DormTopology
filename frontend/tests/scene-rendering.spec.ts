import { expect, test, type Page } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'

type Diagnostics = { draws: number; preference?: string; renderer?: string; dpr: number }

async function diagnostics(page: Page): Promise<Diagnostics> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas')!
    const gl = canvas.getContext('webgl2')!
    const debug = gl.getExtension('WEBGL_debug_renderer_info')
    return {
      draws: (window as unknown as { previewDraws: number }).previewDraws,
      preference: gl.getContextAttributes()?.powerPreference,
      renderer: debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : 'unavailable',
      dpr: canvas.width / canvas.getBoundingClientRect().width,
    }
  })
}

async function idleDraws(page: Page) {
  const start = (await diagnostics(page)).draws
  await page.waitForTimeout(650) // Measure actual GPU draw submissions over a stationary interval.
  return (await diagnostics(page)).draws - start
}

async function expectVisibleGeometry(page: Page) {
  const png = await page.locator('canvas').screenshot()
  const variance = await page.evaluate(async base64 => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const sample = document.createElement('canvas')
    sample.width = sample.height = 128
    const ctx = sample.getContext('2d')!
    ctx.drawImage(image, 0, 0, 128, 128)
    const data = ctx.getImageData(0, 0, 128, 128).data
    const values = Array.from({ length: data.length / 4 }, (_, i) => (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3)
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length
    return values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  }, png.toString('base64'))
  expect(variance, 'Orbiting outside the room must not leave an opaque wall filling the view').toBeGreaterThan(40)
}

test('stops drawing while idle and wakes for camera movement and drawer animation', async ({ page }, testInfo) => {
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  await page.addInitScript(() => {
    const diagnostic = window as unknown as { previewDraws: number }
    diagnostic.previewDraws = 0
    const proto = WebGL2RenderingContext.prototype
    const drawElements = proto.drawElements, drawArrays = proto.drawArrays
    proto.drawElements = function (...args: Parameters<typeof drawElements>) {
      diagnostic.previewDraws++
      return drawElements.apply(this, args)
    }
    proto.drawArrays = function (...args: Parameters<typeof drawArrays>) {
      diagnostic.previewDraws++
      return drawArrays.apply(this, args)
    }
  })
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(async () => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/state/drawerStore.ts')
    if (!url) return 0
    const { useDrawerStore } = await import(url)
    return useDrawerStore.getState().loadedIds.length
  })).toBe(3)
  await expect.poll(async () => (await diagnostics(page)).draws).toBeGreaterThan(0)
  await expect.poll(() => idleDraws(page), { timeout: 10_000 }).toBe(0)
  await expectVisibleGeometry(page)
  const initial = await diagnostics(page)
  expect(initial.preference).toBe('high-performance')
  expect(initial.dpr).toBeLessThanOrEqual(1.51)

  const box = (await page.locator('canvas').boundingBox())!
  await page.mouse.move(box.x + box.width * .12, box.y + box.height * .12)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * .3, box.y + box.height * .2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await diagnostics(page)).draws).toBeGreaterThan(initial.draws)
  await expect.poll(() => idleDraws(page), { timeout: 10_000 }).toBe(0)
  await expectVisibleGeometry(page)

  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/state/drawerStore.ts')!
    const { useDrawerStore } = await import(url)
    useDrawerStore.getState().toggle('top')
  })
  await expect.poll(async () => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/state/drawerStore.ts')!
    const { useDrawerStore } = await import(url)
    return useDrawerStore.getState().drawers.top.progress
  }), { timeout: 10_000 }).toBe(1)
  await expect.poll(() => idleDraws(page), { timeout: 10_000 }).toBe(0)

  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(e => e.name)
    const drawerUrl = resources.find(n => new URL(n).pathname === '/src/state/drawerStore.ts')!
    const { useDrawerStore } = await import(drawerUrl)
    useDrawerStore.getState().toggle('top')
    const workspaceUrl = resources.find(n => new URL(n).pathname === '/src/state/workspaceStore.ts')!
    const { useWorkspaceStore } = await import(workspaceUrl)
    useWorkspaceStore.getState().resetView()
  })
  await expect.poll(async () => page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name).find(n => new URL(n).pathname === '/src/state/drawerStore.ts')!
    const { useDrawerStore } = await import(url)
    return useDrawerStore.getState().drawers.top.progress
  })).toBe(0)
  await expect.poll(() => idleDraws(page), { timeout: 10_000 }).toBe(0)
  await expectVisibleGeometry(page)

  const screenshot = testInfo.outputPath('daylight-workspace.png')
  await page.screenshot({ path: screenshot, scale: 'css' })
  await testInfo.attach('daylight-workspace', { path: screenshot, contentType: 'image/png' })
  const report = testInfo.outputPath('render-diagnostics.json')
  await writeFile(report, JSON.stringify({ initial, final: await diagnostics(page), idleDraws: 0 }, null, 2))
  await testInfo.attach('render-diagnostics', { path: report, contentType: 'application/json' })
  expect(failures).toEqual([])
})

test('comparison stays visible and the guide exports a rendered PNG with demand drawing', async ({ page }) => {
  const failures: string[] = []
  page.on('pageerror', error => failures.push(error.message))
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(e => e.name)
    const projectUrl = resources.find(n => new URL(n).pathname === '/src/state/projectsStore.ts')!
    const plansUrl = resources.find(n => new URL(n).pathname === '/src/state/plansStore.ts')!
    const { useProjectsStore } = await import(projectUrl)
    const { usePlansStore } = await import(plansUrl)
    usePlansStore.getState().saveCandidate(useProjectsStore.getState().projects['demo-dorm-101'], '渲染回归快照')
  })
  await page.goto('/projects/demo-dorm-101/compare')
  await expect(page.locator('canvas')).toBeVisible()
  await expectVisibleGeometry(page)
  await page.goto('/projects/demo-dorm-101/guide')
  await expect(page.getByRole('heading', { name: '当前方案场景', exact: true })).toBeVisible()
  await page.getByText('更多导出', { exact: true }).click()
  const exported = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出截图', exact: true }).click()
  const download = await exported
  const bytes = await readFile((await download.path())!)
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(bytes.length).toBeGreaterThan(8_000)
  expect(failures).toEqual([])
})
