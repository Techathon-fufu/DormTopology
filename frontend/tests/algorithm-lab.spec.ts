import { readFileSync } from 'node:fs'
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { parseBundle, type Scene, type PackingResult, type RoutingResult } from '../src/algorithm-lab/contract'

type FixtureCase = {
  id: string
  scene_url: string
  packing_result_url?: string
  routing_result_url?: string
  expected: { packing_status?: string; routing_status: string; reason_codes: string[] }
}

const fixtureRoot = new URL('../public/algorithm-fixtures/', import.meta.url)
const fixtures = JSON.parse(readFileSync(new URL('manifest.json', fixtureRoot), 'utf8')).cases as FixtureCase[]

function readFixture<T = Record<string, unknown>>(caseId: string, name: string): T {
  return JSON.parse(readFileSync(new URL(`${caseId}/${name}`, fixtureRoot), 'utf8'))
}

function directPlugScene(): Scene {
  const scene = readFixture<Scene>('packing-success', 'scene.json')
  const adapter = scene.items.find(item => item.id === 'charger')!
  adapter.category = 'power_adapter'
  adapter.fixed = true
  adapter.placement_priority = 100
  adapter.plug_mount = { socket_port_id: 'strip_socket_1', plug_port_id: 'charger_port' }
  return scene
}

async function importJson(page: Page, documents: Record<string, unknown>) {
  await page.locator('input[type=file]').setInputFiles(Object.entries(documents).map(([name, value]) => ({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)),
  })))
}

async function openLab(page: Page) {
  await page.goto('/algorithm-lab')
  await expect(page.getByLabel('测试场景')).toHaveValue('packing-success')
  await expect(page.getByLabel('测试场景')).toBeEnabled()
  await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-case-id', 'packing-success')
  await expect(page.getByTestId('algorithm-viewport').locator('canvas')).toBeVisible()
}

async function expectNonblankCanvas(page: Page) {
  const canvas = page.getByTestId('algorithm-viewport').locator('canvas')
  await expect.poll(async () => canvas.evaluate((element: HTMLCanvasElement) => {
    const gl = element.getContext('webgl2') ?? element.getContext('webgl')
    if (!gl || !element.width || !element.height) return 0
    const pixels = new Uint8Array(element.width * element.height * 4)
    gl.readPixels(0, 0, element.width, element.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    const colors = new Set<number>()
    const stride = Math.max(1, Math.floor((element.width * element.height) / 10_000))
    for (let index = 0; index < pixels.length; index += stride * 4) {
      if (pixels[index + 3]) colors.add((pixels[index] << 16) + (pixels[index + 1] << 8) + pixels[index + 2])
    }
    return colors.size
  }), { message: 'The 3D canvas should render varied, nontransparent geometry.' }).toBeGreaterThan(32)
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, scale: 'css', animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function downloadJson(page: Page, buttonName: string): Promise<Record<string, unknown>> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: buttonName, exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.json$/)
  const stream = await download.createReadStream()
  expect(stream).not.toBeNull()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

test('renders the real packing result, switches phases and inspects an item', async ({ page }, testInfo) => {
  const runtimeErrors: string[] = []
  page.on('pageerror', error => runtimeErrors.push(error.message))
  await openLab(page)
  await expect(page.getByTestId('packing-status')).toContainText('success')
  await expectNonblankCanvas(page)
  await page.getByRole('button', { name: '整理前', exact: true }).click()
  await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-phase', 'before')
  await attachScreenshot(page, testInfo, 'packing-before')
  await page.getByRole('button', { name: '整理后', exact: true }).click()
  await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-phase', 'after')
  await page.getByTestId('item-list').getByRole('button').first().click()
  await expect(page.getByTestId('inspector')).toContainText('keyboard')
  await expectNonblankCanvas(page)
  await attachScreenshot(page, testInfo, 'packing-after')
  expect(runtimeErrors).toEqual([])
})

for (const fixture of fixtures) {
  test(`shows domain status and failure reasons: ${fixture.id}`, async ({ page }, testInfo) => {
    await openLab(page)
    await page.getByLabel('测试场景').selectOption(fixture.id)
    await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-case-id', fixture.id)
    if (fixture.expected.packing_status) {
      await expect(page.getByTestId('packing-status')).toContainText(fixture.expected.packing_status)
    }
    await expect(page.getByTestId('routing-status')).toContainText(fixture.expected.routing_status)
    const routes = readFixture<RoutingResult>(fixture.id, 'cable_routing.json')
    await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-rendered-cables',
      String(routes.cables.filter(cable => cable.status === 'valid').length))
    for (const reason of fixture.expected.reason_codes) {
      await expect(page.getByTestId('issues')).toContainText(reason)
    }
    await expectNonblankCanvas(page)
    await attachScreenshot(page, testInfo, fixture.id)
  })
}

test('toggles scene layers and orbits the rendered scene', async ({ page }, testInfo) => {
  await openLab(page)
  await expectNonblankCanvas(page)
  for (const label of ['收纳区域', '碰撞体', '走线网络', '线缆', '固定与支撑']) {
    const checkbox = page.getByRole('checkbox', { name: label, exact: true })
    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
    await expect(checkbox).toBeChecked()
  }
  const viewport = page.getByTestId('algorithm-viewport')
  const before = await viewport.getAttribute('data-camera-position')
  expect(before).toBeTruthy()
  const bounds = await viewport.locator('canvas').boundingBox()
  expect(bounds).not.toBeNull()
  if (!bounds) return
  await page.mouse.move(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.6, { steps: 12 })
  await page.mouse.up()
  await expect.poll(() => viewport.getAttribute('data-camera-position')).not.toBe(before)
  await expectNonblankCanvas(page)
  await attachScreenshot(page, testInfo, 'orbit-and-layers')
})

test('imports matching bundles and rejects stale or malformed input atomically', async ({ page }) => {
  await openLab(page)
  const input = page.locator('input[type=file]')
  const scene = readFixture('packing-revision-2', 'scene.json')
  const packing = readFixture('packing-revision-2', 'packing_result.json')
  await input.setInputFiles([
    { name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) },
    { name: 'packing_result.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(packing)) },
  ])
  const viewport = page.getByTestId('algorithm-viewport')
  await expect(viewport).toHaveAttribute('data-scene-revision', '2')
  await expect(page.getByTestId('packing-status')).toContainText('success')
  await expect(page.getByRole('alert')).toHaveCount(0)
  const stalePacking = { ...packing, scene_revision: 1 }
  await input.setInputFiles([
    { name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(scene)) },
    { name: 'packing_result.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(stalePacking)) },
  ])
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(viewport).toHaveAttribute('data-scene-revision', '2')
  await expect(page.getByTestId('packing-status')).toContainText('success')
  const staleError = await page.getByRole('alert').textContent()
  await input.setInputFiles({ name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from('{invalid') })
  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.getByRole('alert')).not.toHaveText(staleError!)
  await expect(viewport).toHaveAttribute('data-scene-revision', '2')
  await expect(page.getByTestId('packing-status')).toContainText('success')
})

test('exports the currently loaded scene as valid JSON', async ({ page }) => {
  await openLab(page)
  const exported = await downloadJson(page, '导出场景')
  expect(exported.scene_id).toBe('packing_demo')
  expect(exported.scene_revision).toBe(1)
  expect(exported.items).toHaveLength(11)
})

test('round trips input, packing, applied scene and routing with consistent versions', async ({ page }, testInfo) => {
  await openLab(page)
  const names = ['cable_routing.json', 'packing_result.json', 'scene.json', 'applied_scene.json']
  const payloads = names.map(name => ({
    name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(readFixture('packing-revision-2', name))),
  }))
  await page.locator('input[type=file]').setInputFiles(payloads)
  const viewport = page.getByTestId('algorithm-viewport')
  await expect(viewport).toHaveAttribute('data-case-id', 'imported')
  await expect(viewport).toHaveAttribute('data-scene-revision', '3')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('packing-status')).toContainText('success')
  await expect(page.getByTestId('routing-status')).toContainText('infeasible')
  for (const [button, filename] of [
    ['导出场景', 'scene.json'], ['导出整理结果', 'packing_result.json'],
    ['导出应用场景', 'applied_scene.json'], ['导出走线结果', 'cable_routing.json'],
  ]) {
    expect(await downloadJson(page, button)).toEqual(readFixture('packing-revision-2', filename))
  }
  await page.getByRole('button', { name: '整理前', exact: true }).click()
  await expect(viewport).toHaveAttribute('data-scene-revision', '2')
  await page.getByRole('button', { name: '整理后', exact: true }).click()
  await expect(viewport).toHaveAttribute('data-scene-revision', '3')
  await expectNonblankCanvas(page)
  await attachScreenshot(page, testInfo, 'imported-applied-bundle')
  const staleRouting = { ...readFixture('packing-revision-2', 'cable_routing.json'), scene_revision: 2 }
  await page.locator('input[type=file]').setInputFiles(payloads.map(payload => payload.name === 'cable_routing.json'
    ? { ...payload, buffer: Buffer.from(JSON.stringify(staleRouting)) } : payload))
  await expect(page.getByRole('alert')).toContainText('scene_revision')
  await expect(viewport).toHaveAttribute('data-scene-revision', '3')
  expect(await downloadJson(page, '导出走线结果')).toEqual(readFixture('packing-revision-2', 'cable_routing.json'))
})

test('rejects geometry on a failed cable and preserves the current result', async ({ page }) => {
  await openLab(page)
  await page.getByLabel('测试场景').selectOption('routing-length-exceeded')
  const viewport = page.getByTestId('algorithm-viewport')
  await expect(viewport).toHaveAttribute('data-case-id', 'routing-length-exceeded')
  const routing = readFixture('routing-length-exceeded', 'cable_routing.json')
  const invalid = structuredClone(routing)
  const cables = invalid.cables as Array<Record<string, unknown>>
  cables[0].path_points = [[0, 0, 0], [1, 1, 1]]
  await page.locator('input[type=file]').setInputFiles([
    { name: 'scene.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(readFixture('routing-length-exceeded', 'scene.json'))) },
    { name: 'cable_routing.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(invalid)) },
  ])
  await expect(page.getByRole('alert')).toContainText('failed routes must have empty geometry')
  await expect(viewport).toHaveAttribute('data-case-id', 'routing-length-exceeded')
  await expect(page.getByTestId('issues')).toContainText('length_exceeded')
  expect(await downloadJson(page, '导出走线结果')).toEqual(routing)
})

test('renders valid routes only for their matching layout phase and revision', async ({ page }) => {
  await openLab(page)
  const scene = readFixture<Scene>('routing-slot', 'scene.json')
  const regionId = scene.regions[0].id
  const decoration = structuredClone(scene.items[0])
  decoration.id = 'decoration'; decoration.name = 'decoration'; decoration.fixed = false
  decoration.ports = []; decoration.position = [0.4, 0.77, 0.4]; decoration.allowed_region_ids = [regionId]
  scene.items.push(decoration)
  const packing: PackingResult = {
    schema_version: '1.0', scene_id: scene.scene_id, scene_revision: 1, status: 'success', issues: [],
    items: scene.items.map(item => ({
      item_id: item.id, name: item.name, model_url: null, current_pos: item.position,
      target_pos: item.fixed ? item.position : [0.6, 0.77, 0.4], target_rotation_y_rad: item.rotation_y_rad,
      target_region_id: item.fixed ? null : regionId, placement_status: item.fixed ? 'unchanged' : 'placed', reason_code: null,
    })),
  }
  const routing = readFixture<RoutingResult>('routing-slot', 'cable_routing.json')
  const documents = { 'scene.json': scene, 'packing_result.json': packing, 'cable_routing.json': routing }
  await importJson(page, documents)
  const viewport = page.getByTestId('algorithm-viewport')
  await expect(viewport).toHaveAttribute('data-case-id', 'imported')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(viewport).toHaveAttribute('data-phase', 'after')
  await expect(viewport).toHaveAttribute('data-rendered-cables', '0')
  await page.getByRole('button', { name: '整理前', exact: true }).click()
  await expect(viewport).toHaveAttribute('data-rendered-cables', '1')
  const applied = structuredClone(scene)
  applied.scene_revision = 2; applied.items[2].position = [0.6, 0.77, 0.4]
  await importJson(page, { ...documents, 'applied_scene.json': applied, 'cable_routing.json': { ...routing, scene_revision: 2 } })
  await expect(viewport).toHaveAttribute('data-scene-revision', '2')
  await expect(viewport).toHaveAttribute('data-phase', 'after')
  await expect(viewport).toHaveAttribute('data-rendered-cables', '1')
  const cables = page.getByRole('checkbox', { name: '线缆', exact: true })
  await cables.uncheck()
  await expect(viewport).toHaveAttribute('data-rendered-cables', '0')
  await cables.check()
  await expect(viewport).toHaveAttribute('data-rendered-cables', '1')
  await page.getByRole('button', { name: '整理前', exact: true }).click()
  await expect(viewport).toHaveAttribute('data-scene-revision', '1')
  await expect(viewport).toHaveAttribute('data-rendered-cables', '0')
})

test('accepts verified routes with unknown cable availability while retaining known-length limits', () => {
  const scene = readFixture<Scene>('routing-slot', 'scene.json')
  const routing = readFixture<RoutingResult>('routing-slot', 'cable_routing.json')
  expect(routing.cables.some(cable => cable.status === 'valid')).toBe(true)
  scene.cables.forEach(cable => { cable.length_m = null })
  expect(() => parseBundle(scene, undefined, routing)).not.toThrow()
  scene.cables.forEach(cable => { cable.length_m = 0.001 })
  expect(() => parseBundle(scene, undefined, routing)).toThrow(/exceeds the source cable length/)
})

test('rejects applied scenes that alter dimensions, ports, obstacles or cables', async ({ page }) => {
  await openLab(page)
  const applied = readFixture<Scene>('packing-revision-2', 'applied_scene.json')
  const documents = {
    'scene.json': readFixture('packing-revision-2', 'scene.json'),
    'packing_result.json': readFixture('packing-revision-2', 'packing_result.json'),
    'applied_scene.json': applied,
    'cable_routing.json': readFixture('packing-revision-2', 'cable_routing.json'),
  }
  await importJson(page, documents)
  await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-scene-revision', '3')
  for (const mutate of [
    (value: Scene) => { value.items[0].size_m[0] += 0.01 },
    (value: Scene) => { value.items.find(item => item.ports.length)!.ports[0].confirmed = false },
    (value: Scene) => { value.obstacles[0].max[0] += 0.01 },
    (value: Scene) => { value.cables[0].length_m = (value.cables[0].length_m ?? 0) + 0.1 },
  ]) {
    await importJson(page, documents)
    await expect(page.getByRole('alert')).toHaveCount(0)
    const invalid = structuredClone(applied)
    mutate(invalid)
    await importJson(page, { ...documents, 'applied_scene.json': invalid })
    await expect(page.getByRole('alert')).toContainText('applying a layout may only change')
    await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-scene-revision', '3')
    expect(await downloadJson(page, '导出应用场景')).toEqual(applied)
    expect(await downloadJson(page, '导出走线结果')).toEqual(documents['cable_routing.json'])
  }
})

test('rejects imports exceeding viewer coordinate and item budgets without replacing the scene', async ({ page }) => {
  await openLab(page)
  const original = readFixture<Scene>('packing-success', 'scene.json')
  for (const invalid of [
    { ...original, desk: { ...original.desk, width_m: 1_000_001 } },
    { ...original, items: Array.from({ length: 257 }, () => original.items[0]) },
  ]) {
    await page.getByLabel('测试场景').selectOption('packing-success')
    await expect(page.getByLabel('测试场景')).toBeEnabled()
    await expect(page.getByRole('alert')).toHaveCount(0)
    await importJson(page, { 'scene.json': invalid })
    await expect(page.getByRole('alert')).toBeVisible()
    expect(await downloadJson(page, '导出场景')).toEqual(original)
    await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-case-id', 'packing-success')
  }
})

test('reports an empty fixture manifest before rendering', async ({ page }) => {
  await page.route('**/algorithm-fixtures/manifest.json', route => route.fulfill({
    json: { schema_version: '1.0', generated_by: 'browser-regression', cases: [] },
  }))
  await page.goto('/algorithm-lab')
  await expect(page.getByRole('alert')).toContainText('manifest.cases')
  await expect(page.getByTestId('algorithm-viewport').locator('canvas')).toHaveCount(0)
})

test('reports unavailable WebGL while keeping numerical results and export usable', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type: string, ...args: unknown[]) {
      return type.includes('webgl') ? null : Reflect.apply(original, this, [type, ...args])
    } as typeof original
  })
  await page.goto('/algorithm-lab')
  await expect(page.getByRole('alert')).toContainText('WebGL 不可用')
  await expect(page.getByTestId('packing-status')).toContainText('success')
  await expect(page.getByTestId('algorithm-viewport').locator('canvas')).toHaveCount(0)
  expect(await downloadJson(page, '导出场景')).toEqual(readFixture('packing-success', 'scene.json'))
})

test('keeps controls and text inside the mobile or desktop viewport', async ({ page }, testInfo) => {
  await openLab(page)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)
  expect(overflow).toBe(false)
  for (const control of [page.getByLabel('测试场景'), page.getByRole('button', { name: '整理后', exact: true })]) {
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  }
  await attachScreenshot(page, testInfo, 'responsive-layout')
})

for (const caseId of ['routing-supported-edge', 'routing-underdesk-ties', 'routing-underdesk-tray', 'routing-underdesk-composite']) {
  test(`renders mounted support and evaluated cable evidence: ${caseId}`, async ({ page }, testInfo) => {
    await openLab(page)
    await page.getByLabel('测试场景').selectOption(caseId)
    const viewport = page.getByTestId('algorithm-viewport')
    await expect(viewport).toHaveAttribute('data-case-id', caseId)
    const scene = readFixture<Scene>(caseId, 'scene.json')
    const routing = readFixture<RoutingResult>(caseId, 'cable_routing.json')
    const supports = scene.routing_graph.supports!
    expect(supports.length).toBeGreaterThan(0)
    await expect(viewport).toHaveAttribute('data-rendered-supports', String(supports.length))
    await expect(page.getByTestId('support-policy')).toContainText(scene.routing_graph.support_policy!.max_unsupported_span_m.toFixed(4))
    for (const cable of routing.cables) {
      expect(cable.status).toBe('valid')
      expect(cable.support_check?.status).toBe('verified')
      await expect(page.getByTestId(`support-check-${cable.id}`)).toContainText('支撑已复查')
      await expect(page.getByTestId(`support-check-${cable.id}`)).toContainText(cable.support_check!.max_unsupported_span_m!.toFixed(4))
    }
    await page.getByTestId('support-panel').getByRole('button').first().click()
    await expect(page.getByTestId('inspector')).toContainText(supports[0].id)
    await expect(page.getByTestId('inspector')).toContainText(supports[0].obstacle_id)
    await expect(page.getByTestId('inspector')).toContainText(supports[0].face)
    await expectNonblankCanvas(page)
    await attachScreenshot(page, testInfo, `${caseId}-support-selection`)
    const layer = page.getByRole('checkbox', { name: '固定与支撑', exact: true })
    await layer.uncheck()
    await expect(viewport).toHaveAttribute('data-rendered-supports', '0')
    await layer.check()
    await expect(viewport).toHaveAttribute('data-rendered-supports', String(supports.length))
    expect(await downloadJson(page, '导出场景')).toEqual(scene)
    expect(await downloadJson(page, '导出走线结果')).toEqual(routing)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false)
  })
}

test('renders underside tray optimization groups without changing cable validity', async ({ page }, testInfo) => {
  await openLab(page)
  const scene = readFixture<Scene>('routing-underdesk-composite', 'scene.json')
  const routing = readFixture<RoutingResult>('routing-underdesk-composite', 'cable_routing.json')
  const sourceCandidate = scene.routing_graph.tray_candidates![0]
  const optimization = {
    id: 'tray_candidate_0',
    status: 'recommended' as const,
    support_id: null,
    cable_ids: routing.cables.map(cable => cable.id),
    shared_length_m: 0.81,
    occupied_width_m: 0.012,
    available_width_m: 0.08,
    requires_installation: true,
    reason_code: null,
    mount: {
      obstacle_id: sourceCandidate.obstacle_id,
      face: 'y_min' as const,
      bounds_uv_m: sourceCandidate.bounds_uv_m,
      stand_off_m: sourceCandidate.stand_off_m,
    },
  }
  const augmented = { ...routing, underside_tray_optimizations: [optimization] }
  await importJson(page, { 'scene.json': scene, 'cable_routing.json': augmented })
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByTestId('routing-status')).toContainText('success')
  await expect(page.getByTestId('tray-optimization-panel')).toContainText('建议安装')
  await expect(page.getByTestId('tray-group-tray_candidate_0')).toContainText('3 根线')
  await expect(page.getByTestId('tray-group-tray_candidate_0')).toContainText('需要安装后才可作为机械支撑')
  await expect(page.getByTestId('tray-group-tray_candidate_0')).toContainText('desk_top')
  await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-rendered-tray-candidates', '1')
  const candidateLayer = page.getByRole('checkbox', { name: '集线槽建议', exact: true })
  await candidateLayer.uncheck()
  await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-rendered-tray-candidates', '0')
  await candidateLayer.check()
  await expectNonblankCanvas(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false)
  await attachScreenshot(page, testInfo, 'tray-optimization-groups')
  expect(await downloadJson(page, '导出走线结果')).toEqual(augmented)
  const invalid = structuredClone(augmented)
  invalid.underside_tray_optimizations[0].cable_ids = ['missing_cable']
  await importJson(page, { 'scene.json': scene, 'cable_routing.json': invalid })
  await expect(page.getByRole('alert')).toContainText('unknown or duplicate cable ID')
  expect(await downloadJson(page, '导出走线结果')).toEqual(augmented)
  const movedMount = structuredClone(augmented)
  movedMount.underside_tray_optimizations[0].mount.bounds_uv_m[0] += 0.01
  await importJson(page, { 'scene.json': scene, 'cable_routing.json': movedMount })
  await expect(page.getByRole('alert')).toContainText('must match a source candidate')
  expect(await downloadJson(page, '导出走线结果')).toEqual(augmented)
  const missingMount = structuredClone(augmented)
  Reflect.deleteProperty(missingMount.underside_tray_optimizations[0], 'mount')
  await importJson(page, { 'scene.json': scene, 'cable_routing.json': missingMount })
  await expect(page.getByRole('alert')).toContainText('mount: expected an object')
  expect(await downloadJson(page, '导出走线结果')).toEqual(augmented)
})

test('accepts the combined mounted and candidate tray result budget and rejects overflow', () => {
  const scene = readFixture<Scene>('routing-underdesk-composite', 'scene.json')
  const routing = readFixture<RoutingResult>('routing-underdesk-composite', 'cable_routing.json')
  const candidate = scene.routing_graph.tray_candidates![0]
  const originalSupportIds = scene.routing_graph.supports!.map(support => support.id)
  scene.routing_graph.supports = Array.from({ length: 256 }, (_, index) => ({
    ...candidate, id: originalSupportIds[index] ?? `installed_tray_${index}`,
  }))
  scene.routing_graph.tray_candidates = Array.from({ length: 256 }, (_, index) => ({
    ...candidate, id: `candidate_tray_${index}`,
  }))
  const allMounts = [...scene.routing_graph.supports, ...scene.routing_graph.tray_candidates]
  const optimizations = allMounts.map((mount, index) => ({
    id: mount.id, status: 'not_used' as const, support_id: index < 256 ? mount.id : null,
    cable_ids: [], shared_length_m: 0, occupied_width_m: 0, available_width_m: 0.1,
    requires_installation: index >= 256, reason_code: 'no_compatible_routes' as const,
    mount: { obstacle_id: mount.obstacle_id, face: mount.face, bounds_uv_m: mount.bounds_uv_m, stand_off_m: mount.stand_off_m },
  }))
  const result = { ...routing, underside_tray_optimizations: optimizations }
  expect(parseBundle(scene, undefined, result).routingResult!.underside_tray_optimizations).toHaveLength(512)
  result.underside_tray_optimizations.push({ ...optimizations[0], id: 'overflow_optimization' })
  expect(() => parseBundle(scene, undefined, result)).toThrow('viewer limit is 512 entries')
})

test('validates confirmed direct plug references and optional placement priorities without mutating input', () => {
  const scene = directPlugScene()
  const original = structuredClone(scene)
  const parsed = parseBundle(scene).scene
  expect(parsed.items.find(item => item.id === 'charger')!.placement_priority).toBe(100)
  expect(parsed.items.find(item => item.id === 'keyboard')!.placement_priority).toBeUndefined()
  expect(scene).toEqual(original)
  const mutations: Array<(candidate: Scene) => void> = [
    candidate => { candidate.items.find(item => item.id === 'charger')!.fixed = false },
    candidate => { candidate.items.find(item => item.id === 'charger')!.category = 'device' },
    candidate => { candidate.items.find(item => item.id === 'charger')!.plug_mount!.socket_port_id = 'wall_power_port' },
    candidate => { candidate.items.find(item => item.id === 'charger')!.plug_mount!.plug_port_id = 'keyboard_port' },
    candidate => { candidate.items.find(item => item.id === 'strip')!.fixed = false },
    candidate => { candidate.items.find(item => item.id === 'strip')!.dimensions_confirmed = false },
    candidate => { candidate.items.find(item => item.id === 'charger')!.dimensions_confirmed = false },
    candidate => { candidate.items.find(item => item.id === 'strip')!.ports[0].confirmed = false },
    candidate => { candidate.items.find(item => item.id === 'charger')!.ports[0].confirmed = false },
    candidate => {
      const adapter = structuredClone(candidate.items.find(item => item.id === 'charger')!)
      adapter.id = 'duplicate_adapter'
      adapter.ports[0].id = 'duplicate_plug'
      adapter.plug_mount!.plug_port_id = 'duplicate_plug'
      candidate.items.push(adapter)
    },
    ...[-1, 101, 0.5, true].map(value => (candidate: Scene) => { Reflect.set(candidate.items[0], 'placement_priority', value) }),
  ]
  for (const mutate of mutations) {
    const candidate = structuredClone(scene)
    mutate(candidate)
    expect(() => parseBundle(candidate)).toThrow()
  }
})

test('preserves direct plug mounting and priorities when validating an applied layout', () => {
  const scene = directPlugScene()
  const packing: PackingResult = {
    schema_version: '1.0', scene_id: scene.scene_id, scene_revision: scene.scene_revision, status: 'success', issues: [],
    items: scene.items.map(item => ({
      item_id: item.id, name: item.name, model_url: item.model_url, current_pos: item.position,
      target_pos: item.position, target_rotation_y_rad: item.rotation_y_rad, target_region_id: null,
      placement_status: 'unchanged', reason_code: null,
    })),
  }
  const applied = { ...structuredClone(scene), scene_revision: scene.scene_revision + 1 }
  expect(parseBundle(scene, packing, undefined, applied).routingScene).toEqual(applied)
  for (const mutate of [
    (candidate: Scene) => { candidate.items.find(item => item.id === 'charger')!.placement_priority = 99 },
    (candidate: Scene) => { candidate.items.find(item => item.id === 'charger')!.plug_mount!.socket_port_id = 'strip_socket_2' },
  ]) {
    const candidate = structuredClone(applied)
    mutate(candidate)
    expect(() => parseBundle(scene, packing, undefined, candidate)).toThrow('only change item positions, rotations and scene_revision')
  }
})

test('renders the integrated equipment layout and confirmed direct plug connection', async ({ page }, testInfo) => {
  await openLab(page)
  await page.getByLabel('测试场景').selectOption('packing-integrated-desk')
  const scene = readFixture<Scene>('packing-integrated-desk', 'scene.json')
  const applied = readFixture<Scene>('packing-integrated-desk', 'applied_scene.json')
  const routing = readFixture<RoutingResult>('packing-integrated-desk', 'cable_routing.json')
  const viewport = page.getByTestId('algorithm-viewport')
  await expect(viewport).toHaveAttribute('data-case-id', 'packing-integrated-desk')
  await expect(viewport).toHaveAttribute('data-scene-revision', String(applied.scene_revision))
  expect(scene.items.filter(item => !item.fixed)).toHaveLength(8)
  const monitor = applied.items.find(item => item.category === 'monitor')!
  const printer = applied.items.find(item => item.category === 'printer')!
  const adapter = applied.items.find(item => item.plug_mount)!
  expect(monitor.placement_priority).toBe(100)
  expect(printer.placement_priority).toBe(90)
  await page.getByTestId('item-list').getByRole('button').filter({ hasText: monitor.id }).click()
  await expect(page.getByTestId('inspector').locator('dd').filter({ hasText: /^100$/ })).toBeVisible()
  await page.getByRole('button', { name: '正视图', exact: true }).click()
  await expectNonblankCanvas(page)
  await attachScreenshot(page, testInfo, 'integrated-monitor-front')
  await page.getByTestId('item-list').getByRole('button').filter({ hasText: printer.id }).click()
  await expect(page.getByTestId('inspector').locator('dd').filter({ hasText: /^90$/ })).toBeVisible()
  await page.getByRole('button', { name: '透视图', exact: true }).click()
  await attachScreenshot(page, testInfo, 'integrated-equipment-after')
  const viewportPath = testInfo.outputPath('integrated-equipment-viewport.png')
  await viewport.screenshot({ path: viewportPath, animations: 'disabled' })
  await testInfo.attach('integrated-equipment-viewport', { path: viewportPath, contentType: 'image/png' })
  const mount = adapter.plug_mount!
  await expect(page.getByTestId('plug-mount-panel')).toContainText('接口已确认')
  await page.getByRole('button', { name: `查看直插插孔 ${mount.socket_port_id}`, exact: true }).click()
  await expect(page.getByTestId('inspector')).toContainText(mount.socket_port_id)
  await page.getByRole('button', { name: `查看适配器插头 ${mount.plug_port_id}`, exact: true }).click()
  await expect(page.getByTestId('inspector')).toContainText(mount.plug_port_id)
  await expect(page.getByTestId('inspector')).toContainText(mount.socket_port_id)
  await attachScreenshot(page, testInfo, 'integrated-direct-plug')
  await page.getByRole('button', { name: '整理前', exact: true }).click()
  await expect(viewport).toHaveAttribute('data-rendered-cables', '0')
  await page.getByRole('button', { name: '整理后', exact: true }).click()
  await expect(viewport).toHaveAttribute('data-rendered-cables', String(routing.cables.filter(cable => cable.status === 'valid').length))
  expect(await downloadJson(page, '导出应用场景')).toEqual(applied)
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false)
})

test('shows the real composite route tray proposal as a separate installation suggestion', async ({ page }, testInfo) => {
  await openLab(page)
  await page.getByLabel('测试场景').selectOption('routing-underdesk-composite')
  const scene = readFixture<Scene>('routing-underdesk-composite', 'scene.json')
  const routing = readFixture<RoutingResult>('routing-underdesk-composite', 'cable_routing.json')
  const candidate = scene.routing_graph.tray_candidates![0]
  const optimization = routing.underside_tray_optimizations!.find(group => group.status === 'recommended')!
  expect(optimization.cable_ids).toHaveLength(3)
  expect(optimization.requires_installation).toBe(true)
  expect(optimization.support_id).toBeNull()
  const viewport = page.getByTestId('algorithm-viewport')
  await expect(viewport).toHaveAttribute('data-rendered-cables', '3')
  const colors = await Promise.all(routing.cables.map(cable => page.getByTestId(`cable-color-${cable.id}`).evaluate(element => getComputedStyle(element).backgroundColor)))
  expect(new Set(colors).size).toBe(3)
  const group = page.getByTestId(`tray-group-${optimization.id}`)
  await expect(group).toContainText('建议安装')
  await expect(group).toContainText(optimization.shared_length_m.toFixed(4))
  await group.getByRole('button', { name: `查看安装建议 · ${candidate.id}`, exact: true }).click()
  await expect(page.getByTestId('inspector')).toContainText('待安装集线槽')
  await expect(page.getByTestId('inspector')).toContainText(candidate.id)
  await page.getByRole('button', { name: '桌底视图', exact: true }).click()
  await expect(viewport).toHaveAttribute('data-camera-view', 'underside')
  await expect.poll(async () => Number((await viewport.getAttribute('data-camera-position'))!.split(',')[1])).toBeLessThan(scene.desk.top_height_m)
  await page.getByRole('checkbox', { name: '集线槽建议', exact: true }).uncheck()
  await expect(viewport).toHaveAttribute('data-rendered-tray-candidates', '0')
  await expect(viewport).toHaveAttribute('data-rendered-cables', '3')
  await expectNonblankCanvas(page)
  await attachScreenshot(page, testInfo, 'composite-individual-lanes')
  await page.getByRole('checkbox', { name: '集线槽建议', exact: true }).check()
  await expectNonblankCanvas(page)
  await attachScreenshot(page, testInfo, 'composite-tray-proposal')
  expect(await downloadJson(page, '导出走线结果')).toEqual(routing)
  await page.getByLabel('测试场景').selectOption('routing-underdesk-ties')
  await expect(page.getByTestId(`cable-color-${routing.cables[0].id}`)).toHaveCSS('background-color', colors[0])
})

test('keeps unsupported cables failed and distinguishes legacy unevaluated routes', async ({ page }, testInfo) => {
  await openLab(page)
  await page.getByLabel('测试场景').selectOption('routing-unsupported-span')
  const viewport = page.getByTestId('algorithm-viewport')
  await expect(viewport).toHaveAttribute('data-case-id', 'routing-unsupported-span')
  await expect(viewport).toHaveAttribute('data-rendered-cables', '0')
  await expect(page.getByTestId('issues')).toContainText('unsupported_span')
  const failed = readFixture<RoutingResult>('routing-unsupported-span', 'cable_routing.json')
  for (const cable of failed.cables) {
    expect(cable.support_check).toEqual({ status: 'not_evaluated', max_unsupported_span_m: null, support_ids: [] })
    await expect(page.getByTestId(`support-check-${cable.id}`)).toContainText('支撑未评估')
  }
  await expectNonblankCanvas(page)
  await attachScreenshot(page, testInfo, 'unsupported-span-failure')
  const legacyScene = readFixture<Scene>('routing-slot', 'scene.json')
  const legacyResult = readFixture<RoutingResult>('routing-slot', 'cable_routing.json')
  delete legacyScene.routing_graph.support_policy
  delete legacyScene.routing_graph.supports
  for (const cable of legacyResult.cables) delete cable.support_check
  await importJson(page, { 'scene.json': legacyScene, 'cable_routing.json': legacyResult })
  await expect(viewport).toHaveAttribute('data-case-id', 'imported')
  await expect(viewport).toHaveAttribute('data-rendered-cables', '1')
  await expect(page.getByTestId('support-policy')).toContainText('未配置支撑检查')
  await expect(page.getByTestId(`support-check-${legacyResult.cables[0].id}`)).toContainText('支撑未评估')
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('rejects unmounted support declarations and inconsistent verification evidence atomically', async ({ page }) => {
  await openLab(page)
  const original = readFixture<Scene>('routing-underdesk-tray', 'scene.json')
  const originalResult = readFixture<RoutingResult>('routing-underdesk-tray', 'cable_routing.json')
  const documents = { 'scene.json': original, 'cable_routing.json': originalResult }
  for (const mutate of [
    (scene: Scene) => { delete scene.routing_graph.support_policy },
    (scene: Scene) => { scene.routing_graph.supports![0].obstacle_id = 'missing_obstacle' },
    (scene: Scene) => { scene.routing_graph.supports![0].kind = 'surface' },
    (scene: Scene) => { scene.routing_graph.supports![0].bounds_uv_m[0] = -100 },
    (scene: Scene) => { scene.routing_graph.supports![0].stand_off_m = 0.11 },
    (scene: Scene) => { scene.routing_graph.supports![0].id = scene.items[0].id },
    (scene: Scene) => {
      scene.routing_graph.supports![0].kind = 'cable_tie'
      scene.routing_graph.supports![0].bounds_uv_m = [0.17, 0.2200001, 0.10, 0.14]
    },
    (_scene: Scene, result: RoutingResult) => { result.cables[0].support_check!.support_ids = ['missing_support'] },
    (scene: Scene, result: RoutingResult) => { result.cables[0].support_check!.max_unsupported_span_m = scene.routing_graph.support_policy!.max_unsupported_span_m + 1e-8 },
    (_scene: Scene, result: RoutingResult) => { result.cables[0].support_check!.status = 'not_evaluated' },
  ]) {
    await importJson(page, documents)
    await expect(page.getByRole('alert')).toHaveCount(0)
    const scene = structuredClone(original)
    const result = structuredClone(originalResult)
    mutate(scene, result)
    await importJson(page, { 'scene.json': scene, 'cable_routing.json': result })
    await expect(page.getByRole('alert')).toBeVisible()
    expect(await downloadJson(page, '导出场景')).toEqual(original)
    expect(await downloadJson(page, '导出走线结果')).toEqual(originalResult)
    await expect(page.getByTestId('algorithm-viewport')).toHaveAttribute('data-case-id', 'imported')
  }
})
