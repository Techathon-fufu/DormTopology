import { expect, test, type Page } from '@playwright/test'

/**
 * 首页（/）验收：真实渲染、日夜外观、最近空间的紧凑单行条、全部项目与管理入口。
 * 只依赖前端本身，不需要后端服务；项目夹具全部由页面内 store 动态写入，不动内置示例。
 */

const THEME_KEY = 'dormtopology.home-theme'

async function moduleUrl(page: Page, path: string) {
  return page.evaluate((pathname) => {
    const resource = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === pathname).at(-1)
    if (!resource) throw new Error(`Module not loaded: ${pathname}`)
    return resource
  }, path)
}

/** 在页面内克隆示例项目，生成带长名称的临时项目，用于验证列表、溢出与删除保护。 */
async function seedProjects(page: Page, count = 10) {
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  const ids: string[] = await page.evaluate(async ({ url, count }) => {
    const { useProjectsStore } = await import(url)
    const store = useProjectsStore.getState()
    const base = store.projects['demo-dorm-101']
    const created: string[] = []
    for (let i = 0; i < count; i += 1) {
      const id = `home-regression-${i}-${crypto.randomUUID()}`
      const project = structuredClone(base)
      project.id = id
      project.isDemo = false
      project.name = `首页回归项目名称很长用于验证省略与布局-${i}`
      project.updatedAt = Date.now() - i * 1000
      project.objects?.forEach((object: { projectId: string }) => { object.projectId = id })
      project.cables?.forEach((cable: { projectId: string }) => { cable.projectId = id })
      store.upsert(project)
      created.push(id)
    }
    return created
  }, { url, count })
  return ids
}

async function projectCount(page: Page) {
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  return page.evaluate(async (modulePath) => {
    const { useProjectsStore } = await import(modulePath)
    return Object.keys(useProjectsStore.getState().projects).length
  }, url)
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

const SHOT_DIR = '../.work/home-refresh/shots'

test('renders hero, real scene image and both primary entries', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await expect(page.locator('.home-shell')).toBeVisible()
  await expect(page.getByRole('heading', { name: /让桌面/ })).toBeVisible()
  await expect(page.getByText('整理与理线，一目了然。')).toBeVisible()

  // 两张场景图（日/夜）同时存在，只有当前外观可见
  await expect(page.locator('.home-hero-art img')).toHaveCount(2)
  const image = page.locator(".home-hero-art img[data-active='true']")
  await expect(image).toHaveCount(1)
  await expect(image).toHaveJSProperty('complete', true)
  expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0)
  expect(await image.evaluate((img: HTMLImageElement) => img.getBoundingClientRect().width)).toBeGreaterThan(0)
  expect(await image.evaluate((img: HTMLImageElement) => getComputedStyle(img).opacity)).toBe('1')

  await expect(page.getByRole('button', { name: '体验示例' })).toBeVisible()
  await expect(page.getByRole('link', { name: '创建项目' })).toBeVisible()
  await expect(page.getByText('场景示意 · 非项目截图')).toBeVisible()
  await expectNoHorizontalOverflow(page)
  expect(errors).toEqual([])
})

test('follows system appearance, then keeps an explicit choice across reloads', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/')
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'dark')
  await expect(page.getByRole('button', { name: '深夜模式' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: '日间模式' }).click()
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'light')
  await expect(page.getByRole('button', { name: '日间模式' })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate((key) => localStorage.getItem(key), THEME_KEY)).toBe('light')

  // 手动选择后不再跟随系统
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'light')

  await page.reload()
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'light')

  // 清空存储后重新跟随系统
  await page.evaluate((key) => localStorage.removeItem(key), THEME_KEY)
  await page.reload()
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'dark')
})

test('keeps theme in memory when storage is blocked', async ({ page }) => {
  // 只让首页主题这一项的读写失败，模拟存储受限环境（不影响其他持久化内容）。
  await page.addInitScript((key) => {
    const blocked = () => { throw new DOMException('storage blocked', 'SecurityError') }
    const getItem = Storage.prototype.getItem
    const setItem = Storage.prototype.setItem
    Storage.prototype.getItem = function (name) { return name === key ? blocked() : getItem.call(this, name) }
    Storage.prototype.setItem = function (name, value) { if (name === key) blocked(); return setItem.call(this, name, value) }
  }, THEME_KEY)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: '深夜模式' }).click()
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'dark')
  // 客户端路由离开首页再返回（不是整页刷新）：存储不可用时仍保留手动选择
  await page.getByRole('link', { name: '创建项目' }).click()
  await expect(page).toHaveURL(/\/projects\/new$/)
  await page.goBack()
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'dark')
  expect(errors).toEqual([])
})

test('recovers when a failed storage write is later replaced by another tab', async ({ page, context }) => {
  // 只让写入失败（如配额不足），读取仍可用
  await page.addInitScript((key) => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('quota', 'QuotaExceededError')
      return setItem.call(this, name, value)
    }
  }, THEME_KEY)
  await page.goto('/')
  await page.getByRole('button', { name: '深夜模式' }).click()
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'dark')

  // 另一个标签页写入成功：本页必须采纳，而不是永久停在内存选择上
  const other = await context.newPage()
  await other.goto('/projects/new')
  await other.evaluate(([key]) => localStorage.setItem(key, 'light'), [THEME_KEY])
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'light')
  await other.close()
})

test('syncs appearance from another tab and after leaving the homepage', async ({ page, context }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '日间模式' }).click()
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'light')

  const other = await context.newPage()
  await other.goto('/projects/new')
  await other.evaluate(([key]) => localStorage.setItem(key, 'dark'), [THEME_KEY])
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'dark')

  // 离开首页期间其他标签页改动：客户端路由返回首页必须重新对齐（整页刷新不算）
  await page.getByRole('link', { name: '创建项目' }).click()
  await expect(page).toHaveURL(/\/projects\/new$/)
  await other.evaluate(([key]) => localStorage.setItem(key, 'light'), [THEME_KEY])
  await page.goBack()
  await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', 'light')

  await other.close()
})

test('keeps the recent bar compact and expands every space', async ({ page }) => {
  await page.goto('/')
  await seedProjects(page)
  await expect(page.locator('.home-recent-item')).toHaveCount(2)

  const bar = page.locator('.home-recent')
  const box = await bar.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeLessThanOrEqual(110)

  const names = await page.locator('.home-recent-name').evaluateAll((nodes) => nodes.map((node) => ({
    shown: node.getBoundingClientRect().width,
    scroll: node.scrollWidth,
    text: node.textContent ?? '',
  })))
  expect(names.every((name) => name.text.length > 0)).toBe(true)
  expect(names.every((name) => name.shown <= 171)).toBe(true)

  const toggle = page.getByRole('button', { name: '全部项目' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#all-spaces .home-space-row')).toHaveCount(11)
  await expectNoHorizontalOverflow(page)
})

test('honours the spaces query for direct links and header navigation', async ({ page }) => {
  // 桌面宽度才有头部“我的项目”入口（窄屏改由底部“全部项目”进入）
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/?spaces=all#all-spaces')
  await expect(page.locator('#all-spaces')).toBeVisible()
  await expect(page.getByRole('button', { name: '全部项目' })).toHaveAttribute('aria-expanded', 'true')

  await page.getByRole('link', { name: '我的项目' }).click()
  await expect(page.locator('#all-spaces')).toBeVisible()

  // 收起后 URL 同步清掉 spaces，浏览器后退可继续展开
  await page.getByRole('button', { name: '全部项目' }).click()
  await expect(page).not.toHaveURL(/spaces=all/)
  await page.goBack()
  await expect(page.locator('#all-spaces')).toBeVisible()
})

test('keeps project management entries and demo protection', async ({ page }) => {
  await page.goto('/?spaces=all#all-spaces')
  const demoRow = page.locator('#all-spaces .home-space-row').filter({ hasText: '示例' }).first()
  await expect(demoRow).toHaveCount(1)
  await demoRow.locator('.home-space-more').click()
  const menu = demoRow.locator('.home-space-menu')
  await expect(menu.getByRole('button', { name: '空间配置' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '照片与物品' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '查看整理动画' })).toBeVisible()
  await expect(menu.getByRole('button', { name: '删除项目' })).toHaveCount(0)

  await menu.getByRole('button', { name: '空间配置' }).click()
  await expect(page).toHaveURL(/\/setup$/)
  await expect(page.locator('.home-shell')).toHaveCount(0)
})

test('delete asks for confirmation and only removes the chosen project', async ({ page }) => {
  await page.goto('/')
  const ids = await seedProjects(page, 1)
  await page.goto('/?spaces=all#all-spaces')
  const before = await projectCount(page)
  const row = page.locator(`#all-spaces .home-space-row:has(a[href="/projects/${ids[0]}/workspace"])`)
  await expect(row).toHaveCount(1)

  page.once('dialog', (dialog) => dialog.dismiss())
  await row.locator('.home-space-more').click()
  await row.locator('.home-space-menu').getByRole('button', { name: '删除项目' }).click()
  await expect(row).toHaveCount(1)
  expect(await projectCount(page)).toBe(before)

  page.once('dialog', (dialog) => dialog.accept())
  await row.locator('.home-space-more').click()
  await row.locator('.home-space-menu').getByRole('button', { name: '删除项目' }).click()
  await expect(row).toHaveCount(0)
  expect(await projectCount(page)).toBe(before - 1)
})

test('new space entry opens the creation page', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: '创建项目' }).click()
  await expect(page).toHaveURL(/\/projects\/new$/)
})

test('takes day and night screenshots at desktop widths', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  // 仅桌面浏览器；768 及以下的小屏/手机视口已按产品范围废除。
  const viewports = [
    { name: '1440x1000', width: 1440, height: 1000 },
    { name: '1440x900', width: 1440, height: 900 },
    { name: '1366x768', width: 1366, height: 768 },
  ]
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto('/')
    for (const theme of ['light', 'dark'] as const) {
      await page.getByRole('button', { name: theme === 'light' ? '日间模式' : '深夜模式' }).click()
      await expect(page.locator('.home-shell')).toHaveAttribute('data-theme', theme)
      await expectNoHorizontalOverflow(page)
      // 等当前外观的场景图解码完成，避免截到过渡中的空白帧
      await page.locator('.home-hero-art img').evaluateAll(async (nodes) => {
        const active = nodes.find((node) => node.dataset.active === 'true') as HTMLImageElement | undefined
        if (active) await active.decode().catch(() => undefined)
      })
      await expect(page.locator(".home-hero-art img[data-active='true']")).toHaveJSProperty('complete', true)
      await page.screenshot({
        path: `${SHOT_DIR}/${testInfo.project.name}-${theme}-${viewport.name}.png`,
        animations: 'disabled',
      })
    }
  }
})

test('help panel closes with Escape and returns focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  const trigger = page.locator('.home-help > summary')
  await trigger.click()
  await expect(page.locator('.home-help-panel')).toBeVisible()
  // 执行指南已退场：帮助面板改为四步说明，不再挂指南/实验导出链接。
  await expect(page.locator('.home-help-panel').getByRole('heading', { name: '从照片到整洁桌面', exact: true })).toBeVisible()
  await expect(page.locator('.home-help-panel')).toContainText('4. 接受方案，跟着动画整理。')
  await page.keyboard.press('Escape')
  await expect(page.locator('.home-help-panel')).toBeHidden()
  await expect(trigger).toBeFocused()
})

// 移动端与小屏布局已按产品范围废除，相关手机视口用例一并退役（仅保留桌面 1440×1000 及以上）。
