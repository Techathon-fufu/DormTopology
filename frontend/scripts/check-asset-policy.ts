import assert from 'node:assert/strict'
import { assertAssetUrl } from '../src/scene/assetPolicy'
import { loadModelFromUrl } from '../src/scene/modelLoader'
import { createDemoProject } from '../src/data/demoProject'
import { toRoutingScene } from '../src/api/core/routingWire'

for (const url of ['objects/desk.glb', '/objects/desk.glb', '../objects/desk.glb',
  'C:\\project\\objects\\desk.glb', 'https://host/%6fbjects/desk.glb', '/%256fbjects%252fdesk.glb']) {
  assert.throws(() => assertAssetUrl(url), /禁止引用 objects/)
  await assert.rejects(loadModelFromUrl(url), /禁止引用 objects/, 'reject before loading Three or making a request')
  const project = createDemoProject()
  project.objects[0].model.assetUrl = url
  assert.throws(() => toRoutingScene({ project, confirmed: true }), /禁止引用 objects/)
}
for (const url of ['/models/dormdesk_parts/dormdesk_body.glb', 'Prefabmodel/monitor.glb', 'blob:https://example.test/123']) {
  assert.equal(assertAssetUrl(url), url)
}
console.log('Retired assets rejected at model loading and planning boundaries; official assets remain usable.')
