package net.notionalt.core.sync

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import net.notionalt.core.api.ApiClient
import net.notionalt.core.api.ApiException
import net.notionalt.core.api.UnreachableException
import net.notionalt.core.model.PushInput
import net.notionalt.core.store.LocalStore
import net.notionalt.core.nowIso

/** What the status line shows. */
data class SyncStatus(
    val running: Boolean = false,
    val online: Boolean = true,
    /** The server no longer accepts the session: local work continues, sync needs a new login. */
    val sessionExpired: Boolean = false,
    val pending: Long = 0,
    val rejected: Int = 0,
    val lastSyncAt: String? = null,
    val lastError: String? = null,
)

/** Server calls the engine needs (an interface so tests can replace the HTTP client). */
interface SyncTransport {
    suspend fun registerDevice(id: String, name: String)
    suspend fun push(input: PushInput): net.notionalt.core.model.PushResponse
    suspend fun pull(workspaceId: String, cursor: Long): net.notionalt.core.model.PullResponse
    suspend fun snapshot(workspaceId: String, after: String?, content: Boolean): net.notionalt.core.model.SnapshotResponse
    suspend fun document(workspaceId: String, documentId: String): net.notionalt.core.model.DocumentResponse
    suspend fun workspaces(): List<net.notionalt.core.model.Workspace>
}

class ApiTransport(private val api: ApiClient) : SyncTransport {
    override suspend fun registerDevice(id: String, name: String) {
        api.registerDevice(id, name)
    }
    override suspend fun push(input: PushInput) = api.push(input)
    override suspend fun pull(workspaceId: String, cursor: Long) = api.pull(workspaceId, cursor)
    override suspend fun snapshot(workspaceId: String, after: String?, content: Boolean) =
        api.snapshot(workspaceId, after, content)
    override suspend fun document(workspaceId: String, documentId: String) = api.document(workspaceId, documentId)
    override suspend fun workspaces() = api.workspaces().workspaces
}

/**
 * Sync of one user's local database (ADR 0002, apps/web/src/sync): register the device, push the
 * queue in batches, then delta pull per workspace, or a paged snapshot when the device never
 * synced the workspace or the server's log no longer reaches the cursor (410). Runs one at a
 * time; failures keep the queue (resending is idempotent).
 */
class SyncEngine(
    private val store: LocalStore,
    private val transport: SyncTransport,
    private val deviceName: String,
) {
    private val mutex = Mutex()
    private val _status = MutableStateFlow(SyncStatus(pending = store.pendingCount(), rejected = store.issues().size))
    val status: StateFlow<SyncStatus> = _status.asStateFlow()
    private var registered = false

    fun refreshCounts() {
        _status.value = _status.value.copy(pending = store.pendingCount(), rejected = store.issues().size)
    }

    /** Runs a sync now; a request while one runs waits for it and then runs again. */
    suspend fun sync(full: Boolean = false) {
        mutex.withLock {
            _status.value = _status.value.copy(running = true)
            try {
                if (!registered) registerDevice()
                pushQueue()
                val workspaces = transport.workspaces()
                store.saveWorkspaces(workspaces)
                for (workspace in workspaces) syncWorkspace(workspace.id, full)
                _status.value = SyncStatus(
                    online = true,
                    pending = store.pendingCount(),
                    rejected = store.issues().size,
                    lastSyncAt = nowIso(),
                )
            } catch (error: CancellationException) {
                _status.value = _status.value.copy(running = false)
                throw error
            } catch (error: Exception) {
                _status.value = _status.value.copy(
                    running = false,
                    online = error !is UnreachableException,
                    sessionExpired = error is ApiException && error.status == 401,
                    pending = store.pendingCount(),
                    rejected = store.issues().size,
                    lastError = describe(error),
                )
            }
        }
    }

    private suspend fun registerDevice() {
        try {
            transport.registerDevice(store.deviceId, deviceName)
        } catch (error: ApiException) {
            if (error.code != "device_revoked") throw error
            // Removed from the account and signed in again: continue under a new id with the queue (#46).
            transport.registerDevice(store.replaceDeviceId(), deviceName)
        }
        registered = true
    }

    /** Sends the queue oldest first in batches; confirmed operations leave it, rejections stay marked. */
    suspend fun pushQueue(maxOperations: Long = 200) {
        var afterSeq = 0L
        while (true) {
            val batch = store.queuedOperations(afterSeq, maxOperations)
            if (batch.isEmpty()) return
            afterSeq = batch.last().first
            val response = transport.push(PushInput(batch.map { it.second }))
            store.acknowledge(response.results)
            // A removed device gets every operation rejected: register again on the next run.
            if (response.results.any { it.code == "device_not_active" }) {
                registered = false
                return
            }
        }
    }

    private suspend fun syncWorkspace(workspaceId: String, full: Boolean) {
        if (!full && store.syncCursor(workspaceId) > 0) {
            try {
                pull(workspaceId)
                return
            } catch (error: ApiException) {
                if (error.status != 410) throw error
            }
        }
        val content = store.offlineModeAll()
        var page = transport.snapshot(workspaceId, null, content)
        val cursor = page.cursor
        store.beginResync(workspaceId)
        val seen = mutableSetOf<String>()
        while (true) {
            store.applySnapshotPage(workspaceId, page, content, seen)
            val next = page.next ?: break
            page = transport.snapshot(workspaceId, next, content)
        }
        store.finishResync(workspaceId, cursor, content, seen)
        if (!content) {
            // Pages this device had loaded are refreshed one by one (ADR 0017).
            for (id in store.loadedDocumentIds(workspaceId)) loadDocument(workspaceId, id)
        }
        pull(workspaceId)
    }

    private suspend fun pull(workspaceId: String) {
        var cursor = store.syncCursor(workspaceId)
        while (true) {
            val page = transport.pull(workspaceId, cursor)
            store.applyRemoteChanges(workspaceId, page.changes, page.cursor)
            cursor = page.cursor
            if (!page.hasMore) return
        }
    }

    private suspend fun loadDocument(workspaceId: String, documentId: String): Boolean {
        val content = try {
            transport.document(workspaceId, documentId)
        } catch (error: ApiException) {
            if (error.status == 404) return false
            throw error
        }
        store.applyDocumentContent(workspaceId, content)
        return true
    }

    enum class OpenOutcome { LOADED, OFFLINE, MISSING }

    /** Makes sure a page's content is on this device before it is shown (ADR 0017). */
    suspend fun ensureDocumentLoaded(workspaceId: String, documentId: String): OpenOutcome {
        if (store.isDocumentLoaded(documentId)) return OpenOutcome.LOADED
        return try {
            mutex.withLock {
                if (store.isDocumentLoaded(documentId) || loadDocument(workspaceId, documentId)) {
                    OpenOutcome.LOADED
                } else {
                    OpenOutcome.MISSING
                }
            }
        } catch (error: UnreachableException) {
            OpenOutcome.OFFLINE
        } catch (error: ApiException) {
            if (error.status >= 500 || error.status == 401) OpenOutcome.OFFLINE else throw error
        }
    }

    companion object {
        fun describe(error: Throwable): String = when (error) {
            is UnreachableException -> "Server nicht erreichbar"
            is ApiException -> when (error.status) {
                401 -> "Sitzung abgelaufen – bitte neu anmelden"
                403 -> if (error.code == "device_revoked") "Dieses Gerät wurde aus dem Konto entfernt" else "Keine Berechtigung (${error.code})"
                else -> "Serverfehler ${error.status}: ${error.message}"
            }
            else -> error.message ?: error.toString()
        }
    }
}
