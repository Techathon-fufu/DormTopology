import { expect, test, type Page } from '@playwright/test'

test.skip(process.env.WORKFLOW_API_AVAILABLE !== '1', 'Start the real backend and set WORKFLOW_API_AVAILABLE=1')
test.setTimeout(180_000)

async function action(page: Page, button: string, path: string) {
  const [response] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith(path) && r.request().method() === 'POST', { timeout: 120_000 }),
    page.getByTestId(button).click(),
  ])
  expect(response.ok(), await response.text()).toBeTruthy()
  await expect(page.getByTestId('workflow-status')).not.toHaveText('处理中…', { timeout: 120_000 })
  await expect(page.getByTestId('workflow-error')).toHaveCount(0)
  return response.json()
}

test('real saved layout → apply → three routes → guide; stale and failed routes', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/workflow')
  const initial = await action(page, 'create-sample', '/api/v1/scenes')
  const id = initial.scene.scene_id
  const url = `/api/v1/scenes/${id}`
  expect(initial.scene.items.filter((i: { fixed: boolean }) => !i.fixed)).toHaveLength(8)
  expect(initial.scene.cables).toHaveLength(3)
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByTestId('baseline-check').check()
  const confirmed = await action(page, 'confirm-baseline', `${url}/baseline`)
  expect(confirmed.scene.scene_revision).toBe(2)
  const proposed = await action(page, 'run-packing', `${url}/packing`)
  expect(proposed.packing_result.status).toBe('success')
  expect(proposed.scene).toEqual(confirmed.scene)
  await page.getByTestId('show-packing-preview').click()
  await page.getByTestId('cancel-packing').click()
  const unchanged = await (await page.request.get(url)).json()
  expect(unchanged.scene).toEqual(confirmed.scene)
  await page.getByTestId('show-packing-preview').click()
  const applied = await action(page, 'apply-packing', `${url}/packing/apply`)
  expect(applied.scene.scene_revision).toBe(3)
  expect(applied.baseline).toEqual(confirmed.baseline)
  const routed = await action(page, 'run-routing', `${url}/routing`)
  expect(routed.routing_result.cables).toHaveLength(3)
  expect(routed.routing_result.cables.every((c: { status: string }) => c.status === 'valid')).toBeTruthy()
  const guide = await action(page, 'run-guide', `${url}/guide`)
  expect(guide.guide.status).toBe('complete')
  expect(guide.comparison.baseline_free_area_m2).toBeGreaterThan(0)
  expect(guide.comparison.baseline_exposed_length_m).toBeNull()
  await expect(page.getByTestId('guide-status')).toHaveText('当前指南已完成')
  const download = page.waitForEvent('download')
  await page.getByTestId('download-guide').click()
  expect((await download).suggestedFilename()).toContain(id)
  await page.reload()
  await expect(page.getByTestId('scene-identity')).toContainText('r3')
  await expect(page.getByTestId('guide-status')).toHaveText('当前指南已完成')
  await page.screenshot({ path: info.outputPath('workflow-complete.png'), scale: 'css' })

  const shortCableId = guide.scene.cables[0].id
  await page.getByTestId(`cable-${shortCableId}-length`).fill('0.01')
  await expect(page.getByTestId('run-routing')).toBeDisabled()
  const [save] = await Promise.all([
    page.waitForResponse(r => r.url().endsWith(url) && r.request().method() === 'PUT'),
    page.getByTestId('save-changes').click(),
  ])
  expect(save.ok()).toBeTruthy()
  await expect(page.getByTestId('scene-identity')).toContainText('r4')
  await expect(page.getByTestId('download-guide')).toBeDisabled()
  const late = await page.request.post(`${url}/packing/apply`, { data: { expected_revision: 3 } })
  expect(late.status()).toBe(409)
  const failed = await action(page, 'run-routing', `${url}/routing`)
  expect(failed.routing_result.cables.find((c: { id: string }) => c.id === shortCableId).status).toBe('failed')
  expect(failed.routing_result.cables.filter((c: { status: string }) => c.status === 'valid')).toHaveLength(2)
  const incomplete = await action(page, 'run-guide', `${url}/guide`)
  expect(incomplete.guide.status).toBe('incomplete')
  expect(incomplete.comparison.current_exposed_length_m).toBeNull()
  expect(incomplete.baseline).toEqual(confirmed.baseline)
  await expect(page.getByTestId('guide-status')).toHaveText('当前指南未完成')
  const viewport = page.viewportSize()!
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
  expect(errors).toEqual([])
})

test('malformed input, uploaded photo, and stale document are handled by the real API', async ({ page }) => {
  const doc = await (await page.request.post('/api/v1/scenes', { data: {} })).json()
  const url = `/api/v1/scenes/${doc.scene.scene_id}`
  const invalid = await page.request.put(url, { data: { expected_revision: 1, scene: { bad: true } } })
  expect(invalid.status()).toBe(400)
  const confirmed = await (await page.request.post(`${url}/baseline`, { data: { expected_revision: 1 } })).json()
  const stale = await page.request.put(url, { data: { expected_revision: 1, scene: doc.scene } })
  expect(stale.status()).toBe(409)
  const latest = await (await page.request.get(url)).json()
  expect(latest.scene).toEqual(confirmed.scene)
  expect(latest.baseline).toEqual(confirmed.baseline)
  const invalidPhoto = await page.request.post(`${url}/photos`, {
    multipart: { expected_revision: '2', file: { name: 'x.png', mimeType: 'image/png', buffer: Buffer.from('not an image') } },
  })
  expect(invalidPhoto.status()).toBe(400)
})
