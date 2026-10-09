package net.notionalt.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

// Wire models of the HTTP API. They mirror the zod schemas in packages/shared (field names and
// shapes); the contract tests in packages/contract-tests are the specification.

@Serializable
data class User(val id: String, val email: String, val createdAt: String)

@Serializable
data class UserResponse(val user: User)

@Serializable
data class LoginInput(val email: String, val password: String)

@Serializable
data class LogoutInput(val removeDevice: Boolean? = null)

@Serializable
data class AuthStatus(val registrationOpen: Boolean)

@Serializable
data class Health(val status: String)

@Serializable
data class Workspace(val id: String, val name: String, val ownerId: String, val createdAt: String)

@Serializable
data class WorkspacesResponse(val workspaces: List<Workspace>)

@Serializable
data class RegisterDeviceInput(val id: String, val name: String)

@Serializable
data class Device(
    val id: String,
    val name: String,
    val createdAt: String,
    val lastSeenAt: String,
    val current: Boolean,
)

@Serializable
data class DeviceResponse(val device: Device)

@Serializable
data class Document(
    val id: String,
    val workspaceId: String,
    val parentId: String?,
    val title: String,
    val sortKey: String,
    val favorite: Boolean,
    val icon: String? = null,
    val cover: String? = null,
    val createdAt: String,
    val updatedAt: String,
    val revision: Long?,
    val deletedAt: String?,
)

@Serializable
data class Block(
    val id: String,
    val documentId: String,
    val type: String,
    val content: String,
    val attrs: JsonObject,
    val sortKey: String,
    val revision: Long?,
    val deletedAt: String?,
)

/** One local change, transferred idempotently by `opId` (ADR 0002). */
@Serializable
data class Operation(
    val opId: String,
    val deviceId: String,
    val workspaceId: String,
    val entity: String,
    val entityId: String,
    val kind: String,
    val baseRevision: Long?,
    val payload: JsonObject,
    val createdAt: String,
)

@Serializable
data class PushInput(val operations: List<Operation>)

/** Result per operation; fields depend on `status` (applied, duplicate, merged, conflict, rejected). */
@Serializable
data class PushResult(
    val opId: String,
    val status: String,
    val revision: Long? = null,
    val seq: Long? = null,
    val currentRevision: Long? = null,
    val reason: String? = null,
    val conflictId: String? = null,
    val code: String? = null,
    val message: String? = null,
) {
    val confirmed: Boolean get() = status == "applied" || status == "duplicate" || status == "merged"
}

@Serializable
data class PushResponse(val results: List<PushResult>)

/** Entry of the server's change log (`GET /api/sync/pull`). */
@Serializable
data class Change(
    val seq: Long,
    val opId: String,
    val deviceId: String,
    val entity: String,
    val entityId: String,
    val kind: String,
    val revision: Long,
    val payload: JsonObject,
    val appliedAt: String,
)

@Serializable
data class PullResponse(val changes: List<Change>, val cursor: Long, val hasMore: Boolean)

/** Conflict objects are kept as JSON; the client only shows them for now (ADR 0003). */
@Serializable
data class SnapshotResponse(
    val documents: List<Document>,
    val blocks: List<Block>,
    val tags: List<JsonElement> = emptyList(),
    val documentTags: List<JsonElement> = emptyList(),
    val attachments: List<JsonElement> = emptyList(),
    val conflicts: List<JsonObject> = emptyList(),
    val cursor: Long,
    val next: String? = null,
    val total: Long? = null,
)

@Serializable
data class DocumentContent(val document: Document, val blocks: List<Block>)

@Serializable
data class DocumentResponse(val document: Document, val blocks: List<Block>, val seq: Long)

@Serializable
data class DocumentsInput(val workspaceId: String, val ids: List<String>)

@Serializable
data class DocumentsResponse(val pages: List<DocumentContent>, val seq: Long)

@Serializable
data class ErrorBody(val error: ErrorDetail? = null)

@Serializable
data class ErrorDetail(val code: String? = null, val message: String? = null)

/** Displayable view of a server conflict object (packages/shared `conflictSchema`). */
@Serializable
data class ConflictLocal(val kind: String, val payload: JsonObject, val deviceId: String, val opId: String)

@Serializable
data class ConflictInfo(
    val id: String,
    val workspaceId: String,
    val entity: String,
    val entityId: String,
    val documentId: String? = null,
    val reason: String,
    val local: ConflictLocal,
    val remote: JsonObject? = null,
    val createdAt: String,
    val resolvedAt: String? = null,
    @SerialName("resolution") val resolution: String? = null,
)
