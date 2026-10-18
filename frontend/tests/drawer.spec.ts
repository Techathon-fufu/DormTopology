import { expect, test, type Page, type TestInfo } from '@playwright/test'
import * as THREE from 'three'
import type { ViewPreset } from '../src/state/workspaceStore'

const demoProjectId = 'demo-dorm-101'

/**
 * 抽屉推拉端到端：单击开 / 关、拖拽跟手 + 松手吸附、Esc 回弹、拖拽期相机锁定。
 *
 * 说明：
 * - 抽屉正面朝 -x（与清单 pull_axis=-x 一致），默认透视机位（右前上方）看不到抽屉正面；
 *   用例通过 workspaceStore 切到「左视」预设。左视预设置为室内对角线机位
 *   [-1.05, 1.35, 1.95] → 目标 [0.55, 0.6, 0.7]，从室内射向抽屉正面的视线首个命中
 *   即真实抽屉前板（不与不透明左墙 / 重叠演示物冲突，见 .work/merge-prefab/drawer-probe.log）；
 * - 鼠标坐标在 Node 侧用 three 按同一机位复算投影（fov 42 与 Viewport Canvas 一致）；
 *   Canvas 视口宽高比会影响 CameraRig 的 distanceScale=zoomOut*Math.max(1,
 *   1.1/(box.width/box.height))（zoomOut=1），据此把相机位置从预设位置沿 target→pos
 *   方向放缩，复算出与生产一致的相机位置；
 * - 交互结果通过页面内动态导入 drawerStore 模块（Vite 已加载的同一实例）读取，
 *   与 workspace.spec.ts 的 jobsStore 口径一致。
 *
 * 关键测试约束：抽屉前板位置随 progress 缓动，命中测试只在抽屉真正停稳后进行；
 * 因此每次对「全开 / 全关」屏幕坐标点击前，必须等待 progress 收敛（settled），
 * 否则点击会落在仍在移动的网格上（射线落空 → 不进 onPointerDown → target 不变）。
 */

/** 与 CameraRig 左视预设完全一致（室内对角线机位，正对抽屉正面） */
const LEFT_VIEW = {
  position: [-1.05, 1.35, 1.95] as const,
  target: [0.55, 0.6, 0.7] as const,
  fov: 42,
  /** 与 CameraRig 一致：zoomOut 默认 1 */
  zoomOut: 1,
}

/** 上层抽屉前板中心（归一化后 app 坐标）与全开行程（米） */
const TOP_FRONT_CLOSED = [0.619, 0.6175, 0.6705] as const
/** 上层抽屉盒体中心（拖拽投影基准，与 useDrawerInteraction 相同口径） */
const TOP_BOX_CENTER_CLOSED = [0.771, 0.6175, 0.6705] as const
const TOP_TRAVEL_M = 0.3

/** progress 收敛阈值：靠近端点即认为缓动停稳，可安全对端点屏幕坐标做命中测试 */
const SETTLED_EPS = 0.0001

interface DrawerSnapshot {
  loadedIds: string[]
  draggingId: string | null
  drawers: Record<'bot' | 'mid' | 'top', { progress: number; target: 0 | 1 }>
}

async function readDrawers(page: Page): Promise<DrawerSnapshot> {
  return page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === '/src/state/drawerStore.ts')
      .at(-1)
    if (!moduleUrl) throw new Error('The workspace did not load drawerStore.ts')
    const { useDrawerStore } = await import(moduleUrl)
    const state = useDrawerStore.getState()
    return { loadedIds: state.loadedIds, draggingId: state.draggingId, drawers: state.drawers }
  })
}

/** 等待 top 抽屉缓动停稳到端点（progress≈target），确保命中测试命中真实网格 */
async function waitForTopSettled(page: Page, endpoint: 0 | 1) {
  await expect.poll(async () => {
    const { drawers, draggingId } = await readDrawers(page)
    if (draggingId !== null) return false
    const { progress, target } = drawers.top
    if (target !== endpoint) return false
    return Math.abs(progress - endpoint) <= SETTLED_EPS
  }).toBe(true)
}

async function applyViewPreset(page: Page, preset: ViewPreset) {
  await page.evaluate(async (value) => {
    const moduleUrl = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => new URL(name).pathname === '/src/state/workspaceStore.ts')
      .at(-1)
    if (!moduleUrl) throw new Error('The workspace did not load workspaceStore.ts')
    const { useWorkspaceStore } = await import(moduleUrl)
    useWorkspaceStore.getState().setViewPreset(value)
  }, preset)
}

interface CanvasBox {
  x: number
  y: number
  width: number
  height: number
}

/** CameraRig 有效机位：从预设 pos/target 按 distanceScale 沿 (pos - target) 缩放 */
function effectiveCamera(box: CanvasBox) {
  const distanceScale = LEFT_VIEW.zoomOut * Math.max(1, 1.1 / (box.width / Math.max(1, box.height)))
  const tx = LEFT_VIEW.target[0]
  const ty = LEFT_VIEW.target[1]
  const tz = LEFT_VIEW.target[2]
  return {
    position: [
      tx + (LEFT_VIEW.position[0] - LEFT_VIEW.target[0]) * distanceScale,
      ty + (LEFT_VIEW.position[1] - LEFT_VIEW.target[1]) * distanceScale,
      tz + (LEFT_VIEW.position[2] - LEFT_VIEW.target[2]) * distanceScale,
    ] as const,
    target: [tx, ty, tz] as const,
  }
}

function projectPoint(box: CanvasBox, point: readonly [number, number, number]) {
  const camera = new THREE.PerspectiveCamera(LEFT_VIEW.fov, box.width / box.height, 0.1, 200)
  const view = effectiveCamera(box)
  camera.position.set(view.position[0], view.position[1], view.position[2])
  camera.lookAt(new THREE.Vector3(view.target[0], view.target[1], view.target[2]))
  camera.updateMatrixWorld()
  const projected = new THREE.Vector3(point[0], point[1], point[2]).project(camera)
  return {
    x: box.x + ((projected.x + 1) / 2) * box.width,
    y: box.y + ((1 - projected.y) / 2) * box.height,
  }
}

/** 全行程在屏幕上的位移（像素），与 useDrawerInteraction 的投影基准一致 */
function travelVectorPx(box: CanvasBox, center: readonly [number, number, number]) {
  const from = projectPoint(box, center)
  const to = projectPoint(box, [center[0] - TOP_TRAVEL_M, center[1], center[2]])
  return { dx: to.x - from.x, dy: to.y - from.y, length: Math.hypot(to.x - from.x, to.y - from.y) }
}

async function moveAlong(page: Page, from: { x: number; y: number }, vector: { dx: number; dy: number }, factor: number, steps = 6) {
  for (let index = 1; index <= steps; index += 1) {
    const ratio = (factor * index) / steps
    await page.mouse.move(from.x + vector.dx * ratio, from.y + vector.dy * ratio)
  }
}

async function attachViewport(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: false, scale: 'css', animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

test('toggles, drags and cancels the top desk drawer from the left view', async ({ page }, testInfo) => {
  const failures: string[] = []
  page.on('pageerror', (error) => failures.push(error.message))
  await page.goto(`/projects/${demoProjectId}/workspace`)
  await expect(page.getByRole('banner').getByTitle('示例：上床下桌·四人间')).toBeVisible()
  await expect(page.locator('canvas')).toBeVisible()

  // 桌体分离件（无抽屉桌体 + 三只抽屉）加载完成后抽屉才可交互
  await expect.poll(async () => (await readDrawers(page)).loadedIds.length).toBe(3)

  // 抽屉正面朝 -x：切到左视（预设仅驱动相机，不改变抽屉状态）
  await applyViewPreset(page, 'left')
  await page.waitForTimeout(250)
  const box = (await page.locator('canvas').boundingBox())!
  const closed = projectPoint(box, TOP_FRONT_CLOSED)
  const open = projectPoint(box, [TOP_FRONT_CLOSED[0] - TOP_TRAVEL_M, TOP_FRONT_CLOSED[1], TOP_FRONT_CLOSED[2]])
  const closedVector = travelVectorPx(box, TOP_BOX_CENTER_CLOSED)
  const openVector = travelVectorPx(box, [TOP_BOX_CENTER_CLOSED[0] - TOP_TRAVEL_M, TOP_BOX_CENTER_CLOSED[1], TOP_BOX_CENTER_CLOSED[2]])
  expect(closedVector.length, '滑出轴在屏幕上应有可辨识的位移（拖拽投影可用）').toBeGreaterThan(6)

  // 1) 单击：关 → 开（先等初始 settled，确认从全关坐标起点击）
  await waitForTopSettled(page, 0)
  await page.mouse.click(closed.x, closed.y)
  await expect.poll(async () => (await readDrawers(page)).drawers.top.target).toBe(1)
  // 必须等到缓动停稳，front-panel 才真正到达 open 屏幕坐标
  await waitForTopSettled(page, 1)

  // 2) 单击：开 → 关（前板此时已停稳在全开位置；open 坐标即真实网格位置）
  await page.mouse.click(open.x, open.y)
  await expect.poll(async () => (await readDrawers(page)).drawers.top.target).toBe(0)
  await waitForTopSettled(page, 0)

  // 3) 取消（未拖拽）：按下后立即 Esc，不应切换抽屉、drggingId 应归零
  await page.mouse.move(closed.x, closed.y)
  await page.mouse.down()
  expect((await readDrawers(page)).draggingId).toBe('top')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  expect((await readDrawers(page)).draggingId).toBe(null)
  await expect.poll(async () => (await readDrawers(page)).drawers.top.target).toBe(0)
  await waitForTopSettled(page, 0)

  // 4) 拖拽跟手：按住前板沿滑出方向拖出（超程 2.5 倍 → 全开），拖拽期间相机锁定
  await page.mouse.move(closed.x, closed.y)
  await page.mouse.down()
  await moveAlong(page, closed, closedVector, 2.5)
  await expect.poll(async () => (await readDrawers(page)).draggingId).toBe('top')
  await page.mouse.up()
  expect((await readDrawers(page)).draggingId).toBe(null)
  await expect.poll(async () => (await readDrawers(page)).drawers.top.target).toBe(1)
  await waitForTopSettled(page, 1)

  // 5) Esc 回弹：从全开拖回约 20% 处按 Esc → 吸附到最近吸附点（全关）
  await page.mouse.move(open.x, open.y)
  await page.mouse.down()
  await moveAlong(page, open, openVector, -0.8)
  expect((await readDrawers(page)).draggingId).toBe('top')
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await expect.poll(async () => (await readDrawers(page)).drawers.top.target).toBe(0)
  await waitForTopSettled(page, 0)
  expect((await readDrawers(page)).draggingId).toBe(null)

  await attachViewport(page, testInfo, 'drawer-left-view')
  expect(failures).toEqual([])
})

test('drawer contents fit the cavity, open on placement and keep closed-frame coordinates', async ({ page }, testInfo) => {
  await page.goto(`/projects/${demoProjectId}/workspace`)
  await expect.poll(async () => (await readDrawers(page)).loadedIds.length).toBe(3)

  const result = await page.evaluate(async () => {
    const loaded = (path: string) => performance.getEntriesByType('resource')
      .map((entry) => entry.name).find((name) => new URL(name).pathname === path)
    const fixedUrl = loaded('/src/scene/fixedFurniture.ts')
    const validationUrl = loaded('/src/scene/sceneValidation.ts')
    const workspaceUrl = loaded('/src/state/workspaceStore.ts')
    const projectsUrl = loaded('/src/state/projectsStore.ts')
    if (!fixedUrl || !validationUrl || !workspaceUrl || !projectsUrl) throw new Error('Scene modules did not load')
    const { drawerSlotForObject } = await import(fixedUrl)
    const { placementIssues, raycastSupports } = await import(validationUrl)
    const threeUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname === '/node_modules/.vite/deps/three.js')
    if (!threeUrl) throw new Error('Three.js module did not load')
    const { Raycaster, Vector3 } = await import(threeUrl)
    const { useWorkspaceStore } = await import(workspaceUrl)
    const { useProjectsStore } = await import(projectsUrl)
    const drawerUrl = loaded('/src/state/drawerStore.ts')
    if (!drawerUrl) throw new Error('Drawer store did not load')
    const { useDrawerStore } = await import(drawerUrl)
    const project = useProjectsStore.getState().projects['demo-dorm-101']
    const existingBlockers = project.objects.filter((item: { visible: boolean }) => item.visible)
      .flatMap((item: typeof project.objects[number]) => placementIssues(item, item.transform.position, project.objects, project.room)
        .filter((issue: { message: string }) => issue.message.includes('挡住'))
        .map((issue: { message: string }) => ({ name: item.name, position: item.transform.position, dimensions: item.dimensions, issue: issue.message })))
    const probe = {
      ...project.objects[0], id: 'drawer-content-probe', name: '抽屉物品测试',
      ports: [], cables: undefined, fixed: false, locked: false, visible: true,
      model: { shape: 'genericBox', status: 'placeholder' },
      dimensions: { width: .08, height: .08, depth: .08 },
      transform: { position: [.78, .549, .65], rotationY: 0 },
    }
    const fit = drawerSlotForObject(probe, probe.transform.position, project.room)
    const partial = drawerSlotForObject(probe, [.635, .549, .65], project.room)
    const mouth = placementIssues(probe, [.48, .549, .65], [probe], project.room)
      .map((issue: { message: string }) => issue.message)
    const valid = placementIssues(probe, probe.transform.position, [probe], project.room)
      .map((issue: { message: string }) => issue.message)
    const hit = raycastSupports(
      new Raycaster(new Vector3(.48, 1, .65), new Vector3(0, -1, 0)).ray,
      project.room, null, { top: -.3 },
    )
    useWorkspaceStore.getState().addObject(project.id, {
      ...probe, transform: { ...probe.transform, position: [0, 0, 1.2] },
    })
    const initiallyClosed = useDrawerStore.getState().drawers.top.target === 0
    useWorkspaceStore.getState().updateObject(project.id, probe.id, { transform: { position: probe.transform.position } }, true)
    const stored = useProjectsStore.getState().projects[project.id].objects.find((item: { id: string }) => item.id === probe.id)
    return { fit, partial, mouth, valid, existingBlockers,
      initiallyClosed, hit: hit && { surface: hit.surfaceId, x: hit.x, y: hit.y }, storedPosition: stored?.transform.position }

  })

  expect(result.fit).toBe('top')
  expect(result.partial).toBeNull()
  expect(result.mouth.some((message: string) => message.includes('挡住上层抽屉开口'))).toBe(true)
  expect(result.valid).toEqual([])
  expect(result.existingBlockers).toEqual([])
  expect(result.initiallyClosed).toBe(true)
  expect(result.hit?.surface).toBe('support-drawer-top')
  expect(result.hit?.x).toBeCloseTo(.48, 5)
  expect(result.hit?.y).toBe(.549)
  expect(result.storedPosition).toEqual([.78, .549, .65])
  await waitForTopSettled(page, 1)
  await applyViewPreset(page, 'left')
  await page.waitForTimeout(250)
  await attachViewport(page, testInfo, 'drawer-with-content-open')
  await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname === '/src/state/drawerStore.ts')!
    const { useDrawerStore } = await import(moduleUrl)
    useDrawerStore.getState().toggle('top')
  })
  await waitForTopSettled(page, 0)
  await attachViewport(page, testInfo, 'drawer-with-content-closed')
  expect(await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource').map((entry) => entry.name)
      .find((name) => new URL(name).pathname === '/src/state/projectsStore.ts')!
    const { useProjectsStore } = await import(moduleUrl)
    return useProjectsStore.getState().projects['demo-dorm-101'].objects
      .find((item: { id: string }) => item.id === 'drawer-content-probe')?.transform.position
  })).toEqual([.78, .549, .65])
})
