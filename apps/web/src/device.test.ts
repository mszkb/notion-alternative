import { beforeEach, describe, expect, it } from 'vitest'
import { ApiError } from './api'
import { defaultDeviceName, deviceStatus, registerDevice } from './device'

const ID = '22222222-2222-4222-8222-222222222222'

describe('defaultDeviceName', () => {
  it.each([
    ['Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0', 'Firefox auf Linux'],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
      'Edge auf Windows',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Safari auf iOS',
    ],
    [
      'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
      'Chrome auf Android',
    ],
    ['curl/8.0', 'Browser'],
  ])('%s → %s', (ua, name) => {
    expect(defaultDeviceName(ua)).toBe(name)
  })
})

describe('registerDevice', () => {
  beforeEach(() => {
    deviceStatus.value = 'unknown'
  })

  function identity(id = ID) {
    const device = {
      deviceId: id,
      replaced: 0,
      async replaceDeviceId() {
        device.replaced++
        device.deviceId = `${id}-new`
        return device.deviceId
      },
    }
    return device
  }

  it('sends the stable id with a default name', async () => {
    let sent: unknown
    const status = await registerDevice(
      identity(),
      async (input) => {
        sent = input
        return { device: { ...input, createdAt: '', lastSeenAt: '', current: true } }
      },
      'Firefox/130.0 (X11; Linux)',
    )
    expect(status).toBe('registered')
    expect(sent).toEqual({ id: ID, name: 'Firefox auf Linux' })
  })

  it('ignores network errors', async () => {
    const device = identity()
    expect(
      await registerDevice(device, async () => {
        throw new TypeError('Failed to fetch')
      }),
    ).toBe('unknown')
    expect(device.replaced).toBe(0)
  })

  it('continues under a new id after the device was removed and signed in again (#46)', async () => {
    const device = identity()
    const sent: string[] = []
    const status = await registerDevice(device, async (input) => {
      sent.push(input.id)
      if (input.id === ID) throw new ApiError(403, 'device_revoked', 'removed')
      return { device: { ...input, createdAt: '', lastSeenAt: '', current: true } }
    })
    expect(status).toBe('registered')
    expect(sent).toEqual([ID, `${ID}-new`])
    expect(device.replaced).toBe(1)
  })

  it('stays removed if the new id is refused as well', async () => {
    const device = identity()
    expect(
      await registerDevice(device, async () => {
        throw new ApiError(403, 'device_revoked', 'removed')
      }),
    ).toBe('revoked')
    expect(device.replaced).toBe(1)
  })
})
