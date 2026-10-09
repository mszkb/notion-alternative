package net.notionalt.core

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import kotlinx.coroutines.runBlocking
import net.notionalt.core.sync.SyncEngine
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Two "devices" against a real server (apps/mobile/README.md): runs only when NOTION_ALT_SERVER
 * points to a server with the account NOTION_ALT_EMAIL / NOTION_ALT_PASSWORD.
 */
class ServerIntegrationTest {
    private val server = System.getenv("NOTION_ALT_SERVER")
    private val email = System.getenv("NOTION_ALT_EMAIL") ?: "test@example.org"
    private val password = System.getenv("NOTION_ALT_PASSWORD") ?: "geheim12345"

    private fun device(): AppSession {
        val drivers = DriverFactory { _, schema ->
            JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY).also { schema.create(it) }
        }
        return AppSession(drivers, HttpClient(CIO), "Testgerät")
    }

    private suspend fun AppSession.signIn(): UserContext {
        assertNull(connect(server!!))
        assertNull(login(email, password))
        return (state.value as SessionState.Ready).context
    }

    @Test
    fun twoDevicesConvergeWithoutSilentOverwrites() = runBlocking {
        if (server == null) return@runBlocking
        val a = device().signIn()
        val b = device().signIn()
        a.sync.sync()
        assertNull(a.sync.status.value.lastError)
        val workspace = a.store.workspaces().first().id

        // Device A creates a page offline-first, then pushes it.
        val page = a.store.createDocument(workspace, title = "Vom Telefon ${newId().take(8)}")
        val first = a.store.blocks(page.id).single()
        a.store.updateBlock(first.id, content = "Hallo **Welt**")
        a.store.createBlock(page.id, type = "todo", content = "Milch kaufen")
        a.sync.sync()
        assertEquals(0, a.store.pendingCount(), a.sync.status.value.lastError ?: "")

        // Device B: snapshot without content, page loads on demand (ADR 0017).
        b.sync.sync()
        assertNull(b.sync.status.value.lastError)
        assertTrue(b.store.documents(workspace).any { it.id == page.id })
        assertFalse(b.store.isDocumentLoaded(page.id))
        assertEquals(SyncEngine.OpenOutcome.LOADED, b.sync.ensureDocumentLoaded(workspace, page.id))
        assertEquals(listOf("Hallo **Welt**", "Milch kaufen"), b.store.blocks(page.id).map { it.content })

        // B edits, A pulls the change (delta pull by cursor).
        b.store.updateBlock(first.id, content = "Hallo von B")
        b.sync.sync()
        a.sync.sync()
        assertEquals("Hallo von B", a.store.block(first.id)!!.content)

        // Both edit the same block: the later push becomes a visible conflict, nothing is lost.
        a.store.updateBlock(first.id, content = "Version A")
        b.store.updateBlock(first.id, content = "Version B")
        a.sync.sync()
        b.sync.sync()
        assertEquals(0, b.store.pendingCount())
        val conflict = b.store.openConflicts(workspace).firstOrNull { it.entityId == first.id }
        if (conflict != null) {
            assertEquals("Version B", conflict.local.payload["content"].toString().trim('"'))
            // B keeps its version: ordinary operations plus the resolution reach A.
            b.store.resolveConflict(conflict.id, keepLocal = true)
            b.sync.sync()
            assertEquals(0, b.store.pendingCount(), b.sync.status.value.lastError ?: b.store.issues().toString())
            a.sync.sync()
            assertEquals("Version B", a.store.block(first.id)!!.content)
            assertTrue(a.store.openConflicts(workspace).none { it.id == conflict.id })
        } else {
            // The server merged instead; then both versions must be in the text.
            val merged = b.store.block(first.id)!!.content
            assertTrue(merged.contains("Version A") && merged.contains("Version B"), merged)
        }

        // Moving a page under another one arrives on the other device.
        val parent = a.store.createDocument(workspace, title = "Ordner")
        a.store.moveDocument(page.id, parent.id)
        a.sync.sync()
        assertEquals(0, a.store.pendingCount(), a.store.issues().toString())
        b.sync.sync()
        assertEquals(parent.id, b.store.document(page.id)!!.parentId)

        // A third device makes everything available offline at once.
        val c = device().signIn()
        c.sync.sync()
        assertFalse(c.store.isDocumentLoaded(page.id))
        assertTrue(c.sync.loadAll() >= 1)
        assertTrue(c.store.isDocumentLoaded(page.id))
        assertTrue(c.store.offlineModeAll())

        // Deleting on A arrives as a tombstone on B.
        a.store.deleteDocument(page.id)
        a.sync.sync()
        b.sync.sync()
        assertTrue(b.store.documents(workspace).none { it.id == page.id })
        assertTrue(b.store.document(page.id)?.deletedAt != null)

        // Restoring from the trash on B brings it back on A.
        b.store.restoreDocument(page.id)
        b.sync.sync()
        assertEquals(0, b.store.pendingCount(), b.store.issues().toString())
        a.sync.sync()
        assertTrue(a.store.documents(workspace).any { it.id == page.id })
    }
}
