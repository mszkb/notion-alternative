package net.notionalt.core

import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import net.notionalt.core.api.ApiClient
import net.notionalt.core.api.ApiException
import net.notionalt.core.api.ApiJson
import net.notionalt.core.api.InMemoryCookieStore
import net.notionalt.core.api.NotOurServerException
import net.notionalt.core.api.ServerUrl
import net.notionalt.core.api.UnreachableException
import net.notionalt.core.model.DocumentResponse
import net.notionalt.core.model.PullResponse
import net.notionalt.core.model.PushInput
import net.notionalt.core.model.PushResponse
import net.notionalt.core.model.PushResult
import net.notionalt.core.model.SnapshotResponse
import net.notionalt.core.model.Workspace
import net.notionalt.core.sync.SyncEngine
import net.notionalt.core.sync.SyncTransport
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val WS = "11111111-1111-4111-8111-111111111111"

class ApiAndSyncTest {
    @Test
    fun normalizesServerAddresses() {
        assertEquals(ServerUrl.Result.Ok("https://notes.example.org"), ServerUrl.normalize(" notes.example.org/ "))
        assertEquals(ServerUrl.Result.Ok("http://192.168.1.20:8080"), ServerUrl.normalize("http://192.168.1.20:8080/api/"))
        assertEquals(ServerUrl.Result.Ok("https://pi.tail1234.ts.net/notes"), ServerUrl.normalize("HTTPS://pi.tail1234.ts.net/notes?x=1"))
        assertTrue(ServerUrl.normalize("ftp://x") is ServerUrl.Result.Invalid)
        assertTrue(ServerUrl.normalize("") is ServerUrl.Result.Invalid)
    }

    @Test
    fun readsTheSessionCookie() {
        val token = "abc123"
        assertEquals(token, ApiClient.parseSessionCookie("session=$token; Path=/api; Expires=Fri, 09 Oct 2026 12:00:00 GMT; HttpOnly; SameSite=Strict; Secure"))
        assertEquals("", ApiClient.parseSessionCookie("session=; Path=/api; Expires=Thu, 01 Jan 1970 00:00:00 GMT"))
        assertNull(ApiClient.parseSessionCookie("other=1; Path=/"))
    }

    @Test
    fun sendsTheCookieOnEveryRequestAndMapsErrors() = runTest {
        val seen = mutableListOf<String?>()
        val engine = MockEngine { request ->
            seen += request.headers[HttpHeaders.Cookie]
            when (request.url.encodedPath) {
                "/api/auth/login" -> respond(
                    """{"user":{"id":"$WS","email":"a@b.de","createdAt":"2026-01-01T00:00:00.000Z"}}""",
                    HttpStatusCode.OK,
                    headersOf(
                        HttpHeaders.ContentType to listOf("application/json"),
                        HttpHeaders.SetCookie to listOf("session=tok; Path=/api; HttpOnly; SameSite=Strict; Secure"),
                    ),
                )
                "/api/workspaces" -> respond("""{"workspaces":[]}""", HttpStatusCode.OK)
                "/api/sync/pull" -> respond("""{"error":{"code":"cursor_expired","message":"gone"}}""", HttpStatusCode.Gone)
                else -> respond("<html>nope</html>", HttpStatusCode.NotFound)
            }
        }
        val cookies = InMemoryCookieStore()
        val api = ApiClient(HttpClient(engine), "https://x.example", cookies)
        api.login("a@b.de", "pw")
        assertEquals("tok", cookies.cookie())
        api.workspaces()
        assertEquals(listOf(null, "session=tok"), seen)
        val gone = assertFailsWith<ApiException> { api.pull(WS, 5) }
        assertEquals(410, gone.status)
        assertEquals("cursor_expired", gone.code)
        assertFailsWith<NotOurServerException> { api.health() }
    }

    @Test
    fun decodesContractShapes() {
        // Shapes as in packages/shared/src/operations.ts (syncPushResultSchema, SyncPullResponse).
        val push = ApiJson.decodeFromString(
            PushResponse.serializer(),
            """{"results":[
              {"opId":"a","status":"applied","revision":2,"seq":10},
              {"opId":"b","status":"duplicate","revision":2,"seq":10},
              {"opId":"c","status":"merged","revision":3,"seq":11},
              {"opId":"d","status":"conflict","currentRevision":4,"reason":"changed","conflictId":"$WS"},
              {"opId":"e","status":"rejected","code":"invalid_payload","message":"m"}]}""",
        )
        assertEquals(listOf(true, true, true, false, false), push.results.map { it.confirmed })
        val pull = ApiJson.decodeFromString(
            PullResponse.serializer(),
            """{"changes":[{"seq":1,"opId":"$WS","deviceId":"$WS","entity":"block","entityId":"$WS","kind":"update",
               "revision":2,"payload":{"content":"x"},"appliedAt":"2026-10-09T12:00:00.000Z"}],"cursor":1,"hasMore":false}""",
        )
        assertEquals("x", pull.changes.single().payload["content"].toString().trim('"'))
        val snapshot = ApiJson.decodeFromString(
            SnapshotResponse.serializer(),
            """{"documents":[{"id":"$WS","workspaceId":"$WS","parentId":null,"title":"T","sortKey":"a0","favorite":false,
               "icon":null,"cover":null,"createdAt":"c","updatedAt":"u","revision":1,"deletedAt":null}],
               "blocks":[{"id":"$WS","documentId":"$WS","type":"todo","content":"","attrs":{"checked":true},"sortKey":"a0",
               "revision":1,"deletedAt":null}],"tags":[],"documentTags":[],"attachments":[],"conflicts":[],
               "cursor":7,"next":null,"total":2}""",
        )
        assertEquals(7, snapshot.cursor)
        // Operations go out with baseRevision null (not omitted), as the zod schema requires.
        val wire = ApiJson.encodeToString(
            PushInput.serializer(),
            PushInput(listOf(net.notionalt.core.model.Operation("o", "d", WS, "document", WS, "delete", null, kotlinx.serialization.json.JsonObject(emptyMap()), "t"))),
        )
        assertTrue(wire.contains("\"baseRevision\":null"))
    }

    /** Server double: confirms everything, can fail on demand, serves an empty workspace. */
    private class FakeTransport : SyncTransport {
        var failPush = false
        val pushed = mutableListOf<List<String>>()
        override suspend fun registerDevice(id: String, name: String) {}
        override suspend fun push(input: PushInput): PushResponse {
            pushed += input.operations.map { it.opId }
            if (failPush) throw UnreachableException(RuntimeException("offline"))
            return PushResponse(input.operations.map { PushResult(it.opId, "applied", revision = 1, seq = 1) })
        }
        override suspend fun pull(workspaceId: String, cursor: Long) = PullResponse(emptyList(), cursor, false)
        override suspend fun snapshot(workspaceId: String, after: String?, content: Boolean) =
            SnapshotResponse(emptyList(), emptyList(), cursor = 3)
        override suspend fun document(workspaceId: String, documentId: String): DocumentResponse =
            throw ApiException(404, "not_found", "x")
        override suspend fun workspaces() = listOf(Workspace(WS, "Privat", WS, "c"))
    }

    @Test
    fun queueSurvivesFailuresAndIsResentIdempotently() = runTest {
        val store = memoryStore()
        val transport = FakeTransport()
        val engine = SyncEngine(store, transport, "Test")
        store.createDocument(WS, title = "offline")
        transport.failPush = true
        engine.sync()
        assertEquals(2, store.pendingCount(), "nothing is lost when the server is unreachable")
        assertEquals(false, engine.status.value.online)
        transport.failPush = false
        engine.sync()
        assertEquals(0, store.pendingCount())
        assertEquals(transport.pushed[0], transport.pushed[1], "the same opIds are sent again")
        assertEquals(3, store.syncCursor(WS))
        assertTrue(engine.status.value.lastError == null)
    }

    @Test
    fun pushIsBatched() = runTest {
        val store = memoryStore()
        val transport = FakeTransport()
        val doc = store.createDocument(WS)
        repeat(5) { store.createBlock(doc.id, content = "$it") }
        SyncEngine(store, transport, "Test").pushQueue(maxOperations = 3)
        assertEquals(listOf(3, 3, 1), transport.pushed.map { it.size })
    }

    @Test
    fun parsesInlineMarkdown() {
        val spans = Inline.parse("a **b** _c_ `d` [e](https://x.de) [P](page:$WS) [bad](javascript:x)")
        assertTrue(spans.any { it.text == "b" && it.bold })
        assertTrue(spans.any { it.text == "c" && it.italic })
        assertTrue(spans.any { it.text == "d" && it.code })
        assertTrue(spans.any { it.text == "e" && it.href == "https://x.de" })
        assertTrue(spans.any { it.text == "P" && it.pageId == WS })
        assertTrue(Inline.plain("[bad](javascript:x)").contains("javascript"))
    }
}
