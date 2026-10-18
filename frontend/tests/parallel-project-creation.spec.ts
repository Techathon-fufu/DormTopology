import { expect, test, type Page } from '@playwright/test'

async function projectStoreUrl(page: Page): Promise<string> {
  return page.evaluate(() => {
    const url = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .findLast((name) => new URL(name).pathname === '/src/state/projectsStore.ts')
    if (!url) throw new Error('projectsStore module was not loaded')
    return url
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('parallel-project-creation-initialized')) return
    localStorage.clear()
    sessionStorage.clear()
    sessionStorage.setItem('parallel-project-creation-initialized', 'true')
  })
})

test('creates and resumes one two-stage draft, then opens the completed project directly', async ({ page }) => {
  await page.goto('/projects/new')
  await expect(page).toHaveURL(/\/projects\/(proj-[^/]+)\/setup$/)
  const projectId = new URL(page.url()).pathname.split('/')[2]

  await expect(page.getByRole('navigation', { name: '创建项目' })).toContainText('项目与空间')
  await expect(page.getByRole('navigation', { name: '创建项目' })).toContainText('照片与物品')
  await expect(page.getByRole('navigation', { name: '创建项目' })).not.toContainText('工作台')
  await expect(page.getByRole('navigation', { name: '创建项目' })).not.toContainText('指南')

  await page.getByLabel('名称').fill('创建流程回归项目')
  await page.getByRole('button', { name: '保存并添加物品' }).click()
  await expect(page).toHaveURL(`/projects/${projectId}/import`)
  await expect(page.getByText('创建项目 · 2/2')).toBeVisible()

  await page.goto('/projects/new')
  await expect(page).toHaveURL(`/projects/${projectId}/import`)

  await page.getByRole('button', { name: '跳过识别，使用示例物品库' }).click()
  await page.reload()
  await expect(page.getByRole('button', { name: '完成创建，进入工作台' })).toBeVisible()
  await page.getByRole('button', { name: '完成创建，进入工作台' }).click()
  await expect(page).toHaveURL(`/projects/${projectId}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('created-workspace.png') })

  const storeUrl = await projectStoreUrl(page)
  const completed = await page.evaluate(async ({ storeUrl, projectId }) => {
    const { useProjectsStore } = await import(storeUrl)
    const state = useProjectsStore.getState()
    return { draft: Boolean(state.creationDrafts[projectId]), project: state.projects[projectId] }
  }, { storeUrl, projectId })
  expect(completed.draft).toBe(false)
  expect(completed.project.stage).toBe('organize')
  expect(completed.project.objects.length).toBeGreaterThan(0)
  expect(completed.project.name).toBe('创建流程回归项目')

  await page.goto(`/projects/${projectId}/setup`)
  await expect(page.getByText('项目设置')).toBeVisible()
  await expect(page.getByRole('navigation', { name: '创建项目' })).toHaveCount(0)
  await page.getByRole('button', { name: '返回工作台' }).click()
  await expect(page).toHaveURL(`/projects/${projectId}/workspace`)
})

test('redirects an unfinished project away from the workspace until creation is complete', async ({ page }) => {
  await page.goto('/projects/new')
  await expect(page).toHaveURL(/\/projects\/(proj-[^/]+)\/setup$/)
  const projectId = new URL(page.url()).pathname.split('/')[2]

  await page.goto(`/projects/${projectId}/workspace`)
  await expect(page).toHaveURL(`/projects/${projectId}/setup`)

  const storeUrl = await projectStoreUrl(page)
  await page.evaluate(async ({ storeUrl, projectId }) => {
    const { useProjectsStore } = await import(storeUrl)
    const store = useProjectsStore.getState()
    store.update(projectId, (project) => ({ ...project, stage: 'assets' }))
    store.completeCreationDraft(projectId)
  }, { storeUrl, projectId })
  await page.goto(`/projects/${projectId}/workspace`)
  await expect(page).toHaveURL(`/projects/${projectId}/workspace`)
})

for (const hasDraft of [false, true]) {
  test(`migrates v4 ${hasDraft ? 'creation drafts' : 'completed legacy projects'} without losing saved objects`, async ({ page }) => {
    await page.goto('/projects/new')
    await expect(page).toHaveURL(/\/projects\/(proj-[^/]+)\/setup$/)
    const projectId = new URL(page.url()).pathname.split('/')[2]
    await page.getByLabel('名称').fill('旧版创建数据')
    await page.getByRole('button', { name: '保存并添加物品' }).click()
    await page.getByRole('button', { name: '跳过识别，使用示例物品库' }).click()
    const saved = await page.evaluate(({ projectId, hasDraft }) => {
      const data = JSON.parse(localStorage.getItem('dormtopology.projects')!)
      data.version = 4
      if (!hasDraft) delete data.state.creationDrafts
      localStorage.setItem('dormtopology.projects', JSON.stringify(data))
      sessionStorage.removeItem('dormtopology.project-creation-draft')
      return data.state.projects[projectId]
    }, { projectId, hasDraft })

    await page.goto('/')
    const storeUrl = await projectStoreUrl(page)
    const restored = await page.evaluate(async ({ storeUrl, projectId }) => {
      const { useProjectsStore } = await import(storeUrl)
      const state = useProjectsStore.getState()
      return {
        project: state.projects[projectId],
        draft: Boolean(state.creationDrafts[projectId]),
        version: JSON.parse(localStorage.getItem('dormtopology.projects')!).version,
      }
    }, { storeUrl, projectId })
    expect(restored.version).toBe(5)
    expect(restored.project).toEqual(saved)
    expect(restored.draft).toBe(hasDraft)

    await page.goto(`/projects/${projectId}/workspace`)
    await expect(page).toHaveURL(`/projects/${projectId}/${hasDraft ? 'import' : 'workspace'}`)
    if (hasDraft) {
      await page.goto('/projects/new')
      await expect(page).toHaveURL(`/projects/${projectId}/import`)
      await page.getByRole('button', { name: '完成创建，进入工作台' }).click()
      await expect(page).toHaveURL(`/projects/${projectId}/workspace`)
    } else {
      await page.goto(`/projects/${projectId}/setup`)
      await page.getByLabel('名称').fill('旧项目更新名称')
      await page.getByRole('button', { name: '撤销未保存改动' }).click()
      await expect(page.getByLabel('名称')).toHaveValue('旧版创建数据')
      await page.getByLabel('名称').fill('旧项目更新名称')
      await page.getByRole('button', { name: '保存并返回工作台' }).click()
      await expect(page).toHaveURL(`/projects/${projectId}/workspace`)
      await page.goto(`/projects/${projectId}/import`)
      await expect(page.getByRole('navigation', { name: '创建项目' })).toHaveCount(0)
      await page.getByRole('button', { name: '返回三维工作台' }).click()
      await expect(page).toHaveURL(`/projects/${projectId}/workspace`)
    }
  })
}

test('an older tab preserves other tabs draft records when saving an unrelated project', async ({ page }) => {
  await page.goto('/')
  const storeUrl = await projectStoreUrl(page)
  const state = await page.evaluate(async (storeUrl) => {
    const { useProjectsStore } = await import(storeUrl)
    const storage = useProjectsStore.persist.getOptions().storage!
    const key = 'parallel-project-creation-storage-check'
    const initial = { state: { projects: {}, creationDrafts: {} }, version: 5 }
    localStorage.setItem(key, JSON.stringify(initial))
    await storage.getItem(key)
    localStorage.setItem(key, JSON.stringify({
      state: { projects: { remote: { name: '另一个标签页的项目' } }, creationDrafts: { remote: true } },
      version: 5,
    }))
    await storage.setItem(key, {
      state: { projects: { local: { name: '当前标签页的项目' } }, creationDrafts: { local: true } },
      version: 5,
    })
    const value = JSON.parse(localStorage.getItem(key)!).state
    localStorage.removeItem(key)
    return value
  }, storeUrl)
  expect(Object.keys(state.projects).sort()).toEqual(['local', 'remote'])
  expect(state.creationDrafts).toEqual({ local: true, remote: true })
})
