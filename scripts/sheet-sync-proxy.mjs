import { createServer, request } from 'node:http'

const CRM_HOST = '127.0.0.1'
const CRM_PORT = 3000
const PROXY_HOST = '127.0.0.1'
const PROXY_PORT = 3210
const MAX_BODY_BYTES = 1024 * 1024
const ROUTES = new Map([
  ['/api/sync/sheet/status', 'GET'],
  ['/api/sync/sheet/pull', 'GET'],
  ['/api/sync/sheet/push', 'POST'],
  ['/api/sync/sheet/ack', 'POST'],
])

const server = createServer((incoming, outgoing) => {
  const path = (incoming.url || '').split('?')[0]
  const method = ROUTES.get(path)

  if (!method) {
    outgoing.writeHead(404, { 'content-type': 'application/json' })
    outgoing.end('{"success":false,"code":"NOT_FOUND"}')
    return
  }
  if (incoming.method !== method) {
    outgoing.writeHead(405, { allow: method })
    outgoing.end()
    return
  }

  let received = 0
  incoming.on('data', chunk => {
    received += chunk.length
    if (received > MAX_BODY_BYTES) incoming.destroy()
  })

  const upstream = request({
    hostname: CRM_HOST,
    port: CRM_PORT,
    path: incoming.url,
    method: incoming.method,
    headers: { ...incoming.headers, host: `${CRM_HOST}:${CRM_PORT}` },
  }, response => {
    outgoing.writeHead(response.statusCode || 502, response.headers)
    response.pipe(outgoing)
  })

  upstream.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'application/json' })
    outgoing.end('{"success":false,"code":"CRM_UNAVAILABLE"}')
  })
  incoming.pipe(upstream)
})

server.listen(PROXY_PORT, PROXY_HOST, () => {
  console.log(`Sheet-sync proxy listening on http://${PROXY_HOST}:${PROXY_PORT}`)
})
