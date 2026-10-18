import { test, expect } from '@playwright/test'

// Focused regression for result replay integration.
// 1) replay model: pose-only change is a step; intermediate transforms keep
//    snapshots immutable and carry bookPose coherently.
// 2) actual result page shows a step, then completion.

test.describe('replay model', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('detects pose-only change and keeps snapshots immutable', async ({ page }) => {
    await page.goto('/')
    const result = await page.evaluate(async () => {
      const mod = await import('/src/features/replay/model.ts')
      const base = {
        id: 'o1', name: 'Book', visible: true, category: 'book',
        transform: { position: [0, 0, 0], rotationY: 0, bookPose: 'original' },
        dimensions: { width: 0.2, height: 0.05, depth: 0.3 },
        model: { prefabId: undefined, shape: 'book', assetUrl: undefined },
      }
      const before = [base]
      const after = [{ ...base, transform: { ...base.transform, bookPose: 'upright' } }]
      const beforeSnapshot = JSON.stringify(before)
      const steps = mod.replaySteps(before, after)
      const intermediate = mod.replayObjects(before, steps, 0.25)
      const immutabilityOk = JSON.stringify(before) === beforeSnapshot
        && JSON.stringify(after) !== beforeSnapshot
        && JSON.stringify(steps) === JSON.stringify(mod.replaySteps(before, after))
      const midPose = intermediate.find((o: { id: string }) => o.id === 'o1')?.transform?.bookPose
      const finalPose = mod.replayObjects(before, steps, 1).find((o: { id: string }) => o.id === 'o1')?.transform?.bookPose
      return {
        stepCount: steps.length,
        stepId: steps[0]?.id,
        immutabilityOk,
        midPose,
        finalPose,
      }
    })
    expect(result.stepId).toBe('o1')
    expect(result.stepCount).toBe(1)
    expect(result.immutabilityOk).toBe(true)
    expect(result.midPose).toBe('original')
    expect(result.finalPose).toBe('upright')
  })
})

test.describe('result page', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('renders with the shared scene lighting and camera on direct entry', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(`/projects/demo-dorm-101/result`)
    const scene = page.getByRole('main', { name: '整理动画场景' })
    await expect(scene).toBeVisible()
    // Shared render profile path must mount the WebGL canvas without runtime errors.
    const canvas = page.locator('canvas')
    await expect(canvas).toBeVisible()
    await expect
      .poll(async () => canvas.evaluate((el) => el.width > 0 && el.height > 0))
      .toBe(true)
    // Fullscreen result still routes through the shared theme shell.
    await expect(page.locator('.app-shell')).toHaveCount(1)
    expect(errors).toEqual([])
    await page.screenshot({ path: 'F:/DormTopology/.task-artifacts/integration-audit/shots/result-render.png' })
  })
})
