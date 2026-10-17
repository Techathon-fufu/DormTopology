import { expect, test, type Page } from '@playwright/test'

/**
 * Surface port marking & connection regressions.
 *
 * These tests drive the real React Three Fiber canvas with real pointer events.
 * Screen coordinates are derived from the live GL camera via the module URL that
 * Vite actually served (read from performance resource entries) — no internals
 * are mutated to fake a raycast hit or a successful save. Store access is used
 * only for setup (cloning the demo project to a unique id) and for observing
 * the persisted result.
 *
 * The final scenario talks to a real Python service and is gated behind
 * PLAYWRIGHT_REAL_ORGANIZATION=1. It never mocks the routing request.
 */

test.setTimeout(90_000)
test.beforeEach(async ({page}) => {
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.goto('/', {waitUntil:'domcontentloaded'})
  await page.evaluate(async()=>{ await import('/src/state/projectsStore.ts') })
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  await page.evaluate(url => { (window as any).__projectsUrl = url }, url)
})

async function moduleUrl(page: Page, pathname: string): Promise<string> {
  return page.evaluate((path) => {
    const resource = performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === path)
      .at(-1)
    if (!resource) throw new Error(`Module not loaded: ${path}`)
    return resource
  }, pathname)
}

async function readProject(page: Page, id: string, path = '/src/state/projectsStore.ts') {
  const url = await moduleUrl(page, path)
  return page.evaluate(
    async ({ url, id }) => {
      const mod = await import(url)
      const store = mod.useProjectsStore
      return store.getState().projects[id]
    },
    { url, id },
  )
}

async function bindCamera(page: Page) {
  const urls = await page.evaluate(() => performance.getEntriesByType('resource').map(e=>e.name))
  const r3fUrl = urls.find(url => new URL(url).pathname.endsWith('/@react-three_fiber.js'))
  if (!r3fUrl) throw new Error('R3F module not loaded')
  const storeUrl = await moduleUrl(page, '/src/state/workspaceStore.ts')
  const projectsUrl = await moduleUrl(page, '/src/state/projectsStore.ts')
  await page.evaluate(async ({r3fUrl,storeUrl,projectsUrl}) => {
    ;(window as any).__ws = await import(storeUrl)
    ;(window as any).__r3f = await import(r3fUrl)
    ;(window as any).__projectsUrl = projectsUrl
  },{r3fUrl,storeUrl,projectsUrl})
}
async function project(page:Page,world:[number,number,number]) {
  // 相机预设是带动画的：等它稳定后再投影，否则算出的屏幕点会落到别处（历史 flake 来源）。
  await page.evaluate(() => new Promise<void>((resolve) => {
    const canvas = document.querySelector('canvas')!
    const cam = (window as any).__r3f._roots.get(canvas).store.getState().camera
    let previous = cam.position.clone()
    let stable = 0
    let frames = 0
    const tick = () => {
      frames += 1
      const moved = cam.position.distanceTo(previous)
      previous = cam.position.clone()
      stable = moved < 1e-5 ? stable + 1 : 0
      if (stable >= 3 || frames > 120) { resolve(); return }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }))
  return page.evaluate(world=> {
    const canvas=document.querySelector('canvas')!
    const cam=(window as any).__r3f._roots.get(canvas).store.getState().camera
    const point=cam.position.clone().set(...world).project(cam)
    const rect=canvas.getBoundingClientRect()
    return {x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2}
  },world)
}

async function cloneDemo(page: Page, name: string): Promise<string> {
  const url = await moduleUrl(page, '/src/state/projectsStore.ts')
  const id = `${name}-${crypto.randomUUID()}`
  await page.evaluate(
    async ({ url, id, name }) => {
      const { useProjectsStore } = await import(url)
      const {createDemoProject}=await import('/src/data/demoProject.ts')
      const project=createDemoProject()
      project.id = id
      project.name = name
      project.cables = []
      project.objects=[{...project.objects[0],id:id+'-placeholder',projectId:id,model:{status:'placeholder',source:'demo',shape:'genericBox'},ports:[]}]
      useProjectsStore.getState().upsert(project)
    },
    { url, id, name },
  )
  return id
}

async function openWorkspace(page: Page, id: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`/projects/${id}/workspace`, {waitUntil:'domcontentloaded'})
  await expect(page.locator('canvas')).toBeVisible()
  await bindCamera(page)
}

async function setFrontView(page: Page) {
  await page.evaluate(async () => {
    const store = (window as unknown as { __ws: any }).__ws
    store.useWorkspaceStore.getState().applyViewPreset('front')
  })
  // Let the camera effect + a couple of frames settle.
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

/**
 * 桌面主入口：右键目标物品 →「表面描点」，进入全屏描点页面。
 * 页面是会话态覆盖层（不切路由），所以 canvas 仍是同一个实例。
 */
async function openMarkingPage(page: Page, world: [number, number, number]) {
  const target = await project(page, world)
  await page.mouse.click(target.x, target.y, { button: 'right' })
  await page.getByRole('menuitem', { name: /表面描点/ }).click()
  await expect(page.getByRole('region', { name: '表面描点页面' })).toBeVisible()
}

test.describe('surface port marking', () => {
  test.skip(({isMobile})=>isMobile,'Full surface editing is a desktop acceptance flow')
  test('marks a real surface point, persists metadata and cancels drafts', async ({ page }) => {
    const id = await cloneDemo(page, 'surface-ports')
    await openWorkspace(page, id)

    // Add one visible generic box on the main desk; no prefab ports/cables.
    await page.evaluate(async ({ id }) => {
      const { useProjectsStore } = await import(
        (window as unknown as { __projectsUrl: string }).__projectsUrl,
      )
      const project = useProjectsStore.getState().projects[id]
      project.objects = [
        {
          id: `${id}-box`,
          projectId: id,
          name: 'Surface Box',
          category: 'nonElectrical',
          model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
          dimensions: { width: 0.35, height: 0.3, depth: 0.3 },
          transform: { position: [0, 0.75, 0.3], rotationY: 0 },
          ports: [],
          source: 'manual',
          frequent: false,
          fixed: false,
          locked: false,
          visible: true,
        },
      ]
      useProjectsStore.getState().upsert(project)
    }, { id })

    await page.goto(`/projects/${id}/workspace`, {waitUntil:'domcontentloaded'})
    await expect(page.locator('canvas')).toBeVisible()
    await bindCamera(page)
    await setFrontView(page)

    const boxId = `${id}-box`
    const object = await readProject(page, id)
    expect(object.objects).toHaveLength(1)

    // Open the marking page from the object's context menu.
    await openMarkingPage(page, [0, 0.9, 0.45])
    const select = page.getByLabel('标记物品')
    await expect(select).toHaveValue(boxId)
    await page.getByRole('button', { name: '在表面标记接口' }).click()
    await expect(page.getByText('请点击')).toBeVisible({ timeout: 10_000 })

    // Real click on the projected front surface point.
    const target = await project(page, [0, 0.9, 0.45])
    await page.mouse.move(target.x,target.y)
    await expect.poll(()=>page.evaluate(async()=>{const {useConnectionsStore}=await import('/src/features/connections/store.ts');return useConnectionsStore.getState().hover?.objectId})).toBe(boxId)
    await page.mouse.down()
    await expect.poll(()=>page.evaluate(async()=>{const {useConnectionsStore}=await import('/src/features/connections/store.ts');return useConnectionsStore.getState().pointerActive})).toBe(true)
    await page.mouse.up()

    const dialog = page.getByRole('dialog', { name: '编辑接口标记' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByLabel('标记名称').fill('USB-C Front')
    await dialog.getByLabel('标记说明').fill('front facing port')
    await dialog.getByLabel('接口类型').selectOption('usb-c')
    await dialog.getByRole('button', { name: '保存接口' }).click()

    await expect(page.getByText('接口已保存')).toBeVisible({ timeout: 10_000 })
    const saved = await readProject(page, id)
    const box = saved.objects.find((o: { id: string }) => o.id === boxId)
    expect(box.ports).toHaveLength(1)
    const port = box.ports[0]
    expect(port.type).toBe('usb-c')
    expect(port.confirmed).toBe(false)
    expect(port.label).toBe('USB-C Front')
    expect(port.note).toBe('front facing port')
    const dir = port.localDirection
    const dirLen = Math.hypot(dir[0], dir[1], dir[2])
    expect(dirLen).toBeCloseTo(1, 2)
    // 屏幕坐标量化到整像素：同一次真实点击的世界坐标存在约 1mm 误差，按 5mm 容差断言。
    expect(port.offset[1]).toBeCloseTo(.15,2)
    expect(port.offset[2]).toBeCloseTo(.15,2)
    await page.screenshot({path:'.work/surface-connections/surface-port-desktop.png'})

    // Reload -> label persists.
    await page.reload()
    await expect(page.locator('canvas')).toBeVisible()
    const reloaded = await readProject(page, id)
    const reloadedBox = reloaded.objects.find((o: { id: string }) => o.id === boxId)
    expect(reloadedBox.ports).toHaveLength(1)
    expect(reloadedBox.ports[0].label).toBe('USB-C Front')

    // Editing then cancelling via Escape must not mutate saved data.
    await bindCamera(page)
    await setFrontView(page)
    await openMarkingPage(page, [0, 0.9, 0.45])
    await page.getByRole('button', { name: '编辑标记' }).click()
    const editDialog = page.getByRole('dialog', { name: '编辑接口标记' })
    await expect(editDialog).toBeVisible()
    await editDialog.getByLabel('标记名称').fill('SHOULD NOT SAVE')
    await page.keyboard.press('Escape')
    await expect(editDialog).toBeHidden()
    const afterCancel = await readProject(page, id)
    expect(afterCancel.objects.find((o: { id: string }) => o.id === boxId).ports[0].label).toBe('USB-C Front')

    await bindCamera(page)
    await setFrontView(page)
    // Pointer-drag of 30px in pick mode must not create or move anything.
    await page.getByRole('button', { name: '在表面标记接口' }).click()
    const beforeDrag = await readProject(page, id)
    const start = await project(page, [0, 0.9, 0.45])
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + 30, start.y, { steps: 5 })
    await page.mouse.up()
    await page.keyboard.press('Escape')
    const afterDrag = await readProject(page, id)
    expect(afterDrag.objects.find((o: { id: string }) => o.id === boxId).ports).toHaveLength(1)
    expect(afterDrag.objects.find((o: { id: string }) => o.id === boxId).transform).toEqual(
      beforeDrag.objects.find((o: { id: string }) => o.id === boxId).transform,
    )
    // Reposition the same endpoint, keeping unsaved metadata and stable references.
    await setFrontView(page)
    await page.getByRole('button',{name:'编辑标记'}).click()
    const relocating=page.getByRole('dialog',{name:'编辑接口标记'})
    await relocating.getByLabel('标记说明').fill('保留尚未保存的说明')
    await relocating.getByRole('button',{name:'重新描点'}).click()
    const nextPoint=await project(page,[.05,.93,.45])
    await page.mouse.move(nextPoint.x,nextPoint.y)
    await expect.poll(()=>page.evaluate(async()=>{const {useConnectionsStore}=await import('/src/features/connections/store.ts');return Boolean(useConnectionsStore.getState().hover)})).toBe(true)
    await page.mouse.down()
    await expect.poll(()=>page.evaluate(async()=>{const {useConnectionsStore}=await import('/src/features/connections/store.ts');return useConnectionsStore.getState().pointerActive})).toBe(true)
    await page.mouse.up()
    await expect(relocating.getByLabel('标记说明')).toHaveValue('保留尚未保存的说明')
    await relocating.getByRole('button',{name:'保存接口'}).click()
    const moved=(await readProject(page,id)).objects[0].ports[0]
    expect(moved.id).toBe(port.id)
    expect(moved.offset[0]).toBeCloseTo(.05,2)
    expect(moved.note).toBe('保留尚未保存的说明')
    // A concurrent dimension edit must invalidate the original draft snapshot.
    await page.getByRole('button',{name:'编辑标记'}).click()
    await relocating.getByLabel('标记名称').fill('过期草稿不可写入')
    await page.evaluate(async({id,boxId})=>{
      const {useWorkspaceStore}=await import('/src/state/workspaceStore.ts')
      useWorkspaceStore.getState().updateObject(id,boxId,{dimensions:{width:.36}})
    },{id,boxId})
    await relocating.getByRole('button',{name:'保存接口'}).click()
    await expect(relocating).toBeHidden()
    await expect(page.getByText('物品在编辑期间已变化，请重新描点。',{exact:true})).toBeVisible()
    expect((await readProject(page,id)).objects[0].ports[0].label).toBe('USB-C Front')
  })

  test('local coordinates on a rotated box differ from world coordinates', async ({ page }) => {
    const id = await cloneDemo(page, 'surface-rotated')
    await openWorkspace(page, id)
    await page.evaluate(async ({ id }) => {
      const { useProjectsStore } = await import(
        (window as unknown as { __projectsUrl: string }).__projectsUrl,
      )
      const project = useProjectsStore.getState().projects[id]
      project.objects = [
        {
          id: `${id}-rot`,
          projectId: id,
          name: 'Rotated Box',
          category: 'nonElectrical',
          model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
          dimensions: { width: 0.3, height: 0.3, depth: 0.3 },
          transform: { position: [0, 0.75, 0.3], rotationY: Math.PI / 4 },
          ports: [],
          source: 'manual',
          frequent: false,
          fixed: false,
          locked: false,
          visible: true,
        },
      ]
      useProjectsStore.getState().upsert(project)
    }, { id })
    await page.goto(`/projects/${id}/workspace`, {waitUntil:'domcontentloaded'})
    await expect(page.locator('canvas')).toBeVisible()
    await bindCamera(page)
    await setFrontView(page)

    await page.getByRole('button', { name: '规划走线', exact: true }).click()
    await page.getByRole('button', { name: '描点与连接检查' }).click()
    await expect(page.getByRole('region', { name: '表面描点页面' })).toBeVisible()
    await page.getByRole('button', { name: '在表面标记接口' }).click()
    const target = await project(page, [0, 0.9, 0.45])
    await page.mouse.move(target.x,target.y)
    await expect.poll(()=>page.evaluate(async()=>{const {useConnectionsStore}=await import('/src/features/connections/store.ts');return Boolean(useConnectionsStore.getState().hover)})).toBe(true)
    await page.mouse.click(target.x, target.y)
    const dialog = page.getByRole('dialog', { name: '编辑接口标记' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByLabel('标记名称').fill('Rotated Port')
    await dialog.getByRole('button', { name: '保存接口' }).click()
    await expect(page.getByText('接口已保存')).toBeVisible({ timeout: 10_000 })
    const saved = await readProject(page, id)
    const port = saved.objects[0].ports[0]
    expect(port.offset.some((n: number, i: number) => Math.abs(n) > 1e-6)).toBe(true)
    expect(port.localDirection).toHaveLength(3)
  })

  test('deleting a referenced port is blocked while an unreferenced port is removed', async ({ page }) => {
    const id = await cloneDemo(page, 'surface-delete')
    await openWorkspace(page, id)
    await page.evaluate(async ({ id }) => {
      const { useProjectsStore } = await import(
        (window as unknown as { __projectsUrl: string }).__projectsUrl,
      )
      const project = useProjectsStore.getState().projects[id]
      const base = structuredClone(project.objects[0])
      const mk = (suffix: string, x: number) => ({
        ...structuredClone(base),
        id: `${id}-${suffix}`,
        projectId: id,
        name: `Box ${suffix}`,
        category: 'nonElectrical' as const,
        model: { status: 'placeholder' as const, source: 'demo' as const, shape: 'genericBox' as const },
        dimensions: { width: 0.2, height: 0.2, depth: 0.2 },
        transform: { position: [x, 0.75, 0.3] as [number, number, number], rotationY: 0 },
        ports: [
          {
            id: `${id}-${suffix}-port`,
            label: `${suffix}-port`,
            type: 'usb-c' as const,
            powered: false,
            offset: [0, 0, 0.1] as [number, number, number],
            localDirection: [0, 0, 1] as [number, number, number],
            confirmed: true,
          },
        ],
        source: 'manual' as const,
        frequent: false,
        fixed: false,
        locked: false,
        visible: true,
      })
      project.objects = [mk('a', -0.2), mk('b', 0.2)]
      project.cables = [
        {
          id: `${id}-cable`, projectId:id, status:'existing', accessories:[],
          kind: 'data',
          from: { objectId: `${id}-a`, portId: `${id}-a-port` },
          to: { objectId: `${id}-b`, portId: `${id}-b-port` },
          route: { channels:[], points: [[-0.2, 0.85, 0.3], [0.2, 0.85, 0.3]] },
        },
      ]
      useProjectsStore.getState().upsert(project)
    }, { id })
    await page.goto(`/projects/${id}/workspace`, {waitUntil:'domcontentloaded'})
    await expect(page.locator('canvas')).toBeVisible()

    await page.getByRole('button', { name: '规划走线', exact: true }).click()
    await page.getByRole('button', { name: '描点与连接检查' }).click()
    const select = page.getByLabel('标记物品')
    await select.selectOption(`${id}-a`)
    await page.getByRole('button', { name: '删除接口 a-port', exact: false }).click()
    await expect(page.getByText('接口仍被线缆引用')).toBeVisible()
    const stillThere = await readProject(page, id)
    expect(stillThere.objects.find((o: { id: string }) => o.id === `${id}-a`).ports).toHaveLength(1)
    expect(stillThere.cables).toHaveLength(1)
  })
})

test.describe('real service routing', () => {
  test.skip(({isMobile})=>isMobile,'Full routing editing is a desktop acceptance flow')
  test('plans candidates from the real backend without mocking and preserves project until acceptance', async ({ page }) => {
    test.skip(process.env.PLAYWRIGHT_REAL_ORGANIZATION !== '1', 'Requires a real Python backend')
    test.setTimeout(120_000)
    const id = await cloneDemo(page, 'surface-routing')
    await openWorkspace(page, id)

    await page.evaluate(async ({ id }) => {
      const { useProjectsStore } = await import(
        (window as unknown as { __projectsUrl: string }).__projectsUrl,
      )
      const project = useProjectsStore.getState().projects[id]
      const port = (oid: string) => ({
        id: oid,
        label: oid,
        type: 'hdmi' as const,
        powered: false,
        offset: [0, 0.28, -0.04] as [number, number, number],
        localDirection: [0, 0, -1] as [number, number, number],
        confirmed: true,
      })
      project.objects = [
        {
          id: `${id}-left`,
          projectId: id,
          name: 'HDMI Left',
          category: 'electrical',
          model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
          dimensions: { width: 0.08, height: 0.4, depth: 0.08 },
          transform: { position: [-0.35, 0.75, 0.19], rotationY: 0 },
          ports: [port(`${id}-left-port`)],
          source: 'manual',
          frequent: false,
          fixed: false,
          locked: false,
          visible: true,
        },
        {
          id: `${id}-right`,
          projectId: id,
          name: 'HDMI Right',
          category: 'electrical',
          model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
          dimensions: { width: 0.08, height: 0.4, depth: 0.08 },
          transform: { position: [0.35, 0.75, 0.19], rotationY: 0 },
          ports: [port(`${id}-right-port`)],
          source: 'manual',
          frequent: false,
          fixed: false,
          locked: false,
          visible: true,
        },
      ]
      project.cables = [
        {
          id: `${id}-cable`, projectId:id, status:'existing', accessories:[],
          kind: 'video',
          thickness: 'thin',
          reserveLengthM: 0.05,
          visibility: 'hidden',
          from: { objectId: `${id}-left`, portId: `${id}-left-port` },
          to: { objectId: `${id}-right`, portId: `${id}-right-port` },
          route: { channels:[], points: [] },
        },
      ]
      useProjectsStore.getState().upsert(project)
    }, { id })
    await page.goto(`/projects/${id}/workspace`, {waitUntil:'domcontentloaded'})
    await expect(page.locator('canvas')).toBeVisible()
    await bindCamera(page)

    await page.getByRole('button', { name: '规划走线', exact: true }).click()
    await page.getByRole('checkbox', { name: '已核对尺寸、位置与接口' }).check()

    const before = await readProject(page,id)
    const planned = page.waitForResponse(
      (response) => response.request().method() === 'POST' && response.url().endsWith('/api/v1/cables/plan'),
      { timeout: 60_000 },
    )
    await page.getByRole('button', { name: '规划全部走线（真实后端）' }).click()
    const response = await planned
    expect(response.status()).toBe(202)

    await expect(page.getByText('理线方案预览（本地）', {exact:true})).toBeVisible({ timeout: 60_000 })
    const preview = await readProject(page, id)
    expect(preview.cables).toEqual(before.cables)

    await page.getByRole('button', { name: '接受理线方案' }).click()
    await expect.poll(async () => (await readProject(page,id)).cables[0].route.verification?.status, {timeout:30000}).toBe('valid')

    // Local project now reflects accepted cables; the GET scene still works.
    const sceneCheck = await page.request.get(`/api/v1/projects/${id}/scene`)
    expect(sceneCheck.status()).toBe(200)
    await page.screenshot({path:'.work/surface-connections/routing-accepted-desktop.png'})
  })
})

test('mobile can inspect saved endpoint annotations and scene connection review', async ({page,isMobile}) => {
  test.skip(!isMobile,'Mobile viewing acceptance')
  const id=await cloneDemo(page,'surface-mobile')
  const url=await moduleUrl(page,'/src/state/projectsStore.ts')
  await page.evaluate(async({url,id})=>{
    const {useProjectsStore}=await import(url)
    const p=useProjectsStore.getState().projects[id]
    p.objects[0].name='手机查看设备'
    p.objects[0].ports=[{id:id+'-port',label:'数据接口',note:'背面的数据连接口',type:'usb-c',powered:false,confirmed:true,offset:[0,.1,.17],localDirection:[0,0,1]}]
    useProjectsStore.getState().upsert(p)
  },{url,id})
  await page.goto(`/projects/${id}/workspace`,{waitUntil:'domcontentloaded'})
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button',{name:'规划走线',exact:true}).click()
  if (!await page.getByRole('button',{name:'描点与连接检查'}).first().isVisible()) await page.getByRole('button',{name:'打开物品面板',exact:true}).click()
  const drawer=page.getByRole('dialog',{name:'物品与线缆面板'})
  await drawer.getByRole('button',{name:'描点与连接检查'}).click()
  const marking=page.getByRole('region',{name:'表面描点页面'})
  await expect(marking).toBeVisible()
  await expect(marking.getByText('背面的数据连接口',{exact:true})).toBeVisible()
  await expect(marking.getByText(/全场检查 · 1 件物品/)).toBeVisible()
  await expect(marking.getByText(/存在可选物理接口|尚未建立连接/)).toBeVisible()
  await page.screenshot({path:'.work/surface-connections/surface-mobile.png'})
})

test('picks a loaded GLB with edited dimensions and rotation using its actual mesh', async ({page,isMobile})=>{
  test.skip(isMobile,'Desktop surface editing')
  const id=await cloneDemo(page,'surface-glb')
  const url=await moduleUrl(page,'/src/state/projectsStore.ts')
  await page.evaluate(async({url,id})=>{
    const {useProjectsStore}=await import(url)
    const {createDemoProject}=await import('/src/data/demoProject.ts')
    const p=useProjectsStore.getState().projects[id]
    const monitor=createDemoProject().objects.find((o:any)=>o.id==='demo-monitor')!
    p.objects=[{...monitor,projectId:id,ports:[],dimensions:{width:.48,height:.44,depth:.16},transform:{position:[0,.75,.3],rotationY:.35}}]
    useProjectsStore.getState().upsert(p)
  },{url,id})
  await openWorkspace(page,id)
  await setFrontView(page)
  await expect.poll(()=>page.evaluate(()=>{
    const canvas=document.querySelector('canvas')!
    return Boolean((window as any).__r3f._roots.get(canvas).store.getState().scene.getObjectByName('Monitor_27_Inch'))
  }),{timeout:15000}).toBe(true)
  const before=await readProject(page,id)
  await openMarkingPage(page,[0,1.05,.45])
  await page.getByRole('button',{name:'在表面标记接口'}).click()
  const point=await project(page,[0,1.05,.45])
  await page.mouse.move(point.x,point.y)
  await expect.poll(()=>page.evaluate(async()=>{const {useConnectionsStore}=await import('/src/features/connections/store.ts');return Boolean(useConnectionsStore.getState().hover)})).toBe(true)
  await page.mouse.down()
  await expect.poll(()=>page.evaluate(async()=>{const {useConnectionsStore}=await import('/src/features/connections/store.ts');return useConnectionsStore.getState().pointerActive})).toBe(true)
  await page.mouse.up()
  const editor=page.getByRole('dialog',{name:'编辑接口标记'})
  await expect(editor).toBeVisible()
  await editor.getByLabel('标记名称').fill('真实模型表面接口')
  await editor.getByRole('button',{name:'保存接口'}).click()
  const after=await readProject(page,id)
  expect(after.objects[0].model).toEqual(before.objects[0].model)
  expect(after.objects[0].dimensions).toEqual(before.objects[0].dimensions)
  const port=after.objects[0].ports[0]
  expect(port.offset[0]).toBeGreaterThanOrEqual(-.245)
  expect(port.offset[0]).toBeLessThanOrEqual(.245)
  expect(port.offset[1]).toBeGreaterThan(.15)
  expect(port.offset[1]).toBeLessThanOrEqual(.445)
  expect(Math.abs(port.offset[2])).toBeLessThanOrEqual(.085)
  expect(Math.hypot(...port.localDirection)).toBeCloseTo(1,6)
  await page.screenshot({path:'.work/surface-connections/glb-picking.png'})
})
