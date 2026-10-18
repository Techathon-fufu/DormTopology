import { expect, test, type Page } from '@playwright/test'

/**
 * Space-configuration preview camera constraints (isolated task branch).
 *
 * The preview canvas owns a restricted orbit: the camera may rotate from the front and the
 * interior side, tilt down moderately and zoom, but it must never pass behind the back / left
 * wall, dive under the floor or end up inside furniture. These checks drive a real desktop
 * browser and read the live camera through the dev-only probe in CameraRig.
 *
 * Rendering here is software (swiftshader), so the interactions are few and each wait polls
 * the camera until OrbitControls damping settles instead of sleeping a fixed time.
 */

// 软件渲染下每次拖拽都要重绘整张小画布，默认 30s 不够。
test.setTimeout(180_000)
test.use({ trace: 'off' })

type Vec3Tuple = [number, number, number]

interface ProbeState {
  position: Vec3Tuple
  target: Vec3Tuple
  fov: number
  size: { width: number; height: number }
}

interface ProbeCoverage {
  corners: number
  cornersInFrame: number
  maxNdcX: number
  maxNdcY: number
  complete: boolean
}

interface ProbeBounds {
  wallX: number
  wallZ: number
  floorY: number
  minDistance: number
  maxDistance: number
}

interface PreviewReading {
  state: ProbeState
  coverage: ProbeCoverage
  violations: string[]
  bounds: ProbeBounds
}

const readPreview = (page: Page): Promise<PreviewReading> => page.evaluate(() => {
  const probe = (window as unknown as {
    __previewCamera?: {
      bounds: ProbeBounds
      state: () => ProbeState
      coverage: () => ProbeCoverage
      violations: () => string[]
    }
  }).__previewCamera
  if (!probe) throw new Error('preview camera probe is missing')
  return {
    state: probe.state(),
    coverage: probe.coverage(),
    violations: probe.violations(),
    bounds: {
      wallX: probe.bounds.wallX,
      wallZ: probe.bounds.wallZ,
      floorY: probe.bounds.floorY,
      minDistance: probe.bounds.minDistance,
      maxDistance: probe.bounds.maxDistance,
    },
  }
})

const containsProbe = (page: Page) => page.evaluate(() =>
  Boolean((window as unknown as { __previewCamera?: unknown }).__previewCamera))

/** Poll until damping stops moving the camera (frameloop=demand keeps advancing while damping). */
async function settleCamera(page: Page) {
  let previous = ''
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const key = await page.evaluate(() => {
      const probe = (window as unknown as { __previewCamera?: { state: () => ProbeState } }).__previewCamera
      if (!probe) return 'missing'
      return probe.state().position.map((value) => value.toFixed(4)).join(',')
    })
    if (key === previous) return
    previous = key
    await page.waitForTimeout(150)
  }
}

async function openPreview(page: Page) {
  await page.goto('/projects/demo-dorm-101/setup')
  await expect(page.locator('canvas')).toBeVisible()
  await expect.poll(() => containsProbe(page)).toBe(true)
  await settleCamera(page)
}

async function canvasCentre(page: Page) {
  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('preview canvas has no bounding box')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

async function dragCanvas(page: Page, dx: number, dy: number) {
  const centre = await canvasCentre(page)
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + dx, centre.y + dy, { steps: 5 })
  await page.mouse.up()
  await settleCamera(page)
}

async function zoomCanvas(page: Page, notches: number, delta: number) {
  const centre = await canvasCentre(page)
  await page.mouse.move(centre.x, centre.y)
  for (let index = 0; index < notches; index += 1) await page.mouse.wheel(0, delta)
  await settleCamera(page)
}

/** Rendered-image variance: a blank canvas or one opaque wall filling the view scores near zero. */
async function imageVariance(page: Page, png: Buffer): Promise<number> {
  return page.evaluate(async (base64) => {
    const image = new Image()
    image.src = `data:image/png;base64,${base64}`
    await image.decode()
    const sample = document.createElement('canvas')
    sample.width = sample.height = 96
    const ctx = sample.getContext('2d')!
    ctx.drawImage(image, 0, 0, 96, 96)
    const data = ctx.getImageData(0, 0, 96, 96).data
    const values = Array.from({ length: data.length / 4 }, (_, i) => (data[i * 4] + data[i * 4 + 1] + data[i * 4 + 2]) / 3)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  }, png.toString('base64'))
}

const orbitRadius = (state: ProbeState) => Math.hypot(
  state.position[0] - state.target[0],
  state.position[1] - state.target[1],
  state.position[2] - state.target[2],
)

/** Every reading must stay inside the room shell and outside furniture. */
async function expectLegalCamera(page: Page, label: string) {
  const reading = await readPreview(page)
  const [x, y, z] = reading.state.position
  expect(reading.violations, `${label}: no wall backside / floor / furniture penetration`).toEqual([])
  expect(z, `${label}: stays in front of the back wall`).toBeGreaterThanOrEqual(reading.bounds.wallZ - 1e-4)
  expect(x, `${label}: stays in front of the left wall`).toBeGreaterThanOrEqual(reading.bounds.wallX - 1e-4)
  expect(y, `${label}: stays above the floor`).toBeGreaterThanOrEqual(reading.bounds.floorY - 1e-4)
  return reading
}

test('preview camera never looks at a wall backside while orbiting and zooming', async ({ page }, testInfo) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))

  await openPreview(page)

  const initial = await expectLegalCamera(page, 'initial framing')
  expect(initial.coverage.complete, 'the whole furniture set is in frame on open').toBe(true)
  expect(initial.coverage.cornersInFrame).toBe(initial.coverage.corners)
  expect(initial.state.position[2], 'initial view comes from the open front side').toBeGreaterThan(initial.bounds.wallZ)
  await page.screenshot({ path: testInfo.outputPath('preview-initial.png') })

  // Continuous horizontal orbit in both directions: the camera has to stop at the interior
  // boundary instead of sliding around the walls.
  for (const [label, dx] of [['right', 700], ['right', -1400], ['left', 1400]] as const) {
    await dragCanvas(page, dx, 0)
    const reading = await expectLegalCamera(page, `horizontal drag ${label}`)
    expect(reading.state.position[2], `horizontal drag ${label}: behind-the-wall guard`)
      .toBeGreaterThanOrEqual(reading.bounds.wallZ - 1e-4)
  }
  await page.screenshot({ path: testInfo.outputPath('preview-orbit-limit.png') })

  // Vertical orbit: up towards a top view, then down towards a level view (never below the floor).
  for (const [label, dy] of [['up', -500], ['down', 800]] as const) {
    await dragCanvas(page, 0, dy)
    await expectLegalCamera(page, `vertical drag ${label}`)
  }

  // Zoom out to the framing limit and back in towards the furniture.
  const radiusBefore = orbitRadius((await readPreview(page)).state)
  await zoomCanvas(page, 8, 240)
  const zoomedOut = await expectLegalCamera(page, 'zoom out')
  expect(orbitRadius(zoomedOut.state), 'zoom-out really moves outwards').toBeGreaterThan(radiusBefore)
  expect(orbitRadius(zoomedOut.state), 'zoom-out stops at the framing limit')
    .toBeLessThanOrEqual(zoomedOut.bounds.maxDistance + 1e-3)
  await zoomCanvas(page, 14, -240)
  const zoomedIn = await expectLegalCamera(page, 'zoom in')
  expect(orbitRadius(zoomedIn.state), 'zoom-in really moves inwards').toBeLessThan(orbitRadius(zoomedOut.state))
  expect(orbitRadius(zoomedIn.state), 'zoom-in stops before entering the desk / bed volumes')
    .toBeGreaterThanOrEqual(zoomedIn.bounds.minDistance - 1e-3)
  await page.screenshot({ path: testInfo.outputPath('preview-zoom-in.png') })

  // Panning is disabled in this mode: a right-drag must not move the orbit target.
  const beforePan = await readPreview(page)
  const centre = await canvasCentre(page)
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(centre.x + 200, centre.y + 120, { steps: 5 })
  await page.mouse.up({ button: 'right' })
  await settleCamera(page)
  const afterPan = await expectLegalCamera(page, 'right-drag pan attempt')
  expect(afterPan.state.target).toEqual(beforePan.state.target)

  // The scene must stay populated: an opaque wall filling the canvas means the camera left the room.
  const png = await page.screenshot()
  expect(await imageVariance(page, png), 'the preview keeps rendering the room interior').toBeGreaterThan(20)

  expect(failures, 'no runtime errors on the setup page').toEqual([])
})

test('preview keeps a single framing preset and a short interaction hint', async ({ page }) => {
  await openPreview(page)

  await expect(page.getByRole('button', { name: '透视' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '正视' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '俯视' })).toHaveCount(0)
  await expect(page.getByText('拖动旋转 · 滚轮缩放 · 不会绕到墙后')).toBeVisible()
})

test('workspace viewport keeps the unrestricted camera (no preview probe, orbit still works)', async ({ page }, testInfo) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))

  await page.goto('/projects/demo-dorm-101/workspace')
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  await page.waitForTimeout(800)
  expect(await containsProbe(page), 'workspace camera is not in constrained mode').toBe(false)

  const box = await canvas.boundingBox()
  if (!box) throw new Error('workspace canvas has no bounding box')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 240, box.y + box.height / 2 - 110, { steps: 5 })
  await page.mouse.up()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: testInfo.outputPath('workspace-orbit.png') })

  const png = await page.screenshot()
  expect(await imageVariance(page, png), 'workspace canvas still renders the scene after orbiting').toBeGreaterThan(20)
  expect(failures, 'no runtime errors on the workspace page').toEqual([])
})
