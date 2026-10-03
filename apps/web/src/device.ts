import { ref } from 'vue'
import { ApiError, api } from './api'

/**
 * Registration state of this browser profile (device id from the local DB, ADR 0009).
 * - `unknown`: not registered yet in this session (offline start) – operations still carry the id.
 * - `revoked`: removed from the account; the server rejects its operations, local data stays.
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

/** Registers the device (idempotent); called on every online refresh. Never throws. */
export async function registerDevice(
  deviceId: string,
  registerImpl = api.registerDevice,
  userAgent = globalThis.navigator?.userAgent ?? '',
): Promise<DeviceStatus> {
  try {
    await registerImpl({ id: deviceId, name: defaultDeviceName(userAgent) })
    deviceStatus.value = 'registered'
  } catch (error) {
    if (error instanceof ApiError && error.code === 'device_revoked') deviceStatus.value = 'revoked'
    // Offline or expired: try again on the next refresh.
  }
  return deviceStatus.value
}
