import { expect, test } from '@playwright/test'

const boxDimensions = { width: 0.1, height: 0.1, depth: 0.1 }

async function createBoxProject(page: import('@playwright/test').Page, id: string) {
  await page.goto('/')
  await page.evaluate(async (args) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const demoUrl = resources.filter((name) => new URL(name).pathname === '/src/data/demoProject.ts').at(-1)!
    const projectsUrl = resources.filter((name) => new URL(name).pathname === '/src/state/projectsStore.ts').at(-1)!
    const { createDemoProject } = await import(demoUrl)
    const { useProjectsStore } = await import(projectsUrl)
    const project = createDemoProject()
    project.id = args.id
    project.isDemo = false
    project.objects = [{
      ...project.objects.find((object) => object.name === '笔记本电脑')!,
      id: 'obj-box',
      projectId: args.id,
      name: '普通收纳盒',
      category: 'nonElectrical',
      dimensions: args.dimensions,
      transform: { position: [-.4, .75, .4], rotationY: 0 },
      ports: [],
      fixed: false,
      locked: false,
      baseDimensions: undefined,
      model: { status: 'none', shape: 'genericBox' },
      powerStrip: undefined,
    }]
    project.cables = []
    const withDrafts = project as { creationDrafts?: unknown }
    delete withDrafts.creationDrafts
    useProjectsStore.getState().upsert(project)
  }, { id, dimensions: boxDimensions })
}

async function readObject(page: import('@playwright/test').Page, projectId: string) {
  return page.evaluate(async (id) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const projectsUrl = resources.filter((name) => new URL(name).pathname === '/src/state/projectsStore.ts').at(-1)!
    const workspaceUrl = resources.filter((name) => new URL(name).pathname === '/src/state/workspaceStore.ts').at(-1)!
    const { useProjectsStore } = await import(projectsUrl)
    const { useWorkspaceStore } = await import(workspaceUrl)
    const selectedId = useWorkspaceStore.getState().selectedId
    const object = useProjectsStore.getState().projects[id].objects.find((item) => item.id === selectedId)!
    return { dimensions: object.dimensions, baseDimensions: object.baseDimensions ?? null }
  }, projectId)
}

test('shrinks a non-electrical box, captures base dimensions, and supports undo/redo/reset', async ({ page }) => {
  const projectId = `scale-${crypto.randomUUID()}`
  await createBoxProject(page, projectId)
  await page.goto(`/projects/${projectId}/workspace`)

  const tools = page.getByRole('complementary', { name: '物体与连线' })
  await tools.getByRole('button', { name: /普通收纳盒/ }).first().click()
  const scale = tools.locator('section', { hasText: '等比缩放' })
  await expect(scale).toBeVisible()

  await tools.getByRole('button', { name: '缩小' }).click()
  await expect.poll(async () => (await readObject(page, projectId)).baseDimensions?.width).toBeCloseTo(boxDimensions.width, 6)
  const shrunk = await readObject(page, projectId)
  expect(shrunk.dimensions.width).toBeCloseTo(boxDimensions.width * 0.95, 6)
  expect(shrunk.dimensions.height).toBeCloseTo(boxDimensions.height * 0.95, 6)
  expect(shrunk.dimensions.depth).toBeCloseTo(boxDimensions.depth * 0.95, 6)
  expect(shrunk.baseDimensions?.height).toBeCloseTo(boxDimensions.height, 6)
  expect(shrunk.baseDimensions?.depth).toBeCloseTo(boxDimensions.depth, 6)

  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await readObject(page, projectId)).dimensions.width).toBeCloseTo(boxDimensions.width, 6)

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => (await readObject(page, projectId)).dimensions.width).toBeCloseTo(boxDimensions.width * 0.95, 6)

  await scale.getByRole('button', { name: '重置' }).click()
  await expect.poll(async () => (await readObject(page, projectId)).dimensions.width).toBeCloseTo(boxDimensions.width, 6)
  const reset = await readObject(page, projectId)
  expect(reset.dimensions.width).toBeCloseTo(boxDimensions.width, 6)
  expect(reset.dimensions.height).toBeCloseTo(boxDimensions.height, 6)
  expect(reset.dimensions.depth).toBeCloseTo(boxDimensions.depth, 6)
  expect(reset.baseDimensions?.width).toBeCloseTo(boxDimensions.width, 6)
})

test('persists baseline and dimensions across reload', async ({ page }) => {
  const projectId = `scale-${crypto.randomUUID()}`
  await createBoxProject(page, projectId)
  await page.goto(`/projects/${projectId}/workspace`)

  const tools = page.getByRole('complementary', { name: '物体与连线' })
  await tools.getByRole('button', { name: /普通收纳盒/ }).first().click()
  await tools.getByRole('button', { name: '缩小' }).click()
  await expect.poll(async () => (await readObject(page, projectId)).dimensions.width).toBeCloseTo(boxDimensions.width * 0.95, 6)

  await page.reload()
  const toolsAfter = page.getByRole('complementary', { name: '物体与连线' })
  await toolsAfter.getByRole('button', { name: /普通收纳盒/ }).first().click()
  const persisted = await readObject(page, projectId)
  expect(persisted.dimensions.width).toBeCloseTo(boxDimensions.width * 0.95, 6)
  expect(persisted.dimensions.height).toBeCloseTo(boxDimensions.height * 0.95, 6)
  expect(persisted.dimensions.depth).toBeCloseTo(boxDimensions.depth * 0.95, 6)
  expect(persisted.baseDimensions?.width).toBeCloseTo(boxDimensions.width, 6)
  expect(persisted.baseDimensions?.height).toBeCloseTo(boxDimensions.height, 6)
  expect(persisted.baseDimensions?.depth).toBeCloseTo(boxDimensions.depth, 6)
})

test('excludes a power strip from scale controls', async ({ page }) => {
  const projectId = `scale-${crypto.randomUUID()}`
  await page.goto('/')
  await page.evaluate(async (id) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name)
    const demoUrl = resources.filter((name) => new URL(name).pathname === '/src/data/demoProject.ts').at(-1)!
    const projectsUrl = resources.filter((name) => new URL(name).pathname === '/src/state/projectsStore.ts').at(-1)!
    const { createDemoProject } = await import(demoUrl)
    const { useProjectsStore } = await import(projectsUrl)
    const project = createDemoProject()
    project.id = id
    project.isDemo = false
    const strip = project.objects.find((object) => object.model.shape === 'powerStrip' || object.powerStrip)!
    project.objects = [{ ...strip, id: 'obj-strip', projectId: id }]
    project.cables = []
    const withDrafts = project as { creationDrafts?: unknown }
    delete withDrafts.creationDrafts
    useProjectsStore.getState().upsert(project)
  }, projectId)

  await page.goto(`/projects/${projectId}/workspace`)
  const tools = page.getByRole('complementary', { name: '物体与连线' })
  await tools.getByRole('button', { name: /排插/ }).first().click()
  await expect(tools.getByText('等比缩放')).toHaveCount(0)
  await expect(tools.getByRole('button', { name: '缩小' })).toHaveCount(0)
})
