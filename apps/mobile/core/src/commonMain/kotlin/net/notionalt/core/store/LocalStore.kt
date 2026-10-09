package net.notionalt.core.store

import app.cash.sqldelight.db.SqlDriver
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull
import kotlinx.serialization.json.put
import net.notionalt.core.SortKey
import net.notionalt.core.api.ApiJson
import net.notionalt.core.db.UserDatabase
import net.notionalt.core.model.Block
import net.notionalt.core.model.Change
import net.notionalt.core.model.ConflictInfo
import net.notionalt.core.model.Document
import net.notionalt.core.model.DocumentResponse
import net.notionalt.core.model.Operation
import net.notionalt.core.model.PushResult
import net.notionalt.core.model.SnapshotResponse
import net.notionalt.core.model.Workspace
import net.notionalt.core.newId
import net.notionalt.core.nowIso
import net.notionalt.core.sortedBySortKey
import net.notionalt.core.db.Block as BlockRow
import net.notionalt.core.db.Document as DocumentRow
import net.notionalt.core.db.Operation as OperationRow

class LocalStoreException(message: String) : Exception(message)

/** A queued operation the server did not accept; it stays queued and is shown (principle 6). */
data class OperationIssue(val seq: Long, val entity: String, val kind: String, val code: String, val message: String)

/** Position among siblings: `afterId == null` with [atStart] = first, nothing = append. */
data class Position(val afterId: String? = null, val atStart: Boolean = false)

/**
 * Local data of one user (ADR 0009, ADR 0020): every change writes the entity and its operation
 * in one SQLite transaction, so either both persist or neither. Port of the essential parts of
 * apps/web/src/local/store.ts.
 */
class LocalStore(
    driver: SqlDriver,
    private val now: () -> String = ::nowIso,
) {
    val db = UserDatabase(driver)
    private val q = db.contentQueries

    /** Bumped after every committed write; the UI re-reads on change. */
    private val _version = MutableStateFlow(0L)
    val version: StateFlow<Long> = _version.asStateFlow()

    /** Bumped only after writes that queued operations (local edits): the sync trigger. */
    private val _localEdits = MutableStateFlow(0L)
    val localEdits: StateFlow<Long> = _localEdits.asStateFlow()
    private var queuedInWrite = 0

    /** Stable id of this installation, created on first use. */
    var deviceId: String = q.transactionWithResult {
        q.metaValue("deviceId").executeAsOneOrNull() ?: newId().also { q.putMeta("deviceId", it) }
    }
        private set

    private fun changed() {
        _version.value += 1
        if (queuedInWrite > 0) {
            queuedInWrite = 0
            _localEdits.value += 1
        }
    }

    private fun <T> write(body: () -> T): T {
        val result = q.transactionWithResult { body() }
        changed()
        return result
    }

    private fun enqueue(
        workspaceId: String,
        entity: String,
        entityId: String,
        kind: String,
        baseRevision: Long?,
        payload: JsonObject,
    ) {
        queuedInWrite++
        q.insertOperation(
            opId = newId(),
            deviceId = deviceId,
            workspaceId = workspaceId,
            entity = entity,
            entityId = entityId,
            kind = kind,
            baseRevision = baseRevision,
            payload = ApiJson.encodeToString(JsonObject.serializer(), payload),
            createdAt = now(),
        )
    }

    // ------------------------------------------------------------------ workspaces

    fun workspaces(): List<Workspace> = q.workspaces().executeAsList().map {
        Workspace(it.id, it.name, it.ownerId, it.createdAt)
    }

    fun saveWorkspaces(list: List<Workspace>) = write {
        for (w in list) q.putWorkspace(net.notionalt.core.db.Workspace(w.id, w.name, w.ownerId, w.createdAt))
        // Workspaces the account no longer has are hidden; their content stays in the database.
        if (list.isNotEmpty()) q.deleteWorkspacesExcept(list.map { it.id })
    }

    // ------------------------------------------------------------------ documents

    fun documents(workspaceId: String): List<Document> =
        q.documentsOfWorkspace(workspaceId).executeAsList().map { it.toModel() }
            .sortedBySortKey({ it.sortKey }, { it.id })

    fun document(id: String): Document? = q.document(id).executeAsOneOrNull()?.toModel()

    private fun requireDocument(id: String): Document =
        document(id)?.takeIf { it.deletedAt == null } ?: throw LocalStoreException("Document $id not found")

    private fun children(workspaceId: String, parentId: String?): List<Document> =
        documents(workspaceId).filter { it.parentId == parentId }

    private fun <T> sortKeyAt(siblings: List<T>, position: Position, key: (T) -> String, id: (T) -> String, exclude: String? = null): String {
        val list = siblings.filter { id(it) != exclude }.sortedBySortKey(key, id)
        if (position.atStart) return SortKey.between(null, list.firstOrNull()?.let(key))
        val afterId = position.afterId ?: return SortKey.between(list.lastOrNull()?.let(key), null)
        val index = list.indexOfFirst { id(it) == afterId }
        if (index == -1) throw LocalStoreException("Sibling $afterId not found")
        val before = key(list[index])
        val next = list.drop(index + 1).firstOrNull { key(it) > before }
        return SortKey.between(before, next?.let(key))
    }

    /** Creates a page with one empty paragraph so the editor always has a block to type into. */
    fun createDocument(workspaceId: String, parentId: String? = null, title: String = ""): Document = write {
        if (parentId != null) {
            val parent = requireDocument(parentId)
            if (parent.workspaceId != workspaceId) throw LocalStoreException("Parent belongs to another workspace")
        }
        val time = now()
        val document = Document(
            id = newId(),
            workspaceId = workspaceId,
            parentId = parentId,
            title = title,
            sortKey = sortKeyAt(children(workspaceId, parentId), Position(), { it.sortKey }, { it.id }),
            favorite = false,
            createdAt = time,
            updatedAt = time,
            revision = null,
            deletedAt = null,
        )
        q.putDocument(document.toRow())
        enqueue(workspaceId, "document", document.id, "create", null, buildJsonObject {
            put("parentId", parentId)
            put("title", title)
            put("sortKey", document.sortKey)
            put("favorite", false)
            put("createdAt", time)
        })
        insertBlock(document, "paragraph", "", JsonObject(emptyMap()), Position())
        document
    }

    fun renameDocument(id: String, title: String) = write {
        require(title.length <= 500) { "Title too long" }
        val document = requireDocument(id)
        if (document.title == title) return@write
        q.putDocument(document.copy(title = title, updatedAt = now()).toRow())
        enqueue(document.workspaceId, "document", id, "update", document.revision, buildJsonObject { put("title", title) })
    }

    fun setFavorite(id: String, favorite: Boolean) = write {
        val document = requireDocument(id)
        if (document.favorite == favorite) return@write
        q.putDocument(document.copy(favorite = favorite).toRow())
        enqueue(document.workspaceId, "document", id, "update", document.revision, buildJsonObject { put("favorite", favorite) })
    }

    /** Moves the page and its subpages to the trash (tombstones, restorable on the web). */
    fun deleteDocument(id: String): List<String> = write {
        val root = requireDocument(id)
        val all = documents(root.workspaceId)
        val removed = mutableListOf<String>()
        fun visit(document: Document) {
            for (child in all.filter { it.parentId == document.id }) visit(child)
            q.putDocument(document.copy(deletedAt = now()).toRow())
            enqueue(document.workspaceId, "document", document.id, "delete", document.revision, JsonObject(emptyMap()))
            removed += document.id
        }
        visit(root)
        removed
    }

    // ------------------------------------------------------------------ blocks

    fun blocks(documentId: String): List<Block> =
        q.blocksOfDocument(documentId).executeAsList().map { it.toModel() }
            .sortedBySortKey({ it.sortKey }, { it.id })

    fun block(id: String): Block? = q.block(id).executeAsOneOrNull()?.toModel()

    private fun touch(document: Document) {
        q.putDocument(document.copy(updatedAt = now()).toRow())
    }

    private fun insertBlock(document: Document, type: String, content: String, attrs: JsonObject, position: Position): Block {
        val block = Block(
            id = newId(),
            documentId = document.id,
            type = type,
            content = content,
            attrs = attrs,
            sortKey = sortKeyAt(blocks(document.id), position, { it.sortKey }, { it.id }),
            revision = null,
            deletedAt = null,
        )
        q.putBlock(block.toRow())
        enqueue(document.workspaceId, "block", block.id, "create", null, buildJsonObject {
            put("documentId", block.documentId)
            put("type", block.type)
            put("content", block.content)
            put("attrs", block.attrs)
            put("sortKey", block.sortKey)
        })
        touch(requireDocument(document.id))
        return block
    }

    fun createBlock(
        documentId: String,
        type: String = "paragraph",
        content: String = "",
        attrs: JsonObject = JsonObject(emptyMap()),
        position: Position = Position(),
    ): Block = write { insertBlock(requireDocument(documentId), type, content, attrs, position) }

    /** Saves changed fields only; an unchanged save creates no operation. */
    fun updateBlock(id: String, type: String? = null, content: String? = null, attrs: JsonObject? = null): Block = write {
        val block = block(id)?.takeIf { it.deletedAt == null } ?: throw LocalStoreException("Block $id not found")
        val document = requireDocument(block.documentId)
        val payload = buildJsonObject {
            if (type != null && type != block.type) put("type", type)
            if (content != null && content != block.content) put("content", content)
            if (attrs != null && attrs != block.attrs) put("attrs", attrs)
        }
        if (payload.isEmpty()) return@write block
        val next = block.copy(
            type = type ?: block.type,
            content = content ?: block.content,
            attrs = attrs ?: block.attrs,
        )
        q.putBlock(next.toRow())
        enqueue(document.workspaceId, "block", id, "update", block.revision, payload)
        touch(document)
        next
    }

    /** Moves a block among its page's blocks (`move` with the new sort key). */
    fun moveBlock(id: String, position: Position) = write {
        val block = block(id)?.takeIf { it.deletedAt == null } ?: throw LocalStoreException("Block $id not found")
        val document = requireDocument(block.documentId)
        val sortKey = sortKeyAt(blocks(document.id), position, { it.sortKey }, { it.id }, exclude = id)
        if (sortKey == block.sortKey) return@write
        q.putBlock(block.copy(sortKey = sortKey).toRow())
        enqueue(document.workspaceId, "block", id, "move", block.revision, buildJsonObject { put("sortKey", sortKey) })
        touch(document)
    }

    /** One step up (-1) or down (+1) in the page. */
    fun moveBlockBy(id: String, step: Int) {
        val list = blocks(block(id)?.documentId ?: return)
        val index = list.indexOfFirst { it.id == id }
        val target = index + step
        if (index < 0 || target !in list.indices) return
        val others = list.filter { it.id != id }
        val position = if (target == 0) Position(atStart = true) else Position(afterId = others[target - 1].id)
        moveBlock(id, position)
    }

    /** Enter in the editor: the head stays in the block, the tail becomes a new block after it. */
    fun splitBlock(id: String, head: String, tail: String, type: String = "paragraph", attrs: JsonObject = JsonObject(emptyMap())): Block = write {
        val block = block(id)?.takeIf { it.deletedAt == null } ?: throw LocalStoreException("Block $id not found")
        updateBlock(id, content = head)
        insertBlock(requireDocument(block.documentId), type, tail, attrs, Position(afterId = id))
    }

    fun deleteBlock(id: String) = write {
        val block = block(id)?.takeIf { it.deletedAt == null } ?: throw LocalStoreException("Block $id not found")
        val document = requireDocument(block.documentId)
        q.putBlock(block.copy(deletedAt = now()).toRow())
        enqueue(document.workspaceId, "block", id, "delete", block.revision, JsonObject(emptyMap()))
        touch(document)
    }

    // ------------------------------------------------------------------ device preferences

    fun preference(key: String): String? = q.metaValue("pref:$key").executeAsOneOrNull()

    fun setPreference(key: String, value: String) = q.putMeta("pref:$key", value)

    // ------------------------------------------------------------------ queue

    fun pendingCount(): Long = q.operationCount().executeAsOne()

    fun queuedOperations(afterSeq: Long, limit: Long): List<Pair<Long, Operation>> =
        q.queuedOperations(afterSeq, limit).executeAsList().map { it.seq to it.toModel() }

    fun issues(): List<OperationIssue> = q.operationsWithIssues().executeAsList().map {
        OperationIssue(it.seq, it.entity, it.kind, it.issueCode ?: "", it.issueMessage ?: "")
    }

    /**
     * Applies push results in one transaction: confirmed operations leave the queue and their
     * entity learns the server revision; conflicts leave the queue (the server keeps the change in
     * a conflict object, ADR 0003); rejections stay queued and are marked.
     */
    fun acknowledge(results: List<PushResult>) = write {
        for (result in results) {
            val op = q.operationByOpId(result.opId).executeAsOneOrNull() ?: continue
            when {
                result.status == "conflict" -> q.deleteOperation(op.seq)
                result.confirmed -> {
                    q.deleteOperation(op.seq)
                    val revision = result.revision ?: continue
                    when (op.entity) {
                        "document" -> q.setDocumentRevision(revision, op.entityId)
                        "block" -> q.setBlockRevision(revision, op.entityId)
                    }
                }
                else -> q.markOperation(result.code ?: result.status, result.message ?: "", op.seq)
            }
        }
    }

    /** After the device was removed and the user signed in again (#46): queue moves to a new id. */
    fun replaceDeviceId(): String = write {
        val old = deviceId
        val next = newId()
        q.putMeta("deviceId", next)
        q.renameOperationDevice(new = next, old = old)
        deviceId = next
        next
    }

    // ------------------------------------------------------------------ pull

    fun syncCursor(workspaceId: String): Long =
        q.metaValue("syncCursor:$workspaceId").executeAsOneOrNull()?.toLongOrNull() ?: 0

    fun offlineModeAll(): Boolean = q.metaValue("offlineMode").executeAsOneOrNull() == "all"

    /**
     * Applies pulled changes and the new cursor in one transaction, without creating operations.
     * Own changes only confirm. Entities with unsynced local operations stay as they are; their
     * push then meets the conflict path instead of being overwritten (principle 6).
     */
    fun applyRemoteChanges(workspaceId: String, changes: List<Change>, cursor: Long) = write {
        for (change in changes) applyRemoteChange(workspaceId, change)
        q.putMeta("syncCursor:$workspaceId", cursor.toString())
    }

    private fun hasQueued(entityId: String) = q.operationCountForEntity(entityId).executeAsOne() > 0

    private fun applyRemoteChange(workspaceId: String, change: Change) {
        if (change.entity == "conflict") {
            applyRemoteConflict(workspaceId, change)
            return
        }
        val queued = q.operationByOpId(change.opId).executeAsOneOrNull()
        if (queued != null) q.deleteOperation(queued.seq)
        if (queued != null || change.deviceId == deviceId) {
            when (change.entity) {
                "document" -> q.setDocumentRevision(change.revision, change.entityId)
                "block" -> q.setBlockRevision(change.revision, change.entityId)
            }
            return
        }
        if (hasQueued(change.entityId)) return
        val p = change.payload
        when (change.entity) {
            "document" -> {
                val local = document(change.entityId)
                if (change.kind == "delete") {
                    // A page deleted elsewhere stays while this device has unsynced edits in it.
                    val blockIds = q.allBlockIdsOfDocument(change.entityId).executeAsList()
                    if (blockIds.any(::hasQueued)) return
                }
                if (change.kind == "create") {
                    q.putDocument(
                        Document(
                            id = change.entityId,
                            workspaceId = workspaceId,
                            parentId = p.str("parentId"),
                            title = p.str("title") ?: "",
                            sortKey = p.str("sortKey") ?: "a0",
                            favorite = p.bool("favorite") ?: false,
                            icon = p.str("icon"),
                            cover = p.str("cover"),
                            createdAt = p.str("createdAt") ?: change.appliedAt,
                            updatedAt = change.appliedAt,
                            revision = change.revision,
                            deletedAt = null,
                        ).toRow(),
                    )
                    // Created on another device: its content loads when the page is opened (ADR 0017).
                    if (!offlineModeAll() && local == null) q.putUnloaded(change.entityId, workspaceId)
                } else if (local != null) {
                    val next = when (change.kind) {
                        "delete" -> local.copy(deletedAt = change.appliedAt)
                        "restore" -> local.copy(deletedAt = null, updatedAt = change.appliedAt)
                        else -> local.copy(
                            parentId = if (p.containsKey("parentId")) p.str("parentId") else local.parentId,
                            title = p.str("title") ?: local.title,
                            sortKey = p.str("sortKey") ?: local.sortKey,
                            favorite = p.bool("favorite") ?: local.favorite,
                            icon = if (p.containsKey("icon")) p.str("icon") else local.icon,
                            cover = if (p.containsKey("cover")) p.str("cover") else local.cover,
                            updatedAt = change.appliedAt,
                        )
                    }
                    q.putDocument(next.copy(revision = change.revision).toRow())
                }
            }
            "block" -> {
                val local = block(change.entityId)
                // Already contained in a state loaded later (ADR 0017); revisions only grow.
                if (local != null && (local.revision ?: 0) >= change.revision) return
                val next = if (change.kind == "create") {
                    val documentId = p.str("documentId") ?: return
                    if (q.unloaded(documentId).executeAsOneOrNull() != null) return
                    Block(
                        id = change.entityId,
                        documentId = documentId,
                        type = p.str("type") ?: "paragraph",
                        content = p.str("content") ?: "",
                        attrs = (p["attrs"] as? JsonObject) ?: JsonObject(emptyMap()),
                        sortKey = p.str("sortKey") ?: "a0",
                        revision = change.revision,
                        deletedAt = null,
                    )
                } else if (local != null) {
                    when (change.kind) {
                        "delete" -> local.copy(deletedAt = change.appliedAt)
                        else -> local.copy(
                            type = p.str("type") ?: local.type,
                            content = p.str("content") ?: local.content,
                            attrs = (p["attrs"] as? JsonObject) ?: local.attrs,
                            sortKey = p.str("sortKey") ?: local.sortKey,
                        )
                    }.copy(revision = change.revision)
                } else {
                    return
                }
                q.putBlock(next.toRow())
            }
            // Tags, page tags and attachments are not shown by the app yet; the server keeps them.
        }
    }

    private fun applyRemoteConflict(workspaceId: String, change: Change) {
        if (change.kind == "create") {
            val entity = buildJsonObject {
                put("id", change.entityId)
                put("workspaceId", workspaceId)
                change.payload.forEach { (k, v) -> put(k, v) }
                put("revision", change.revision)
                put("deletedAt", JsonNull)
            }
            putConflict(entity)
            val info = parseConflict(entity) ?: return
            // On the device whose change became a conflict: show the server state again; its own
            // version lives on in the conflict until someone decides (ADR 0003).
            if (info.local.deviceId == deviceId) adoptRemote(info)
        } else if (change.kind == "update") {
            val row = q.conflict(change.entityId).executeAsOneOrNull() ?: return
            val json = ApiJson.parseToJsonElement(row.json) as JsonObject
            val updated = JsonObject(json + mapOf(
                "resolution" to (change.payload["resolution"] ?: JsonNull),
                "resolvedAt" to JsonPrimitive(change.appliedAt),
                "revision" to JsonPrimitive(change.revision),
            ))
            putConflict(updated)
        }
    }

    private fun adoptRemote(conflict: ConflictInfo) {
        if (hasQueued(conflict.entityId)) return
        val remote = conflict.remote
        if (remote != null) {
            try {
                when (conflict.entity) {
                    "document" -> q.putDocument(ApiJson.decodeFromJsonElement(Document.serializer(), remote).toRow())
                    "block" -> q.putBlock(ApiJson.decodeFromJsonElement(Block.serializer(), remote).toRow())
                }
            } catch (_: IllegalArgumentException) {
                // Unknown shape: keep the local state; the conflict stays visible.
            }
        }
        if (conflict.reason == "parent_deleted" && conflict.documentId != null) {
            val document = document(conflict.documentId)
            if (document != null && document.deletedAt == null) {
                q.putDocument(document.copy(deletedAt = conflict.createdAt).toRow())
            }
        }
    }

    private fun putConflict(json: JsonObject) {
        q.putConflict(
            net.notionalt.core.db.Conflict(
                id = json.str("id") ?: return,
                workspaceId = json.str("workspaceId") ?: return,
                documentId = json.str("documentId"),
                json = json.toString(),
                createdAt = json.str("createdAt") ?: now(),
                resolvedAt = json.str("resolvedAt"),
                revision = (json["revision"] as? JsonPrimitive)?.longOrNull,
            ),
        )
    }

    fun openConflicts(workspaceId: String): List<ConflictInfo> =
        q.openConflicts(workspaceId).executeAsList().mapNotNull {
            parseConflict(ApiJson.parseToJsonElement(it.json) as JsonObject)
        }

    private fun parseConflict(json: JsonObject): ConflictInfo? = try {
        ApiJson.decodeFromJsonElement(ConflictInfo.serializer(), json)
    } catch (_: IllegalArgumentException) {
        null
    }

    // ------------------------------------------------------------------ snapshot (re-sync)

    /** Starts a full re-sync: without a cursor an interrupted re-sync starts over. */
    fun beginResync(workspaceId: String) = write { q.deleteMeta("syncCursor:$workspaceId") }

    /**
     * Writes one snapshot page in one transaction. Entities with queued operations keep their
     * local state, so nothing unsynced is lost. Without content (ADR 0017) pages new to this
     * device are marked as not loaded.
     */
    fun applySnapshotPage(workspaceId: String, page: SnapshotResponse, content: Boolean, seen: MutableSet<String>) = write {
        for (d in page.documents) {
            seen += d.id
            if (hasQueued(d.id)) continue
            if (!content && document(d.id) == null) q.putUnloaded(d.id, workspaceId)
            q.putDocument(d.copy(workspaceId = workspaceId).toRow())
        }
        for (b in page.blocks) {
            seen += b.id
            if (hasQueued(b.id)) continue
            q.putBlock(b.toRow())
        }
        for (c in page.conflicts) {
            c.str("id")?.let { seen += it }
            putConflict(c)
        }
    }

    /** Ends a re-sync: local entities the snapshot lacked are removed unless queued, then the cursor is stored. */
    fun finishResync(workspaceId: String, cursor: Long, content: Boolean, seen: Set<String>) = write {
        for (id in q.allDocumentIdsOfWorkspace(workspaceId).executeAsList()) {
            if (id !in seen && !hasQueued(id)) {
                q.deleteDocument(id)
                q.deleteUnloaded(id)
            }
        }
        if (content) {
            for (id in q.allBlockIdsOfWorkspace(workspaceId).executeAsList()) {
                if (id !in seen && !hasQueued(id)) q.deleteBlock(id)
            }
        }
        for (id in q.allConflictIdsOfWorkspace(workspaceId).executeAsList()) {
            if (id !in seen) q.deleteConflict(id)
        }
        q.putMeta("syncCursor:$workspaceId", cursor.toString())
    }

    // ------------------------------------------------------------------ content on demand

    fun isDocumentLoaded(documentId: String): Boolean = q.unloaded(documentId).executeAsOneOrNull() == null

    fun unloadedDocumentIds(workspaceId: String): List<String> = q.unloadedOfWorkspace(workspaceId).executeAsList()

    /** "Alles offline verfügbar machen" (ADR 0017): only once nothing is missing any more. */
    fun completeOfflineMode(): Boolean = q.transactionWithResult {
        if (q.unloadedCount().executeAsOne() > 0) return@transactionWithResult false
        q.putMeta("offlineMode", "all")
        true
    }

    /** Pages whose title or text contains `text` (case-insensitive for ASCII), best title matches first. */
    fun search(workspaceId: String, text: String): List<Document> {
        val needle = text.trim()
        if (needle.isEmpty()) return emptyList()
        val pattern = "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        val ids = q.searchDocuments(workspaceId, pattern).executeAsList()
        return ids.mapNotNull { document(it) }
            .sortedWith(compareBy({ !it.title.contains(needle, ignoreCase = true) }, { it.title.lowercase() }))
    }

    /** Pages of a workspace whose content is on this device (synced at least once, not in the trash). */
    fun loadedDocumentIds(workspaceId: String): List<String> =
        documents(workspaceId).filter { it.revision != null && isDocumentLoaded(it.id) }.map { it.id }

    /** Writes the content of one page as loaded from the server (ADR 0017) in one transaction. */
    fun applyDocumentContent(workspaceId: String, content: DocumentResponse) = write {
        val documentId = content.document.id
        val served = content.blocks.map { it.id }.toSet()
        for (b in content.blocks) {
            if (hasQueued(b.id)) continue
            val local = block(b.id)
            // A pull may already have brought a newer state.
            if (local != null && (local.revision ?: 0) > (b.revision ?: 0)) continue
            q.putBlock(b.toRow())
        }
        // Blocks the server does not know and that are not queued were removed meanwhile.
        for (id in q.allBlockIdsOfDocument(documentId).executeAsList()) {
            if (id !in served && !hasQueued(id)) q.deleteBlock(id)
        }
        if (!hasQueued(documentId)) {
            val local = document(documentId)
            if (local == null || (local.revision ?: 0) <= (content.document.revision ?: 0)) {
                q.putDocument(content.document.copy(workspaceId = workspaceId).toRow())
            }
        }
        q.deleteUnloaded(documentId)
    }
}

// ---------------------------------------------------------------------- mapping

private fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it !is JsonNull }?.contentOrNull

private fun JsonObject.bool(key: String): Boolean? = (this[key] as? JsonPrimitive)?.booleanOrNull

internal fun DocumentRow.toModel() = Document(
    id = id,
    workspaceId = workspaceId,
    parentId = parentId,
    title = title,
    sortKey = sortKey,
    favorite = favorite != 0L,
    icon = icon,
    cover = cover,
    createdAt = createdAt,
    updatedAt = updatedAt,
    revision = revision,
    deletedAt = deletedAt,
)

internal fun Document.toRow() = DocumentRow(
    id = id,
    workspaceId = workspaceId,
    parentId = parentId,
    title = title,
    sortKey = sortKey,
    favorite = if (favorite) 1L else 0L,
    icon = icon,
    cover = cover,
    createdAt = createdAt,
    updatedAt = updatedAt,
    revision = revision,
    deletedAt = deletedAt,
)

internal fun BlockRow.toModel() = Block(
    id = id,
    documentId = documentId,
    type = type,
    content = content,
    attrs = (ApiJson.parseToJsonElement(attrs) as? JsonObject) ?: JsonObject(emptyMap()),
    sortKey = sortKey,
    revision = revision,
    deletedAt = deletedAt,
)

internal fun Block.toRow() = BlockRow(
    id = id,
    documentId = documentId,
    type = type,
    content = content,
    attrs = attrs.toString(),
    sortKey = sortKey,
    revision = revision,
    deletedAt = deletedAt,
)

internal fun OperationRow.toModel() = Operation(
    opId = opId,
    deviceId = deviceId,
    workspaceId = workspaceId,
    entity = entity,
    entityId = entityId,
    kind = kind,
    baseRevision = baseRevision,
    payload = ApiJson.parseToJsonElement(payload) as JsonObject,
    createdAt = createdAt,
)

/** Typed access to block attributes (ADR 0019). */
val Block.indent: Int get() = (attrs["indent"] as? JsonPrimitive)?.longOrNull?.toInt() ?: 0
val Block.checked: Boolean get() = (attrs["checked"] as? JsonPrimitive)?.booleanOrNull ?: false
val Block.level: Int get() = (attrs["level"] as? JsonPrimitive)?.longOrNull?.toInt() ?: 1
val Block.listStyle: String get() = (attrs["list"] as? JsonPrimitive)?.contentOrNull ?: "bullet"
val Block.calloutIcon: String? get() = (attrs["icon"] as? JsonPrimitive)?.contentOrNull

fun JsonObject.with(key: String, value: JsonElement): JsonObject = JsonObject(this + (key to value))
