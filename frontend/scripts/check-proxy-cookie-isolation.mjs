import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { createServer } from 'vite'

// Only synthetic cookies; never read browser profiles or user credentials.
let receivedCookie
const upstream = createHttpServer((request, response) => {
  receivedCookie = request.headers.cookie
  response.setHeader('Set-Cookie', 'upstream-test=synthetic; Path=/')
  response.setHeader('Content-Type', 'application/json')
  response.end('{}')
})
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
const previous = process.env.VITE_DEV_API_TARGET
process.env.VITE_DEV_API_TARGET = `http://127.0.0.1:${upstream.address().port}`
let vite
try {
  vite = await createServer({ configFile: 'vite.config.ts', server: { host: '127.0.0.1', port: 0, open: false } })
  await vite.listen()
  const port = vite.httpServer.address().port
  const response = await fetch(`http://127.0.0.1:${port}/api/v1/health`, { headers: { Cookie: 'unrelated-test=synthetic' } })
  assert.equal(response.status, 200)
  assert.equal(receivedCookie, undefined, 'proxy must strip incoming cookies before backend forwarding')
  assert.equal(response.headers.get('set-cookie'), null, 'proxy must not set backend cookies on the shared local host')
  console.log('Actual Vite proxy strips request Cookie and response Set-Cookie.')
} finally {
  await vite?.close()
  await new Promise(resolve => upstream.close(resolve))
  if (previous === undefined) delete process.env.VITE_DEV_API_TARGET
  else process.env.VITE_DEV_API_TARGET = previous
}
