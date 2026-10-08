import { readFileSync } from 'node:fs'
import { createServer as createHttpServer, type Server } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { PUSH_RECEIVER_CERT, PUSH_RECEIVER_KEY } from './config'

/** One message the server under test sent to the fake push service. */
export interface Delivery {
  headers: Record<string, string>
  /** Base64 of the encrypted body. */
  body: string
}

export interface PushReceiver {
  /** `https://127.0.0.1:<port>`; subscription endpoints are `<base>/send/<key>`. */
  endpointBase: string
  /** Plain HTTP: `GET <control>/deliveries/<key>` lists what arrived for that key. */
  control: string
  close: () => Promise<void>
}

/**
 * Fake Web Push service (RFC 8030) over HTTPS with the certificate in `fixtures/`.
 * `POST /send/<key>` answers 201, `POST /gone/<key>` answers 410 (subscription expired).
 */
export async function startPushReceiver(): Promise<PushReceiver> {
  const deliveries = new Map<string, Delivery[]>()

  const push = createHttpsServer(
    { cert: readFileSync(PUSH_RECEIVER_CERT), key: readFileSync(PUSH_RECEIVER_KEY) },
    (request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => {
        const match = /^\/(send|gone)\/([\w-]+)$/.exec(request.url ?? '')
        if (request.method !== 'POST' || !match) {
          response.writeHead(404).end()
          return
        }
        const [, mode, key] = match as unknown as [string, string, string]
        const headers = Object.fromEntries(
          Object.entries(request.headers).map(([name, value]) => [name, String(value)]),
        )
        const list = deliveries.get(key) ?? []
        list.push({ headers, body: Buffer.concat(chunks).toString('base64') })
        deliveries.set(key, list)
        response.writeHead(mode === 'gone' ? 410 : 201).end()
      })
    },
  )

  const control = createHttpServer((request, response) => {
    const match = /^\/deliveries\/([\w-]+)$/.exec(request.url ?? '')
    if (!match) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(deliveries.get(match[1]!) ?? []))
  })

  const listen = (server: Server) =>
    new Promise<number>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)),
    )
  const close = (server: Server) => new Promise<void>((resolve) => server.close(() => resolve()))
  const [pushPort, controlPort] = await Promise.all([listen(push), listen(control)])
  return {
    endpointBase: `https://127.0.0.1:${pushPort}`,
    control: `http://127.0.0.1:${controlPort}`,
    close: async () => {
      push.closeAllConnections()
      control.closeAllConnections()
      await Promise.all([close(push), close(control)])
    },
  }
}
