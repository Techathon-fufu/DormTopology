import { expect, test } from '@playwright/test'

const projectId = 'demo-dorm-101'

test('keeps object editing on the left and task guidance on the right', async ({ page }, testInfo) => {
  await page.goto(`/projects/${projectId}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  const tools = page.getByRole('complementary', { name: '物体与连线' })
  const guide = page.getByRole('complementary', { name: '引导与生成' })
  await expect(tools.getByRole('heading', { name: '场景物体' })).toBeVisible()
  await expect(guide.getByRole('button', { name: '生成整理方案' })).toBeVisible()
  await tools.getByRole('button', { name: /笔记本电脑/ }).first().click()
  await expect(tools.getByRole('heading', { name: '对象属性' })).toBeVisible()
  await expect(guide.getByRole('button', { name: '生成整理方案' })).toBeVisible()
  await expect(page.getByRole('button', { name: '查看整理演示' })).toBeVisible()
  await expect(page.getByText('执行指南', { exact: true })).toHaveCount(0)
  await page.screenshot({ path: testInfo.outputPath('workspace-desktop.png'), animations: 'disabled' })
})

test('rotates a selected object by ten degrees and supports undo', async ({ page }) => {
  await page.goto(`/projects/${projectId}/workspace`)
  const tools = page.getByRole('complementary', { name: '物体与连线' })
  await tools.getByRole('button', { name: /笔记本电脑/ }).first().click()

  const rotation = () => page.evaluate(async (id) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const projectUrl = resources.filter((url) => new URL(url).pathname === '/src/state/projectsStore.ts').at(-1)!
    const workspaceUrl = resources.filter((url) => new URL(url).pathname === '/src/state/workspaceStore.ts').at(-1)!
    const { useProjectsStore } = await import(projectUrl)
    const { useWorkspaceStore } = await import(workspaceUrl)
    const selectedId = useWorkspaceStore.getState().selectedId
    return useProjectsStore.getState().projects[id].objects.find((object) => object.id === selectedId)!.transform.rotationY
  }, projectId)

  const before = await rotation()
  await page.keyboard.press('e')
  await expect.poll(rotation).toBeCloseTo(before + Math.PI / 18, 6)
  await expect(page.getByRole('contentinfo')).toContainText('10°')
  await page.keyboard.press('Control+z')
  await expect.poll(rotation).toBeCloseTo(before, 6)
})

test('keeps saved layouts available to restore without showing comparison metrics', async ({ page }) => {
  await page.goto('/')
  const cleanId = `history-${crypto.randomUUID()}`
  await page.evaluate(async (id) => {
    const { createDemoProject } = await import('/src/data/demoProject.ts')
    const { useProjectsStore } = await import('/src/state/projectsStore.ts')
    const project = createDemoProject()
    project.id = id
    project.isDemo = false
    project.objects = [{ ...project.objects.find((object) => object.name === '笔记本电脑')!, projectId: id }]
    project.cables = []
    useProjectsStore.getState().upsert(project)
  }, cleanId)
  await page.goto(`/projects/${cleanId}/workspace`)
  const tools = page.getByRole('complementary', { name: '物体与连线' })
  await tools.getByRole('button', { name: /笔记本电脑/ }).first().click()
  const rotation = () => page.evaluate(async (id) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const projectUrl = resources.filter((url) => new URL(url).pathname === '/src/state/projectsStore.ts').at(-1)!
    const workspaceUrl = resources.filter((url) => new URL(url).pathname === '/src/state/workspaceStore.ts').at(-1)!
    const { useProjectsStore } = await import(projectUrl)
    const { useWorkspaceStore } = await import(workspaceUrl)
    const selectedId = useWorkspaceStore.getState().selectedId
    return useProjectsStore.getState().projects[id].objects.find((object) => object.id === selectedId)!.transform.rotationY
  }, cleanId)
  const before = await rotation()

  await page.locator('summary[aria-label="更多操作"]').click()
  await page.getByRole('button', { name: '保存当前方案' }).click()
  await page.keyboard.press('e')
  await expect.poll(rotation).toBeCloseTo(before + Math.PI / 18, 6)
  await page.locator('summary[aria-label="更多操作"]').click()
  await page.getByRole('button', { name: '历史方案' }).click()
  const history = page.getByRole('complementary', { name: '历史方案' })
  await expect(history.getByRole('button', { name: '恢复此方案' })).toBeVisible()
  await expect(history.getByText('桌面可用面积')).toHaveCount(0)
  await history.getByRole('button', { name: '恢复此方案' }).click()
  await expect(page.getByRole('contentinfo')).toContainText('已恢复')
  await expect.poll(rotation).toBeCloseTo(before, 6)
})

test('shows one cable planning action and keeps missing prerequisites clear', async ({ page }) => {
  await page.goto(`/projects/${projectId}/workspace`)
  await page.getByRole('complementary', { name: '物体与连线' }).getByRole('button', { name: '连线', exact: true }).click()
  const guide = page.getByRole('complementary', { name: '引导与生成' })
  await expect(guide.getByRole('button', { name: '规划走线', exact: true })).toBeDisabled()
  await guide.getByRole('checkbox', { name: '已核对物品尺寸、位置与接口' }).check()
  await expect(guide.getByRole('button', { name: '规划走线', exact: true })).toBeEnabled()
})

test('uses shared new-object defaults for additions while existing objects keep their size', async ({ page }) => {
  await page.goto(`/projects/${projectId}/workspace`)
  const tools = page.getByRole('complementary', { name: '物体与连线' })
  const read = () => page.evaluate(async (id) => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === '/src/state/projectsStore.ts').at(-1)!
    const { useProjectsStore } = await import(url)
    return useProjectsStore.getState().projects[id].objects.map((object) => ({ name: object.name, dimensions: object.dimensions }))
  }, projectId)
  const before = await read()
  await tools.getByRole('button', { name: '添加物体' }).click()
  await expect.poll(async () => (await read()).length).toBe(before.length + 1)
  const after = await read()
  expect(after).toHaveLength(before.length + 1)
  expect(after.find((object) => object.name === '笔记本电脑')?.dimensions).toEqual(before.find((object) => object.name === '笔记本电脑')?.dimensions)
  const custom = after.find((object) => object.name.startsWith('自定义物品'))
  expect(custom?.dimensions.width).toBeCloseTo(.1275, 6)
  expect(custom?.dimensions.height).toBeCloseTo(.085, 6)
  expect(custom?.dimensions.depth).toBeCloseTo(.085, 6)
})
