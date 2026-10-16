/**
 * Dates and times as shown in the app: German format, independent of the browser's locale
 * (#198), e.g. "13.10.2026, 09:46".
 */
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
const time = new Intl.DateTimeFormat('de-DE', { timeStyle: 'short' })

/** Date and time without seconds, e.g. "13.10.2026, 09:46". */
export function formatDateTime(value: string | number | Date): string {
  return dateTime.format(new Date(value))
}

/** Time without seconds, e.g. "09:46". */
export function formatTime(value: string | number | Date): string {
  return time.format(new Date(value))
}
