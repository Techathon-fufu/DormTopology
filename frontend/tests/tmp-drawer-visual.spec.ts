import { expect, test } from '@playwright/test'

// 临时视觉探针（用后删除）：从若干真实机位截图（关 / 开两态），检查抽屉外观与遮挡

test('visual probe of drawers', async ({ page }) => {
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  await expect
    .poll(async () =>
      page.evaluate(async () => {
        const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)
        if (!url) return 0
        const mod = await import(url)
        return mod.useDrawerStore.getState().loadedIds.length
      }),
    )
    .toBe(3)

  const setCamera = async (pos: [number, number, number], look: [number, number, number]) => {
    await page.evaluate(
      async ({ pos, look }) => {
        const names = performance.getEntriesByType('resource').map((e) => e.name)
        const fiberUrl = names.filter((n) => n.includes('@react-three_fiber')).at(-1)!
        const fiber = await import(fiberUrl)
        const roots = fiber._roots as Map<unknown, { getState?: () => any; store?: { getState: () => any } }>
        for (const [, root] of roots) {
          const state = root.getState ? root.getState() : root.store!.getState()
          state.camera.position.set(pos[0], pos[1], pos[2])
          state.camera.lookAt(look[0], look[1], look[2])
          state.controls?.target?.set?.(look[0], look[1], look[2])
        }
      },
      { pos, look },
    )
    await page.waitForTimeout(250)
  }

  const toggleTop = () =>
    page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/drawerStore.ts').at(-1)
      const mod = await import(url)
      mod.useDrawerStore.getState().toggle('top')
    })

  // A. 左前方斜视（房间内，用户可到达的机位）
  await setCamera([-1.05, 1.35, 1.95], [0.55, 0.6, 0.7])
  await page.screenshot({ path: 'test-results/vis-A-frontleft-closed.png', scale: 'css' })
  await toggleTop()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/vis-A-frontleft-open.png', scale: 'css' })

  // B. 正对柜体正面（-x 方向，近距离）
  await setCamera([-0.15, 0.85, 0.67], [0.9, 0.5, 0.67])
  await page.screenshot({ path: 'test-results/vis-B-front-open.png', scale: 'css' })

  // C. 透视默认机位（用户默认看到的）
  await page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new URL(n).pathname === '/src/state/workspaceStore.ts').at(-1)
    const mod = await import(url)
    mod.useWorkspaceStore.getState().applyViewPreset('persp')
  })
  await page.waitForTimeout(300)
  await page.screenshot({ path: 'test-results/vis-C-persp-open.png', scale: 'css' })
})
