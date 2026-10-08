import type { TestProject } from 'vitest/node'
import { startPushReceiver } from './push-receiver'
import { startServer, type StartedServer } from './server'

declare module 'vitest' {
  export interface ProvidedContext {
    serverUrl: string
    /** True if the suite started the server itself (not SERVER_URL). */
    managedServer: boolean
    pushEndpointBase: string
    pushControl: string
  }
}

/**
 * Starts the fake push service and, unless SERVER_URL points to a running server, the server
 * under test (SERVER_CMD). Everything is stopped again after the run.
 */
export default async function setup(project: TestProject) {
  const receiver = await startPushReceiver()
  let server: StartedServer | undefined
  const external = process.env.SERVER_URL?.replace(/\/+$/, '')
  try {
    if (!external) server = await startServer()
  } catch (error) {
    await receiver.close()
    throw error
  }
  project.provide('serverUrl', external ?? server!.url)
  project.provide('managedServer', !external)
  project.provide('pushEndpointBase', receiver.endpointBase)
  project.provide('pushControl', receiver.control)

  return async () => {
    await server?.stop()
    await receiver.close()
  }
}
