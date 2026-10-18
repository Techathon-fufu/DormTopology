import { expect, test, type Page } from '@playwright/test'

async function sceneCheck(page: Page, operation: 'ready' | 'rays' | 'camera', cameraPosition?: number[]) {
  return page.evaluate(async ({ operation, cameraPosition }) => {
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => new URL(name).pathname.endsWith('/@react-three_fiber.js'))!
    const { _roots } = await import(url)
    const state = _roots.get(document.querySelector('canvas')).store.getState()
    const meshes: any[] = []
    state.scene.traverse((node: any) => {
      if (node.isMesh && ['MousepadMaterial', 'MonitorWhiteMaterial', 'RoundedBoxMaterial'].includes(node.material?.name)) meshes.push(node)
    })
    if (operation === 'ready') return meshes.length
    if (operation === 'camera') {
      state.controls.enableDamping = false
      state.camera.position.set(...cameraPosition!)
      state.controls.target.set(0, .76, .5)
      state.controls.update()
      state.invalidate()
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      const rect = document.querySelector('canvas')!.getBoundingClientRect()
      const angle = .1 + Math.PI / 2
      const phonePoints = [[0, 0], [-.04, -.015], [-.04, .015], [.04, -.015], [.04, .015]]
        .map(([x, z]) => [Math.cos(angle) * x + Math.sin(angle) * z, .757, .5 - Math.sin(angle) * x + Math.cos(angle) * z])
      return [...phonePoints, [-.25, .751, .58], [.35, .765, .415]].map(coordinates => {
        const p = state.camera.position.clone().set(...coordinates).project(state.camera)
        return { x: (p.x + 1) * rect.width / 2, y: (1 - p.y) * rect.height / 2 }
      })
    }
    // Use Three's actual front-face raycasting, independently of the repair's
    // volume calculation. Derive its Raycaster from the one already in the scene.
    const ray = state.raycaster.clone ? state.raycaster.clone() : new state.raycaster.constructor()
    return [[0, .5], [-.25, .58], [.35, .415]].map(([x, z]) => {
      const origin = state.camera.position.clone().set(x, .85, z)
      const direction = origin.clone().set(0, -1, 0)
      ray.set(origin, direction)
      const hit = ray.intersectObjects(meshes, false)[0]
      return hit?.point.y ?? null
    })
  }, { operation, cameraPosition })
}

async function pixelSamples(page: Page, points: Array<{ x: number; y: number }>) {
  const bytes = await page.locator('canvas').screenshot({ scale: 'css' })
  return page.evaluate(async ({ png, points }) => {
    const image = new Image()
    image.src = `data:image/png;base64,${png}`
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.width; canvas.height = image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    return points.map(p => {
      const values = ctx.getImageData(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3).data
      return [0, 1, 2].map(c => Array.from({ length: 9 }, (_, i) => values[i * 4 + c]).reduce((s, v) => s + v, 0) / 9)
    })
  }, { png: bytes.toString('base64'), points })
}

test('phone, mousepad and monitor base retain their visible tops against the desk across orbit angles', async ({ page }, info) => {
  test.setTimeout(60_000)
  if (process.env.THIN_CONTACT_BASELINE === '1') {
    await page.route('**/src/scene/ObjectModel.tsx*', async route => {
      const response = await route.fetch()
      await route.fulfill({ response, body: (await response.text()).replace(/repairPrefabWinding\(scene\);?/g, '') })
    })
  }
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  const id = `thin-contact-${crypto.randomUUID()}`
  await page.evaluate(async id => {
    const url = performance.getEntriesByType('resource').map(e => e.name)
      .filter(name => new URL(name).pathname === '/src/state/projectsStore.ts').at(-1)!
    const { useProjectsStore } = await import(url)
    const project = structuredClone(useProjectsStore.getState().projects['demo-dorm-101'])
    const monitor = project.objects.find((o: any) => o.model.prefabId === 'monitor')
    const phone = project.objects.find((o: any) => o.model.prefabId === 'phone')
    const pad = structuredClone(monitor)
    project.id = id; project.name = '薄模型接触面回归'; project.isDemo = false; project.cables = []
    monitor.id = 'contact-monitor'; monitor.projectId = id; monitor.ports = []
    monitor.transform = { position: [.25, .75, .35], rotationY: 0 }
    pad.id = 'contact-pad'; pad.projectId = id; pad.name = '1mm 鼠标垫'; pad.ports = []
    pad.dimensions = { width: .3, height: .001, depth: .3 }
    pad.transform = { position: [-.25, .75, .58], rotationY: 0 }
    pad.model = { ...pad.model, prefabId: 'mousepad', assetUrl: 'models/items/mousepad.glb', shape: 'genericBox' }
    phone.id = 'contact-phone'; phone.projectId = id; phone.ports = []
    phone.transform = { position: [0, .75, .5], rotationY: .1 + Math.PI / 2 }
    project.objects = [pad, monitor, phone]
    useProjectsStore.getState().upsert(project)
  }, id)
  await page.goto(`/projects/${id}/workspace`)
  await expect.poll(() => sceneCheck(page, 'ready')).toBe(3)
  await sceneCheck(page, 'camera', [0, 1.25, 1.5])
  await page.screenshot({ path: info.outputPath('thin-contact-before-check.png'), scale: 'css' })
  const tops = await sceneCheck(page, 'rays') as number[]
  expect(tops[0], '7mm phone must render its top, rather than the bottom at desk height').toBeCloseTo(.757, 6)
  expect(tops[1], '1mm pad must render its top, rather than the bottom at desk height').toBeCloseTo(.751, 6)
  expect(tops[2], '15mm base must render its top, rather than the bottom at desk height').toBeCloseTo(.765, 6)

  const views = [[0, 1.05, 1.5], [-.65, .88, 1.4], [.75, .9, 1.5], [-.6, 1.5, 1.7], [.8, 1.4, 1.8]]
  for (const [i, position] of views.entries()) {
    const points = await sceneCheck(page, 'camera', position) as Array<{ x: number; y: number }>
    const withDesk = await pixelSamples(page, points)
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(e => e.name).filter(n => new URL(n).pathname === '/src/state/deskModelStore.ts').at(-1)!
      const { useDeskModelStore } = await import(url)
      useDeskModelStore.getState().setShowDesk(false)
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    })
    const withoutDesk = await pixelSamples(page, points)
    withDesk.forEach((color, item) => color.forEach((value, channel) => {
      expect(Math.abs(value - withoutDesk[item][channel]), `view ${i}, item ${item}: desk must not replace the object's top pixels`).toBeLessThan(8)
    }))
    await page.evaluate(async () => {
      const url = performance.getEntriesByType('resource').map(e => e.name).filter(n => new URL(n).pathname === '/src/state/deskModelStore.ts').at(-1)!
      const { useDeskModelStore } = await import(url)
      useDeskModelStore.getState().setShowDesk(true)
    })
  }
  await sceneCheck(page, 'camera', [0, 1.25, 1.5])
  const image = info.outputPath('thin-contact-fixed.png')
  await page.screenshot({ path: image, scale: 'css' })
  await info.attach('thin-contact-fixed', { path: image, contentType: 'image/png' })
  expect(errors).toEqual([])
})
