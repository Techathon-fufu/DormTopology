import { expect, test, type Page } from '@playwright/test'

async function desktopMeshes(page: Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map(e => e.name)
      .find(name => new URL(name).pathname.endsWith('/@react-three_fiber.js'))
    if (!url) return []
    const { _roots } = await import(url)
    const root = _roots.get(document.querySelector('canvas'))
    if (!root) return []
    const rows: { name: string; visible: boolean; meshes: number }[] = []
    root.store.getState().scene.traverse((node: any) => {
      if (!node.name.startsWith('Desk_Top_') || !node.isMesh) return
      let visible = true
      for (let current = node; current; current = current.parent) visible &&= current.visible
      rows.push({ name: node.name, visible, meshes: node.geometry.attributes.position.count })
    })
    return rows
  })
}
for (const route of ['/routing-demo', '/projects/demo-dorm-101/workspace']) {
  test(`original prefab tabletops remain visible at ${route}`, async ({ page }, testInfo) => {
    const errors: string[] = [], assets = new Set<string>()
    page.on('pageerror', e => errors.push(e.message))
    page.on('response', response => {
      if (response.status() === 200 && /\/models\/dormdesk_parts\/.*\.glb/.test(response.url())) assets.add(response.url())
    })
    await page.goto(route)
    await expect(page.locator('canvas')).toBeVisible()
    await expect.poll(async () => (await desktopMeshes(page)).filter(row => row.visible).length).toBe(2)
    expect(assets.size).toBe(4)
    expect((await desktopMeshes(page)).every(row => row.meshes > 0)).toBe(true)
    if (route === '/routing-demo') {
      await expect(page.getByText('7 / 7', { exact: true })).toBeVisible()
      await expect(page.getByText('穿孔走线', { exact: false })).toHaveCount(0)
      await page.getByRole('button', { name: '俯视', exact: true }).click()
    }
    await page.screenshot({ path: testInfo.outputPath('solid-tabletop.png'), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true)
    expect(errors).toEqual([])
  })
}
