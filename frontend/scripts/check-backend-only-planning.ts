import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import type { AppServices } from '../src/api/types'

const root = process.cwd()
assert.ok(existsSync(resolve(root, 'src/api/index.ts')), 'Run this script from frontend/.')
const require = createRequire(resolve(root, 'package.json'))
const { build } = require('esbuild') as typeof import('esbuild')
const overrideKey = 'dormtopology.api-mode-override'

type FixtureExports = {
  services: AppServices
  httpServices: AppServices
  mockRecognitionService: AppServices['recognition']
  mockModelGenerationService: AppServices['modelGeneration']
  isMockMode: boolean
  hasRealServices: boolean
}

const cases: { name: string; env: Record<string, string>; override?: string; providerMode?: 'mock' | 'real' }[] = [
  { name: 'default environment', env: {} },
  { name: 'old stored mock override', env: {}, override: 'mock' },
  { name: 'global mock', env: { VITE_API_MODE: 'mock' }, override: 'mock' },
  { name: 'organization mock', env: { VITE_ORGANIZATION_API_MODE: 'mock' }, override: 'mock' },
  { name: 'cable mock', env: { VITE_CABLE_API_MODE: 'mock' }, override: 'mock' },
  { name: 'legacy service mock', env: { VITE_SERVICE_MODE: 'mock' }, override: 'mock' },
  { name: 'all old mock settings', env: { VITE_API_MODE: 'mock', VITE_ORGANIZATION_API_MODE: 'mock', VITE_CABLE_API_MODE: 'mock' }, override: 'mock' },
  { name: 'real providers ignore stored mock override', env: { VITE_API_MODE: 'real' }, override: 'mock', providerMode: 'real' },
  { name: 'mock providers ignore stored real override', env: { VITE_API_MODE: 'mock' }, override: 'real' },
  { name: 'legacy service providers', env: { VITE_SERVICE_MODE: 'service' }, providerMode: 'real' },
  { name: 'global setting takes precedence for providers', env: { VITE_API_MODE: 'mock', VITE_SERVICE_MODE: 'service' } },
]

for (const scenario of cases) {
  const bundle = await build({
    absWorkingDir: root,
    stdin: {
      contents: `
        export { services, isMockMode, hasRealServices } from './src/api';
        export { httpServices } from './src/api/http';
        export { mockRecognitionService } from './src/api/mock/recognition';
        export { mockModelGenerationService } from './src/api/mock/modelGeneration';
      `,
      resolveDir: root,
      sourcefile: 'backend-only-planning-fixture.ts',
      loader: 'ts',
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    metafile: true,
    define: { 'import.meta.env': JSON.stringify(scenario.env) },
    logLevel: 'silent',
  })
  const values = new Map<string, string>(scenario.override ? [[overrideKey, scenario.override]] : [])
  const module = { exports: {} as FixtureExports }
  runInNewContext(bundle.outputFiles[0].text, {
    module, exports: module.exports, require, console,
    process, setTimeout, clearTimeout,
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  }, { filename: scenario.name, timeout: 10_000 })
  const fixture = module.exports
  for (const capability of ['layoutPlanning', 'organizationPlanning', 'cablePlanning'] as const) {
    assert.equal(fixture.services[capability], fixture.httpServices[capability], `${scenario.name}: ${capability} must always call the backend`)
  }
  const providerMode = scenario.providerMode ?? 'mock'
  assert.equal(fixture.services.mode, providerMode, `${scenario.name}: provider environment remains explicit`)
  assert.equal(fixture.isMockMode, providerMode === 'mock')
  assert.equal(fixture.hasRealServices, true, `${scenario.name}: backend health checks remain enabled`)
  assert.equal(fixture.services.recognition, providerMode === 'real' ? fixture.httpServices.recognition : fixture.mockRecognitionService)
  assert.equal(fixture.services.modelGeneration, providerMode === 'real' ? fixture.httpServices.modelGeneration : fixture.mockModelGenerationService)
  assert.ok(!Object.keys(bundle.metafile!.inputs).some((path) => /api\/mock\/(index|layoutPlanning|organizationPlanning|cablePlanning)\.ts$/.test(path)), `${scenario.name}: browser service assembly must not load local planning adapters`)
}

console.log(`Backend-only planning checks passed: ${cases.length} isolated configurations, all planning uses HTTP, legacy overrides are ignored, and provider modes remain explicit.`)
