import { expect, test, type Page } from '@playwright/test'

const PROJECT_ID = 'parallel-model-quality'

async function sceneProbe(page: Page, operation: 'ready' | 'rays' | 'camera', cameraPosition?: number[]) {
  return page.evaluate(async ({ operation, cameraPosition }) => {
    const fiberUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname.endsWith('/@react-three_fiber.js'))!
    const { _roots } = await import(fiberUrl)
    const state = _roots.get(document.querySelector('canvas')).store.getState()
    const contactMaterials = new Set(['GreenMugMaterial', 'RoundedBoxMaterial', 'MousepadMaterial', 'MonitorWhiteMaterial'])
    const meshes: any[] = []
    state.scene.traverse((node: any) => {
      const materials = Array.isArray(node.material) ? node.material : [node.material]
      if (node.isMesh && materials.some((material: any) => contactMaterials.has(material?.name))) meshes.push(node)
    })
    if (operation === 'ready') return {
      greenMugMeshes: meshes.filter((mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
        .some((material: any) => material?.name === 'GreenMugMaterial')).length,
      total: meshes.length,
    }
    if (operation === 'camera') {
      state.controls.enableDamping = false
      state.camera.position.set(...cameraPosition!)
      state.controls.target.set(0, .76, .4)
      state.controls.update()
      state.invalidate()
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
      return true
    }
    const ray = state.raycaster.clone ? state.raycaster.clone() : new state.raycaster.constructor()
    return [[-.55, .25], [-.35, .45], [-.12, .55], [0, .3], [.2, .55], [.65, .365]].map(([x, z]) => {
      ray.set(state.camera.position.clone().set(x, 1.6, z), state.camera.position.clone().set(0, -1, 0))
      return ray.intersectObjects(meshes, false)[0]?.point.y ?? null
    })
  }, { operation, cameraPosition })
}

async function visibleDesktopNames(page: Page) {
  return page.evaluate(async () => {
    const fiberUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname.endsWith('/@react-three_fiber.js'))!
    const { _roots } = await import(fiberUrl)
    const state = _roots.get(document.querySelector('canvas')).store.getState()
    const names: string[] = []
    state.scene.traverse((node: any) => {
      if (node.isMesh && node.visible && node.name.startsWith('Desk_Top_')) names.push(node.name)
    })
    return names.sort()
  })
}

test('cup and URL-imported models keep visible contact surfaces across desk views', async ({ page }, info) => {
  test.setTimeout(60_000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/projects/demo-dorm-101/workspace')
  await expect(page.locator('canvas')).toBeVisible()
  await page.evaluate(async (projectId) => {
    const storeUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === '/src/state/projectsStore.ts').at(-1)!
    const { useProjectsStore } = await import(storeUrl)
    const project = structuredClone(useProjectsStore.getState().projects['demo-dorm-101'])
    const byPrefab = (id: string) => structuredClone(project.objects.find((object: any) => object.model.prefabId === id))
    const cup = byPrefab('cup'), importedCup = byPrefab('cup'), localCup = byPrefab('cup'), phone = byPrefab('phone')
    const monitor = byPrefab('monitor'), pad = byPrefab('monitor')
    project.id = projectId; project.name = '模型接触面专项回归'; project.isDemo = false; project.cables = []
    cup.id = 'quality-cup'; cup.projectId = projectId; cup.ports = []; cup.transform = { position: [-.55, .75, .25], rotationY: 0 }
    importedCup.id = 'quality-import'; importedCup.projectId = projectId; importedCup.name = 'URL 导入杯体'; importedCup.ports = []
    importedCup.transform = { position: [-.35, .75, .45], rotationY: 0 }
    importedCup.model = { status: 'ready', source: 'generated', format: 'glb', assetUrl: 'models/items/cup.glb', shape: 'cup' }
    const idbUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === '/src/state/storage/idb.ts').at(-1) ?? '/src/state/storage/idb.ts'
    const { putFile } = await import(idbUrl)
    await putFile('modelFiles', 'quality-local-cup', await (await fetch('/models/items/cup.glb')).blob())
    localCup.id = 'quality-local'; localCup.projectId = projectId; localCup.name = '本地导入杯体'; localCup.ports = []
    localCup.transform = { position: [-.12, .75, .55], rotationY: 0 }
    localCup.model = { status: 'ready', source: 'generated', format: 'glb', assetId: 'quality-local-cup', shape: 'cup' }
    phone.id = 'quality-phone'; phone.projectId = projectId; phone.ports = []; phone.transform = { position: [0, .75, .3], rotationY: 0 }
    pad.id = 'quality-pad'; pad.projectId = projectId; pad.name = '1mm 鼠标垫'; pad.ports = []
    pad.dimensions = { width: .3, height: .001, depth: .3 }; pad.transform = { position: [.2, .75, .55], rotationY: 0 }
    pad.model = { ...pad.model, prefabId: 'mousepad', assetUrl: 'models/items/mousepad.glb', shape: 'genericBox' }
    monitor.id = 'quality-monitor'; monitor.projectId = projectId; monitor.ports = []; monitor.transform = { position: [.55, .75, .3], rotationY: 0 }
    project.objects = [cup, importedCup, localCup, phone, pad, monitor]
    useProjectsStore.getState().upsert(project)
  }, PROJECT_ID)
  await page.goto(`/projects/${PROJECT_ID}/workspace`)
  await expect.poll(() => sceneProbe(page, 'ready')).toEqual({ greenMugMeshes: 6, total: 9 })
  await expect.poll(() => visibleDesktopNames(page)).toEqual(['Desk_Top_L_Return_Mesh', 'Desk_Top_Main_Mesh'])

  const tops = await sceneProbe(page, 'rays') as number[]
  expect(tops[0], 'prefab cup ray must hit its 5mm inner floor').toBeCloseTo(.755, 6)
  expect(tops[1], 'URL import must use the same closed-shell repair').toBeCloseTo(.755, 6)
  expect(tops[2], 'IndexedDB import must use the same closed-shell repair').toBeCloseTo(.755, 6)
  expect(tops[3], 'phone top remains visible').toBeCloseTo(.757, 6)
  expect(tops[4], 'mousepad top remains visible').toBeCloseTo(.751, 6)
  expect(tops[5], 'monitor base top remains visible').toBeCloseTo(.765, 6)

  const views = [[0, 1.05, 1.5], [-.7, .9, 1.35], [.75, .92, 1.45], [0, 1.5, 1.7]]
  for (const [index, position] of views.entries()) {
    await sceneProbe(page, 'camera', position)
    await page.locator('canvas').screenshot({ path: info.outputPath(`contact-view-${index}.png`), scale: 'css' })
    expect(await sceneProbe(page, 'rays')).toEqual(tops)
  }
  const finalImage = info.outputPath('contact-views-final.png')
  await page.locator('canvas').screenshot({ path: finalImage, scale: 'css' })
  await info.attach('contact-views-final', { path: finalImage, contentType: 'image/png' })
  expect(errors).toEqual([])
})
