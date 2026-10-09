package net.notionalt.ui

import io.ktor.client.HttpClient
import net.notionalt.core.DriverFactory

/** Platform services, implemented in androidMain (and later iosMain). */
interface Platform {
    val deviceName: String
    /** Version shown in the info dialog, e.g. "0.1.0-dev (1)". */
    val appVersion: String
    val drivers: DriverFactory
    fun httpClient(): HttpClient
    val backgroundSync: BackgroundSync
    val push: PushRegistrar
}

/** Periodic sync while the app is in the background (WorkManager on Android). */
interface BackgroundSync {
    fun schedule()
    fun cancel()
}

/**
 * Push registration (FCM/APNs) comes later; the sync never depends on it (principle 4), so the
 * app works with the no-op implementation.
 */
interface PushRegistrar {
    suspend fun register() {}
    suspend fun unregister() {}
}

object NoopPushRegistrar : PushRegistrar
