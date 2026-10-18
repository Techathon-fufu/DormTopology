import { expect, test } from '@playwright/test'

const THEME_KEY = 'dormtopology.home-theme'
const SHOT_DIR = '../.work/frontend-visual/shots'

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
})

test('keeps one theme across the homepage and public project pages', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '深夜模式' }).click()

  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'dark')
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe('dark')

  await page.getByRole('link', { name: '创建项目' }).first().click()
  await expect(page).toHaveURL(/\/projects\/new$/)
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')
  await expect(page.getByRole('button', { name: '深夜模式' })).toHaveAttribute('aria-pressed', 'true')

  const colors = await page.evaluate(() => ({
    body: getComputedStyle(document.body).backgroundColor,
    shell: getComputedStyle(document.querySelector('.app-shell') as HTMLElement).backgroundColor,
  }))
  expect(colors.body).toBe('rgb(22, 25, 28)')
  expect(colors.shell).toBe('rgb(22, 25, 28)')

  await page.reload()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', 'dark')
})

test('shows a concise public flow and hides internal or retired entries', async ({ page }) => {
  await page.goto('/')
  await page.locator('.home-help > summary').click()
  const homeHelp = page.locator('.home-help-panel')
  await expect(homeHelp).toContainText('创建项目')
  await expect(homeHelp).toContainText('在工作台调整整理与理线方案')
  await expect(homeHelp).toContainText('跟随动画，在现实场景中完成整理')
  await expect(homeHelp).not.toContainText('导出指南')
  await expect(homeHelp.locator('a[href="/algorithm-lab"], a[href="/workflow"]')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '全部空间' }).click()
  await expect(page.locator('a[href="/algorithm-lab"], a[href="/workflow"]')).toHaveCount(0)

  const demoRow = page.locator('#all-spaces .home-space-row').filter({ hasText: '示例' }).first()
  await demoRow.locator('.home-space-more').click()
  await expect(demoRow.getByRole('button', { name: '查看执行指南' })).toHaveCount(0)

  await page.goto('/projects/new')
  await page.locator('.app-icon-button[aria-label="使用帮助"]').click()
  const shellHelp = page.locator('.app-popover')
  await expect(shellHelp).toContainText('三步开始整理')
  await expect(shellHelp).not.toContainText('导出指南')
})

test('keeps visible keyboard focus and readable error tokens in both themes', async ({ page }) => {
  await page.goto('/projects/new')
  const brand = page.getByRole('link', { name: '寝空拓扑首页' })
  await brand.focus()

  const focus = await brand.evaluate((node) => {
    const style = getComputedStyle(node)
    return { style: style.outlineStyle, width: style.outlineWidth, color: style.outlineColor }
  })
  expect(focus.style).toBe('solid')
  expect(focus.width).toBe('2px')
  expect(focus.color).not.toBe('rgba(0, 0, 0, 0)')

  await page.getByRole('button', { name: '深夜模式' }).click()
  const danger = await page.evaluate(() => getComputedStyle(document.documentElement)
    .getPropertyValue('--app-danger').trim())
  expect(danger).toBe('#ff9a93')
})

test('captures the shared light and dark desktop surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  for (const theme of ['light', 'dark'] as const) {
    await page.goto('/')
    await page.getByRole('button', { name: theme === 'light' ? '日间模式' : '深夜模式' }).click()
    await page.locator('.home-hero-art img').evaluateAll(async (images) => {
      const active = images.find((image) => image.dataset.active === 'true') as HTMLImageElement | undefined
      if (active) await active.decode().catch(() => undefined)
    })
    await page.screenshot({ path: `${SHOT_DIR}/home-${theme}-1440x1000.png`, animations: 'disabled' })

    await page.goto('/projects/new')
    await expect(page.locator('.app-shell')).toHaveAttribute('data-theme', theme)
    await page.screenshot({ path: `${SHOT_DIR}/create-${theme}-1440x1000.png`, animations: 'disabled' })
  }
})
