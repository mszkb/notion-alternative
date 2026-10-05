import { ref } from 'vue'
import { ApiError, api } from './api'

/**
 * Registration state of this browser profile (device id from the local DB, ADR 0009).
 * - `unknown`: not registered yet in this session (offline start) – operations still carry the id.
 * - `revoked`: removed from the account; the server rejects its operations, local data stays.
 *   After signing in again the device continues under a new id (#46).
 */
export type DeviceStatus = 'unknown' | 'registered' | 'revoked'

export const deviceStatus = ref<DeviceStatus>('unknown')

/** Readable default name, e.g. "Firefox auf Linux"; the user can rename it later. */
export function defaultDeviceName(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrom(e|ium)\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : 'Browser'
  const os = /Android/.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent)
      ? 'iOS'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux|X11/.test(userAgent)
            ? 'Linux'
            : null
  return os ? `${browser} auf ${os}` : browser
}

/** What registration needs from the local store. */
export interface DeviceIdentity {
  readonly deviceId: string
  replaceDeviceId(): Promise<string>
}

/**
 * Registers the device (idempotent); called on every online refresh. Never throws.
 *
 * A device removed from the account loses its sessions, so the server answers `device_revoked`
 * only after the user signed in again. The device then continues under a new id, with its queued
 * changes (#46). The old id stays removed.
 */
export async function registerDevice(
  device: DeviceIdentity,
  registerImpl = api.registerDevice,
  userAgent = globalThis.navigator?.userAgent ?? '',
): Promise<DeviceStatus> {
  const name = defaultDeviceName(userAgent)
  try {
    try {
      await registerImpl({ id: device.deviceId, name })
    } catch (error) {
      if (!(error instanceof ApiError && error.code === 'device_revoked')) throw error
      await registerImpl({ id: await device.replaceDeviceId(), name })
    }
    deviceStatus.value = 'registered'
  } catch (error) {
    if (error instanceof ApiError && error.code === 'device_revoked') deviceStatus.value = 'revoked'
    // Offline or expired: try again on the next refresh.
  }
  return deviceStatus.value
}
