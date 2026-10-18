import { expect, test } from '@playwright/test'

test('printer output and computer front details have separated depth planes', async ({ page }) => {
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const surfaces = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname === '/src/scene/primitiveGeometry.ts')
    if (!moduleUrl) throw new Error('Primitive geometry module did not load')
    const { describePrimitive } = await import(moduleUrl)
    const bounds = (shape: string, width: number, height: number, depth: number) =>
      describePrimitive(shape, { width, height, depth }).parts.map((part: {
        id: string; position: number[]; size: number[]
      }) => ({ id: part.id, back: part.position[2] - part.size[2] / 2, front: part.position[2] + part.size[2] / 2 }))
    return { printer: bounds('printer', .4, .25, .35), tower: bounds('computerTower', .2, .4, .4) }
  })
  const part = (items: typeof surfaces.printer, id: string) => items.find((item) => item.id === id)!
  expect(part(surfaces.printer, 'body').front).toBeLessThan(part(surfaces.printer, 'slot').back)
  expect(part(surfaces.printer, 'slot').front).toBeLessThan(part(surfaces.printer, 'paper').back)
  expect(part(surfaces.printer, 'paper').front).toBeLessThanOrEqual(.35 / 2)
  expect(part(surfaces.tower, 'body').front).toBeLessThan(part(surfaces.tower, 'front').back)
  expect(part(surfaces.tower, 'front').front).toBeLessThan(part(surfaces.tower, 'vent-0').back)
})
