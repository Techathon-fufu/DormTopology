import { expect, test, type Page } from '@playwright/test'

test.setTimeout(60_000)
test.beforeEach(({ isMobile }) => {
  test.skip(isMobile, 'Independent model marking is a desktop-only flow')
})

async function setup(page: Page) {
  await page.goto('/')
  const id = `isolated-${crypto.randomUUID()}`
  await page.evaluate(async (id) => {
    const { createDemoProject } = await import('/src/data/demoProject.ts')
    const { useProjectsStore } = await import('/src/state/projectsStore.ts')
    const p = createDemoProject()
    p.id = id
    p.isDemo = false
    p.cables = []
    const base = p.objects[0]
    p.objects = [
      { ...base, id: 'target', projectId: id, name: '独立标记物品', ports: [], visible: true,
        dimensions: { width: .32, height: .3, depth: .24 },
        transform: { position: [0, .75, .3], rotationY: .6 },
        model: { status: 'placeholder', source: 'demo', shape: 'genericBox' } },
      { ...base, id: 'other', projectId: id, name: '不应显示的物品', ports: [],
        transform: { position: [-.4, .75, .3], rotationY: 0 } },
    ]
    useProjectsStore.getState().upsert(p)
  }, id)
  return id
}

async function readProject(page: Page, id: string) {
  return page.evaluate(async (id) => {
    const { useProjectsStore } = await import('/src/state/projectsStore.ts')
    return useProjectsStore.getState().projects[id]
  }, id)
}

async function sceneInfo(page: Page) {
  return page.evaluate(async () => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname.endsWith('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const { scene, camera } = _roots.get(document.querySelector('canvas')).store.getState()
    const objects: string[] = []
    let outsideMeshes = 0
    scene.traverse((node: any) => {
      if (node.name === 'isolated-model') objects.push(node.userData.objectId)
      if (!node.isMesh) return
      let parent = node.parent
      while (parent && parent.name !== 'isolated-model') parent = parent.parent
      if (!parent) outsideMeshes++
    })
    return { objects, outsideMeshes, camera: camera.position.toArray() }
  })
}

async function point(page: Page, coordinates: number[]) {
  return page.evaluate(async (coordinates) => {
    const url = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname.endsWith('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const canvas = document.querySelector('canvas')!
    const { camera } = _roots.get(canvas).store.getState()
    const p = camera.position.clone().set(...coordinates).project(camera)
    const box = canvas.getBoundingClientRect()
    return { x: box.left + (p.x + 1) * box.width / 2, y: box.top + (1 - p.y) * box.height / 2 }
  }, coordinates)
}

test('isolates the selected model, saves local ports and returns with undo history', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const id = await setup(page)
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  const before = await readProject(page, id)
  await page.evaluate(async () => {
    const { useWorkspaceStore } = await import('/src/state/workspaceStore.ts')
    useWorkspaceStore.getState().applyViewPreset('front')
  })
  await page.waitForTimeout(250)
  const at = await point(page, [0, .9, .44])
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.getByRole('menuitem', { name: '表面描点', exact: false }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/objects/target/ports$`))
  await expect.poll(async () => (await sceneInfo(page)).objects).toEqual(['target'])
  expect((await sceneInfo(page)).outsideMeshes).toBe(0)
  await page.goBack()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/workspace$`))
  await page.goForward()
  await expect.poll(async () => (await sceneInfo(page)).objects).toEqual(['target'])
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.waitForTimeout(200)
  const surface = await point(page, [.04, .16, .12])
  await page.mouse.click(surface.x, surface.y)
  const dialog = page.getByRole('dialog', { name: '编辑接口标记' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('标记名称').fill('测试受电口')
  await expect(dialog.getByLabel('接口类型')).toHaveValue('power-ac')
  await expect(dialog.getByRole('checkbox', { name: '受电口（电源输入）' })).toBeChecked()
  await page.screenshot({ path: testInfo.outputPath('default-power-input.png') })
  await dialog.getByRole('button', { name: '保存接口', exact: true }).click()
  const saved = await readProject(page, id)
  expect(saved.objects[0].ports).toHaveLength(1)
  const port = saved.objects[0].ports[0]
  expect(port.offset[0]).toBeCloseTo(.04, 2)
  expect(port.offset[1]).toBeCloseTo(.16, 2)
  expect(port.offset[2]).toBeCloseTo(.12, 3)
  expect(port.localDirection).toEqual([0, 0, 1])
  expect(port.type).toBe('power-ac')
  expect(port.powered).toBe(true)
  for (let i = 0; i < before.objects.length; i++) {
    expect(saved.objects[i].transform).toEqual(before.objects[i].transform)
    expect(saved.objects[i].dimensions).toEqual(before.objects[i].dimensions)
  }
  expect(saved.room).toEqual(before.room)
  expect(saved.objects[1]).toEqual(before.objects[1])
  await page.screenshot({ path: testInfo.outputPath('isolated-model.png') })
  const canvas = await page.locator('canvas').boundingBox()
  const panel = await page.getByRole('complementary', { name: '接口标记设置' }).boundingBox()
  expect(canvas!.height).toBeGreaterThan(200)
  expect(canvas!.width).toBeGreaterThan(250)
  expect(canvas!.x + canvas!.width <= panel!.x + 1).toBe(true)

  await page.getByRole('button', { name: '返回工作台', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/workspace$`))
  await page.keyboard.press('Control+z')
  expect((await readProject(page, id)).objects[0].ports).toHaveLength(0)
  await page.keyboard.press('Control+Shift+z')
  expect((await readProject(page, id)).objects[0].ports[0].id).toBe(port.id)
  await page.goto(`/projects/${id}/objects/target/ports`)
  await page.reload()
  await expect(page.getByText('测试受电口 · 待确认', { exact: true })).toBeVisible()
  await expect.poll(async () => (await sceneInfo(page)).objects).toEqual(['target'])
  await page.getByLabel('标记物品', { exact: true }).selectOption('other')
  await expect(page).toHaveURL(/\/objects\/other\/ports$/)
  await expect.poll(async () => (await sceneInfo(page)).objects).toEqual(['other'])
  expect((await readProject(page, id)).objects[0].ports[0].id).toBe(port.id)
  await page.getByLabel('标记物品', { exact: true }).selectOption('target')
  await page.getByRole('button', { name: '编辑标记', exact: true }).click()
  await dialog.getByLabel('标记名称').fill('保存后返回的受电口')
  await dialog.getByRole('button', { name: '保存并返回工作台', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/workspace$`))
  const returned = await readProject(page, id)
  expect(returned.objects[0].ports[0].label).toBe('保存后返回的受电口')
  expect(returned.objects[0].ports[0].id).toBe(port.id)
  expect(returned.objects[0].transform).toEqual(before.objects[0].transform)
  expect(errors).toEqual([])
})

test('keeps an existing port type, powered flag and id when its metadata or location is edited', async ({ page }) => {
  const id = await setup(page)
  await page.evaluate(async (id) => {
    const { useProjectsStore } = await import('/src/state/projectsStore.ts')
    const p = useProjectsStore.getState().projects[id]
    const target = p.objects[0]
    target.ports = [{
      id: 'existing-usb-c',
      label: '既有数据口',
      offset: [0, .15, .12],
      localDirection: [0, 0, 1],
      type: 'usb-c',
      powered: false,
      confirmed: true,
    }]
    useProjectsStore.getState().upsert(p)
  }, id)

  await page.goto(`/projects/${id}/objects/target/ports`)
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.waitForTimeout(200)

  await page.getByRole('button', { name: '编辑标记', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '编辑接口标记' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('标记名称').fill('已编辑数据口')
  await expect(dialog.getByLabel('接口类型')).toHaveValue('usb-c')
  await expect(dialog.getByRole('checkbox', { name: '受电口（电源输入）' })).not.toBeChecked()
  await dialog.getByRole('button', { name: '保存接口', exact: true }).click()
  const edited = (await readProject(page, id)).objects[0].ports[0]
  expect(edited.id).toBe('existing-usb-c')
  expect(edited.type).toBe('usb-c')
  expect(edited.powered).toBe(false)
  expect(edited.confirmed).toBe(true)
  expect(edited.offset).toEqual([0, .15, .12])

  await page.getByRole('button', { name: '编辑标记', exact: true }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '重新描点', exact: true }).click()
  await expect(dialog).toBeHidden()
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.waitForTimeout(200)
  const at = await point(page, [.03, .15, .12])
  await page.mouse.click(at.x, at.y)
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '保存接口', exact: true }).click()
  const relocated = (await readProject(page, id)).objects[0].ports[0]
  expect(relocated.id).toBe('existing-usb-c')
  expect(relocated.type).toBe('usb-c')
  expect(relocated.powered).toBe(false)
  expect(relocated.confirmed).toBe(false)
  expect(relocated.offset[0]).toBeCloseTo(.03, 2)
  expect(relocated.offset[1]).toBeCloseTo(.15, 2)
  expect(relocated.offset[2]).toBeCloseTo(.12, 3)
})

test('orbit drag and cancelled edits do not move items or save ports; linking returns to workspace', async ({ page }) => {
  const id = await setup(page)
  await page.goto(`/projects/${id}/objects/target/ports`)
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: '正面', exact: true }).click()
  await page.waitForTimeout(200)
  const before = await readProject(page, id)
  const cameraBefore = (await sceneInfo(page)).camera
  const at = await point(page, [0, .15, .12])
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 75, at.y + 25, { steps: 12 })
  await page.mouse.up()
  await expect(page.getByRole('dialog', { name: '编辑接口标记' })).toBeHidden()
  expect((await sceneInfo(page)).camera).not.toEqual(cameraBefore)
  await page.keyboard.press('q')
  await page.keyboard.press('Delete')
  expect((await readProject(page, id)).objects).toEqual(before.objects)
  await page.getByRole('button', { name: '背面', exact: true }).click()
  await page.waitForTimeout(200)
  const back = await point(page, [0, .15, -.12])
  await page.mouse.click(back.x, back.y)
  const dialog = page.getByRole('dialog', { name: '编辑接口标记' })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel('标记名称').fill('不保存')
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  expect((await readProject(page, id)).objects).toEqual(before.objects)
  await page.getByRole('button', { name: '在表面标记接口' }).click()
  await page.mouse.click(back.x, back.y)
  await dialog.getByLabel('标记名称').fill('背部接口')
  await dialog.getByRole('checkbox', { name: '受电口（电源输入）' }).uncheck()
  await dialog.getByRole('button', { name: '保存接口', exact: true }).click()
  expect((await readProject(page, id)).objects[0].ports[0].localDirection).toEqual([0, 0, -1])
  expect((await readProject(page, id)).objects[0].ports[0].powered).toBe(false)
  await page.getByRole('button', { name: '确认接口', exact: true }).click()
  await page.getByRole('button', { name: '以此点连线', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/projects/${id}/workspace$`))
  expect(await page.evaluate(async () => {
    const { useCableStore } = await import('/src/state/cableStore.ts')
    return useCableStore.getState().linkFrom?.objectId
  })).toBe('target')
  await page.goto(`/projects/${id}/objects/missing/ports`)
  await expect(page.getByText('物品不存在或已被删除', { exact: true })).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(0)
})
