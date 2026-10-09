package net.notionalt.core

import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.random.Random
import kotlin.time.Clock
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

/** Random UUID v4 (same format as `newId` in packages/shared). */
fun newId(random: Random = Random.Default): String {
    val bytes = random.nextBytes(16)
    bytes[6] = ((bytes[6].toInt() and 0x0f) or 0x40).toByte()
    bytes[8] = ((bytes[8].toInt() and 0x3f) or 0x80).toByte()
    val hex = bytes.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
    return "${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20)}"
}

/** ISO timestamp with milliseconds, like `new Date().toISOString()`. */
@OptIn(ExperimentalTime::class)
fun nowIso(): String = Instant.fromEpochMilliseconds(Clock.System.now().toEpochMilliseconds()).toString()

/** "HH:mm" in the device's time zone for an ISO timestamp; the input unchanged if unreadable. */
@OptIn(ExperimentalTime::class)
fun localClock(iso: String, zone: TimeZone = TimeZone.currentSystemDefault()): String =
    runCatching {
        val local = Instant.parse(iso).toLocalDateTime(zone)
        "${local.hour.toString().padStart(2, '0')}:${local.minute.toString().padStart(2, '0')}"
    }.getOrDefault(iso)
