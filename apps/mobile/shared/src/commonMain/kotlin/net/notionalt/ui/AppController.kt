package net.notionalt.ui

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import net.notionalt.core.AppSession
import net.notionalt.core.SessionState
import net.notionalt.core.UserContext
import net.notionalt.core.sync.SyncEngine

/**
 * Wires session, local store and sync for the UI (no DI library, ADR 0020). One instance per
 * process; the Android worker uses the same one.
 */
class AppController(val platform: Platform) {
    // A failing background task must never take the app down; the sync status shows errors.
    val scope = CoroutineScope(
        SupervisorJob() + Dispatchers.Default +
            CoroutineExceptionHandler { _, error -> println("Notion Alt: background task failed: $error") },
    )
    val session = AppSession(platform.drivers, platform.httpClient(), platform.deviceName)
    private var watcher: Job? = null
    private var watched: UserContext? = null

    val current: UserContext? get() = (session.state.value as? SessionState.Ready)?.context

    init {
        scope.launch {
            session.state.collect { state ->
                if (state is SessionState.Ready) {
                    watch(state.context)
                    platform.backgroundSync.schedule()
                    requestSync()
                } else {
                    watcher?.cancel()
                    watched = null
                    platform.backgroundSync.cancel()
                }
            }
        }
    }

    /** Sync after local changes, debounced (apps/web/src/sync/triggers.ts). */
    @OptIn(FlowPreview::class)
    private fun watch(context: UserContext) {
        if (watched === context) return
        watcher?.cancel()
        watched = context
        watcher = scope.launch {
            launch {
                context.store.localEdits.drop(1).debounce(2_000).collect {
                    context.sync.refreshCounts()
                    context.sync.sync()
                }
            }
            launch {
                // Periodic sync while the app runs; push is only a hint (principle 4).
                while (true) {
                    delay(5 * 60_000L)
                    context.sync.sync()
                }
            }
        }
    }

    /** Progress or result of "Alles offline verfügbar machen"; survives navigation. */
    val offlineProgress = MutableStateFlow<String?>(null)
    private var offlineJob: Job? = null

    fun makeAllOffline() {
        val context = current ?: return
        if (offlineJob?.isActive == true) return
        offlineProgress.value = "Lade Seiten …"
        offlineJob = scope.launch {
            val loaded = try {
                context.sync.loadAll { done, total -> offlineProgress.value = "Lade Seiten … $done von $total" }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                offlineProgress.value = "Abgebrochen: ${SyncEngine.describe(error)}. Bereits Geladenes bleibt offline verfügbar."
                return@launch
            }
            offlineProgress.value = if (context.store.offlineModeAll()) {
                "Fertig: $loaded Seite(n) geladen. Alle Seiten sind jetzt offline verfügbar. (Antippen zum Schließen)"
            } else {
                "$loaded Seite(n) geladen; einige Seiten konnten nicht geladen werden. (Antippen zum Schließen)"
            }
        }
    }

    fun dismissOfflineProgress() {
        if (offlineJob?.isActive != true) offlineProgress.value = null
    }

    fun requestSync(full: Boolean = false) {
        val context = current ?: return
        scope.launch { context.sync.sync(full) }
    }

    /** For the background worker: one sync run, returns when it is done. */
    suspend fun syncNow() {
        current?.sync?.sync()
    }
}
