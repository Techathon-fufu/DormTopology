import { expect, test } from '@playwright/test'

test('repairs duplicate ports by owner while preserving geometry and stable IDs', async ({ page }) => {
  await page.goto('/')
  const result = await page.evaluate(async () => {
    const { repairDuplicatePortIds } = await import('/src/scene/portIds.ts')
    const { createDemoProject } = await import('/src/data/demoProject.ts')
    const project = createDemoProject()
    const monitor = project.objects.find((o) => o.id === 'demo-monitor')!
    const first = structuredClone(monitor), second = structuredClone(monitor)
    first.id = 'monitor-one'; second.id = 'monitor-two'
    first.ports[0].id = second.ports[0].id = 'port_monitor_pwr'
    first.ports[1].id = second.ports[1].id = 'port_monitor_hdmi'
    project.objects = [first, second]
    project.cables = [{ ...project.cables[0], status: 'planned',
      from: { objectId: first.id, portId: first.ports[1].id, position: [0, 0, 0] },
      to: { objectId: second.id, portId: second.ports[1].id, position: [1, 0, 0] },
    }]
    const before = JSON.stringify(project)
    const fixed = repairDuplicatePortIds(project)
    return {
      ids: fixed.objects.flatMap((o) => o.ports.map((p) => p.id)),
      unchangedInput: before === JSON.stringify(project),
      idempotent: repairDuplicatePortIds(fixed) === fixed,
      preserved: fixed.objects.every((o, i) => JSON.stringify({ ...o, ports: [] }) === JSON.stringify({ ...project.objects[i], ports: [] })),
      endpoints: [fixed.cables[0].from.portId, fixed.cables[0].to.portId],
      expectedEndpoints: fixed.objects.map((o) => o.ports[1].id),
      status: fixed.cables[0].status,
    }
  })
  expect(new Set(result.ids).size).toBe(4)
  expect(result.ids[0]).toBe('port_monitor_pwr')
  expect(result.unchangedInput && result.idempotent && result.preserved).toBe(true)
  expect(result.endpoints).toEqual(result.expectedEndpoints)
  expect(result.status).toBe('stale')
})

test('migrates saved project and baseline before submitting to the real organizer', async ({ page }) => {
  test.skip(process.env.PLAYWRIGHT_REAL_ORGANIZATION !== '1', 'Requires the Python backend.')
  test.setTimeout(90_000)
  await page.goto('/')
  const id = `duplicate-ports-${crypto.randomUUID()}`
  const original = await page.evaluate(async (id) => {
    const { createDemoProject } = await import('/src/data/demoProject.ts')
    const { planFromProject } = await import('/src/lib/plans.ts')
    const project = createDemoProject()
    project.id = id; project.isDemo = false; project.source = 'user'
    // Two small devices isolate the ID failure from physical space constraints.
    project.objects = [0, 1].map((index) => ({ ...structuredClone(project.objects[0]),
      id: `recognized-${index}`, projectId: id, name: `设备 ${index + 1}`,
      category: 'electrical', dimensions: { width: .1, height: .1, depth: .1 },
      transform: { position: [index * .2, .75, .3], rotationY: 0 },
      model: { status: 'placeholder', source: 'demo', shape: 'genericBox' },
      source: 'recognized', recognition: { confidence: .92, source: 'ai', dimensionSource: 'user' },
      ports: [{ id: 'port_monitor_pwr', type: 'power-ac', powered: true,
        offset: [0, .05, -.05], direction: 'back', confirmed: false }],
      fixed: false, locked: false,
    }))
    project.cables = []
    const baseline = planFromProject(project, 'baseline', 'Original recognized scene', { withScene: true })
    localStorage.setItem('dormtopology.projects', JSON.stringify({ version: 6, state: { projects: { [id]: project } } }))
    localStorage.setItem('dormtopology.plans', JSON.stringify({ version: 2, state: { baselines: { [id]: baseline }, candidates: { [id]: [structuredClone(baseline)] } } }))
    return { objects: project.objects, baselineId: baseline.id }
  }, id)
  await page.goto(`/projects/${id}/workspace`)
  await expect(page.locator('canvas')).toBeVisible()
  const migrated = await page.evaluate((id) => ({
    project: JSON.parse(localStorage.getItem('dormtopology.projects')!).state.projects[id],
    plans: JSON.parse(localStorage.getItem('dormtopology.plans')!).state,
  }), id)
  const portIds = (objects: Array<{ ports: Array<{ id: string }> }>) => objects.flatMap((o) => o.ports.map((p) => p.id))
  expect(new Set(portIds(migrated.project.objects)).size).toBe(2)
  expect(migrated.plans.baselines[id].id).toBe(original.baselineId)
  expect(portIds(migrated.plans.baselines[id].scene.objects)).toEqual(portIds(migrated.project.objects))
  expect(portIds(migrated.plans.candidates[id][0].scene.objects)).toEqual(portIds(migrated.project.objects))
  expect(migrated.project.objects.map((o: { transform: unknown }) => o.transform)).toEqual(original.objects.map((o) => o.transform))
  await page.getByRole('button', { name: '生成整理方案', exact: true }).first().click()
  await page.getByRole('checkbox', { name: '我已核对物品尺寸及整理前位置' }).check()
  const sync = page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/projects/${id}/scene`))
  await page.getByRole('button', { name: '生成整理方案', exact: true }).last().click()
  expect((await sync).status()).toBe(200)
  await expect.poll(() => page.evaluate(async () => {
    const { useOrganizeStore } = await import('/src/state/organizeStore.ts')
    return useOrganizeStore.getState().plan?.serviceMeta?.source
  }), { timeout: 60_000 }).toBe('real')
  // The narrow-screen drawer closes when generation completes.
  if (!await page.getByRole('button', { name: '接受方案', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '生成整理方案', exact: true }).first().click()
  }
  await expect(page.getByRole('button', { name: '接受方案', exact: true })).toBeEnabled({ timeout: 60_000 })
  await page.getByRole('button', { name: '接受方案', exact: true }).click()
  await expect.poll(() => page.evaluate((id) => JSON.parse(localStorage.getItem('dormtopology.projects')!).state.projects[id].layoutSource, id)).toBe('algorithm')
})
