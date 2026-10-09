package net.notionalt.core

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import net.notionalt.core.model.Change
import net.notionalt.core.model.PushResult
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

private const val WS = "11111111-1111-4111-8111-111111111111"
private const val OTHER_DEVICE = "22222222-2222-4222-8222-222222222222"

class LocalStoreTest {
    @Test
    fun createDocumentWritesEntitiesAndOperationsTogether() {
        val store = memoryStore()
        val doc = store.createDocument(WS, title = "Hallo")
        val ops = store.queuedOperations(0, 100).map { it.second }
        assertEquals(listOf("document/create", "block/create"), ops.map { "${it.entity}/${it.kind}" })
        val create = ops[0]
        assertEquals(doc.id, create.entityId)
        assertEquals(store.deviceId, create.deviceId)
        assertNull(create.baseRevision)
        assertEquals(setOf("parentId", "title", "sortKey", "favorite", "createdAt"), create.payload.keys)
        assertEquals("a0", create.payload["sortKey"]!!.jsonPrimitive.content)
        val block = store.blocks(doc.id).single()
        assertEquals(setOf("documentId", "type", "content", "attrs", "sortKey"), ops[1].payload.keys)
        assertEquals(block.id, ops[1].entityId)
        assertTrue(ops.map { it.opId }.toSet().size == 2)
    }

    @Test
    fun failedWriteLeavesNothingBehind() {
        val store = memoryStore()
        assertFailsWith<Exception> { store.createDocument(WS, parentId = "33333333-3333-4333-8333-333333333333") }
        assertEquals(0, store.pendingCount())
        assertTrue(store.documents(WS).isEmpty())
    }

    @Test
    fun updateSendsOnlyChangedFieldsWithBaseRevision() {
        val store = memoryStore()
        val doc = store.createDocument(WS)
        val block = store.blocks(doc.id).single()
        store.acknowledge(store.queuedOperations(0, 10).map { PushResult(it.second.opId, "applied", revision = 3, seq = 1) })
        assertEquals(0, store.pendingCount())
        assertEquals(3, store.block(block.id)!!.revision)

        store.updateBlock(block.id, content = "")
        assertEquals(0, store.pendingCount(), "unchanged save creates no operation")
        store.updateBlock(block.id, content = "Text")
        val op = store.queuedOperations(0, 10).single().second
        assertEquals("update", op.kind)
        assertEquals(3, op.baseRevision)
        assertEquals(JsonObject(mapOf("content" to JsonPrimitive("Text"))), op.payload)
    }

    @Test
    fun blocksAreOrderedBySortKeyAndSplitInsertsAfter() {
        val store = memoryStore()
        val doc = store.createDocument(WS)
        val first = store.blocks(doc.id).single()
        val third = store.createBlock(doc.id, content = "3")
        val second = store.splitBlock(first.id, "1", "2")
        assertEquals(listOf("1", "2", "3"), store.blocks(doc.id).map { it.content })
        assertTrue(first.sortKey < second.sortKey && second.sortKey < third.sortKey)
    }

    @Test
    fun acknowledgeKeepsRejectedOperationsVisible() {
        val store = memoryStore()
        store.createDocument(WS)
        val (docOp, blockOp) = store.queuedOperations(0, 10).map { it.second }
        store.acknowledge(
            listOf(
                PushResult(docOp.opId, "rejected", code = "invalid_payload", message = "title: too long"),
                PushResult(blockOp.opId, "conflict", currentRevision = 2, reason = "changed", conflictId = OTHER_DEVICE),
            ),
        )
        assertEquals(1, store.pendingCount())
        val issue = store.issues().single()
        assertEquals("invalid_payload", issue.code)
    }

    @Test
    fun deleteDocumentCreatesTombstonesForSubpages() {
        val store = memoryStore()
        val parent = store.createDocument(WS)
        val child = store.createDocument(WS, parentId = parent.id)
        val removed = store.deleteDocument(parent.id)
        assertEquals(setOf(parent.id, child.id), removed.toSet())
        assertTrue(store.documents(WS).isEmpty())
        assertTrue(store.document(child.id)!!.deletedAt != null)
        val deletes = store.queuedOperations(0, 100).map { it.second }.filter { it.kind == "delete" }
        assertEquals(2, deletes.size)
    }

    private fun change(seq: Long, entity: String, id: String, kind: String, payload: JsonObject, device: String = OTHER_DEVICE, revision: Long = 1) =
        Change(seq, newId(), device, entity, id, kind, revision, payload, "2026-10-09T13:00:00.000Z")

    @Test
    fun pullAppliesRemoteChangesAndTombstones() {
        val store = memoryStore()
        val docId = newId()
        val created = JsonObject(
            mapOf(
                "parentId" to kotlinx.serialization.json.JsonNull,
                "title" to JsonPrimitive("Remote"),
                "sortKey" to JsonPrimitive("a0"),
                "favorite" to JsonPrimitive(false),
                "createdAt" to JsonPrimitive("2026-10-09T12:59:00.000Z"),
            ),
        )
        store.applyRemoteChanges(WS, listOf(change(1, "document", docId, "create", created)), 1)
        assertEquals("Remote", store.documents(WS).single().title)
        // New page from another device: content on demand (ADR 0017).
        assertFalse(store.isDocumentLoaded(docId))
        assertEquals(1, store.syncCursor(WS))

        store.applyRemoteChanges(
            WS,
            listOf(change(2, "document", docId, "update", JsonObject(mapOf("title" to JsonPrimitive("Neu"))), revision = 2)),
            2,
        )
        assertEquals("Neu", store.document(docId)!!.title)
        store.applyRemoteChanges(WS, listOf(change(3, "document", docId, "delete", JsonObject(emptyMap()), revision = 3)), 3)
        assertTrue(store.documents(WS).isEmpty())
        assertEquals("2026-10-09T13:00:00.000Z", store.document(docId)!!.deletedAt)
        assertEquals(0, store.pendingCount(), "pulling never creates operations")
    }

    @Test
    fun pullNeverOverwritesUnsyncedLocalChanges() {
        val store = memoryStore()
        val doc = store.createDocument(WS)
        val block = store.blocks(doc.id).single()
        store.acknowledge(store.queuedOperations(0, 10).map { PushResult(it.second.opId, "applied", revision = 1, seq = 1) })
        store.updateBlock(block.id, content = "lokal")
        store.applyRemoteChanges(
            WS,
            listOf(change(5, "block", block.id, "update", JsonObject(mapOf("content" to JsonPrimitive("fremd"))), revision = 2)),
            5,
        )
        assertEquals("lokal", store.block(block.id)!!.content)
        assertEquals(1, store.pendingCount())
    }

    @Test
    fun ownChangesComingBackOnlyConfirm() {
        val store = memoryStore()
        val doc = store.createDocument(WS)
        val op = store.queuedOperations(0, 10).first().second
        store.applyRemoteChanges(WS, listOf(Change(1, op.opId, store.deviceId, "document", doc.id, "create", 4, op.payload, "x")), 1)
        assertEquals(1, store.pendingCount())
        assertEquals(4, store.document(doc.id)!!.revision)
    }

    @Test
    fun conflictObjectsAreStoredAndShown() {
        val store = memoryStore()
        val conflictId = newId()
        val docId = newId()
        val payload = kotlinx.serialization.json.Json.parseToJsonElement(
            """{"entity":"block","entityId":"${newId()}","documentId":"$docId","reason":"changed","baseRevision":1,
               "local":{"kind":"update","payload":{"content":"A"},"deviceId":"$OTHER_DEVICE","opId":"${newId()}"},
               "remote":{"content":"B"},"createdAt":"2026-10-09T13:00:00.000Z","resolvedAt":null,"resolution":null}""",
        ).jsonObject
        store.applyRemoteChanges(WS, listOf(change(1, "conflict", conflictId, "create", payload)), 1)
        val conflict = store.openConflicts(WS).single()
        assertEquals(docId, conflict.documentId)
        assertEquals("changed", conflict.reason)
        store.applyRemoteChanges(
            WS,
            listOf(change(2, "conflict", conflictId, "update", JsonObject(mapOf("resolution" to JsonPrimitive("remote"))), revision = 2)),
            2,
        )
        assertTrue(store.openConflicts(WS).isEmpty())
    }
}
