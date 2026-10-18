import { expect, test } from '@playwright/test'

test('JSON and upload requests omit cookies from other loopback ports', async ({ page, context, baseURL }) => {
  await context.addCookies([{ name: 'unrelated-local-session-test', value: 'synthetic-test-only', url: baseURL! }])
  await page.goto('/routing-demo')
  const cookies: Array<string | undefined> = []
  await page.route('**/api/v1/cookie-isolation-probe', async route => {
    cookies.push((await route.request().allHeaders()).cookie)
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.evaluate(async () => {
    const modulePath = '/src/api/core/client.ts'
    const { requestJson, requestMultipart } = await import(modulePath)
    await requestJson('/cookie-isolation-probe')
    await requestJson('/cookie-isolation-probe', { method: 'PUT', body: { test: true } })
    await requestMultipart('/cookie-isolation-probe', new FormData())
  })
  expect(cookies).toEqual([undefined, undefined, undefined])
  expect((await context.cookies()).some(cookie => cookie.name === 'unrelated-local-session-test')).toBe(true)
})

test('accepting the built-in demo queries its baseline-scoped scene', async ({ page }) => {
  await page.goto('/routing-demo')
  const result = await page.evaluate(async () => {
    const modules = ['/src/state/projectsStore.ts', '/src/state/plansStore.ts', '/src/api/core/routingWire.ts',
      '/src/features/connections/routingPreview.ts', '/src/api/core/packingWire.ts']
    const [projects, plans, wire, preview, packing] = await Promise.all(modules.map(path => import(path)))
    const fixture = await (await fetch('/routing-demo/fixed-desk.json')).json()
    const project = fixture.project
    projects.useProjectsStore.setState({ projects: { [project.id]: project } })
    plans.usePlansStore.getState().captureBaseline(project)
    const baseline = plans.usePlansStore.getState().baselines[project.id].id
    const expectedPath = `/api/v1/projects/${encodeURIComponent(`${project.id}:${baseline}`)}/scene`
    const mapped = wire.mapRoutingResult(fixture.result, { project, scene: fixture.scene })
    preview.useRoutingPreviewStore.getState().stage(project, mapped, baseline)
    const originalFetch = window.fetch
    const paths: string[] = []
    window.fetch = async (url) => {
      const path = String(url)
      paths.push(path)
      if (path !== expectedPath) return new Response('{}', { status: 404 })
      return new Response(JSON.stringify(wire.toRoutingScene({ project, confirmed: true, ref: packing.sceneRef(fixture.scene) })))
    }
    try {
      const summary = await preview.acceptRoutingPreview(project, baseline)
      return { summary, paths, expectedPath }
    } finally { window.fetch = originalFetch }
  })
  expect(result.summary).toEqual({ applied: 7, skipped: 0 })
  expect(result.paths).toEqual([result.expectedPath])
})
