package net.notionalt.core.api

import io.ktor.client.HttpClient
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.request.header
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.content.TextContent
import io.ktor.http.encodeURLParameter
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import net.notionalt.core.model.AuthStatus
import net.notionalt.core.model.DeviceResponse
import net.notionalt.core.model.DocumentResponse
import net.notionalt.core.model.DocumentsInput
import net.notionalt.core.model.DocumentsResponse
import net.notionalt.core.model.ErrorBody
import net.notionalt.core.model.Health
import net.notionalt.core.model.LoginInput
import net.notionalt.core.model.LogoutInput
import net.notionalt.core.model.PullResponse
import net.notionalt.core.model.PushInput
import net.notionalt.core.model.PushResponse
import net.notionalt.core.model.RegisterDeviceInput
import net.notionalt.core.model.SnapshotResponse
import net.notionalt.core.model.UserResponse
import net.notionalt.core.model.WorkspacesResponse

val ApiJson = Json {
    ignoreUnknownKeys = true
    explicitNulls = true
    encodeDefaults = false
}

/** The server answered with an error (`{ error: { code, message } }`). */
class ApiException(val status: Int, val code: String, message: String) : Exception(message)

/** Network or server not reachable (no answer at all). */
class UnreachableException(cause: Throwable) : Exception(cause.message ?: cause.toString(), cause)

/** The URL answered, but not like a Notion Alt server (HTML page, other service). */
class NotOurServerException(message: String) : Exception(message)

/** Where the session cookie lives between app starts (#171 moves it to the Keystore/Keychain). */
interface SessionCookieStore {
    fun cookie(): String?
    fun setCookie(value: String?)
}

class InMemoryCookieStore(private var value: String? = null) : SessionCookieStore {
    override fun cookie(): String? = value
    override fun setCookie(value: String?) {
        this.value = value
    }
}

/**
 * HTTP client of the Notion Alt API (apps/web/src/api.ts). Auth uses the server's session cookie:
 * the client reads it from `Set-Cookie` and sends it itself on every request, regardless of its
 * `Secure` and `Path` attributes (no server changes for the app, ADR 0020).
 */
class ApiClient(
    http: HttpClient,
    val baseUrl: String,
    private val cookies: SessionCookieStore,
) {
    private val http = http.config {
        expectSuccess = false
        install(HttpTimeout) {
            connectTimeoutMillis = 15_000
            requestTimeoutMillis = 120_000
            socketTimeoutMillis = 60_000
        }
    }

    val hasSession: Boolean get() = cookies.cookie() != null

    private suspend fun send(method: HttpMethod, path: String, body: String?): HttpResponse {
        try {
            return http.request("$baseUrl/api$path") {
                this.method = method
                cookies.cookie()?.let { header(HttpHeaders.Cookie, "$SESSION_COOKIE=$it") }
                header(HttpHeaders.Accept, "application/json")
                if (body != null) setBody(TextContent(body, ContentType.Application.Json))
            }.also(::readCookie)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            throw UnreachableException(error)
        }
    }

    private fun readCookie(response: HttpResponse) {
        for (header in response.headers.getAll(HttpHeaders.SetCookie).orEmpty()) {
            val value = parseSessionCookie(header) ?: continue
            cookies.setCookie(value.ifEmpty { null })
        }
    }

    private suspend fun <T> call(
        method: HttpMethod,
        path: String,
        body: String?,
        result: KSerializer<T>?,
    ): T? {
        val response = send(method, path, body)
        val status = response.status.value
        val text = try {
            response.bodyAsText()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            throw UnreachableException(error)
        }
        if (status !in 200..299) {
            val detail = try {
                ApiJson.decodeFromString(ErrorBody.serializer(), text).error
            } catch (_: SerializationException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            }
            if (detail == null && status != 401 && status < 500) {
                throw NotOurServerException("HTTP $status")
            }
            throw ApiException(status, detail?.code ?: "unknown", detail?.message ?: "HTTP $status")
        }
        if (result == null || status == 204) return null
        return try {
            ApiJson.decodeFromString(result, text)
        } catch (error: SerializationException) {
            throw NotOurServerException(error.message ?: "Unexpected response")
        } catch (error: IllegalArgumentException) {
            throw NotOurServerException(error.message ?: "Unexpected response")
        }
    }

    private suspend fun <T> get(path: String, result: KSerializer<T>): T =
        call(HttpMethod.Get, path, null, result)!!

    private suspend fun <I, T> post(path: String, input: I, inputSerializer: KSerializer<I>, result: KSerializer<T>): T =
        call(HttpMethod.Post, path, ApiJson.encodeToString(inputSerializer, input), result)!!

    suspend fun health(): Health = get("/health", Health.serializer())
    suspend fun authStatus(): AuthStatus = get("/auth/status", AuthStatus.serializer())
    suspend fun login(email: String, password: String): UserResponse =
        post("/auth/login", LoginInput(email, password), LoginInput.serializer(), UserResponse.serializer())

    suspend fun logout(removeDevice: Boolean = false) {
        try {
            call<Unit>(
                HttpMethod.Post,
                "/auth/logout",
                ApiJson.encodeToString(LogoutInput.serializer(), LogoutInput(if (removeDevice) true else null)),
                null,
            )
        } finally {
            cookies.setCookie(null)
        }
    }

    suspend fun me(): UserResponse = get("/auth/me", UserResponse.serializer())
    suspend fun workspaces(): WorkspacesResponse = get("/workspaces", WorkspacesResponse.serializer())
    suspend fun registerDevice(id: String, name: String): DeviceResponse =
        post("/devices", RegisterDeviceInput(id, name), RegisterDeviceInput.serializer(), DeviceResponse.serializer())

    suspend fun push(input: PushInput): PushResponse =
        post("/sync/push", input, PushInput.serializer(), PushResponse.serializer())

    suspend fun pull(workspaceId: String, cursor: Long, limit: Int = 1000): PullResponse =
        get("/sync/pull?${query("workspaceId" to workspaceId, "cursor" to "$cursor", "limit" to "$limit")}", PullResponse.serializer())

    suspend fun snapshot(workspaceId: String, after: String?, content: Boolean): SnapshotResponse {
        val params = mutableListOf("workspaceId" to workspaceId, "limit" to "$SNAPSHOT_PAGE_SIZE")
        if (after != null) params += "after" to after
        if (!content) params += "content" to "false"
        return get("/sync/snapshot?${query(*params.toTypedArray())}", SnapshotResponse.serializer())
    }

    suspend fun document(workspaceId: String, documentId: String): DocumentResponse =
        get("/sync/documents/${documentId.encodeURLParameter()}?${query("workspaceId" to workspaceId)}", DocumentResponse.serializer())

    suspend fun documents(workspaceId: String, ids: List<String>): DocumentsResponse =
        post("/sync/documents", DocumentsInput(workspaceId, ids), DocumentsInput.serializer(), DocumentsResponse.serializer())

    private fun query(vararg params: Pair<String, String>): String =
        params.joinToString("&") { (k, v) -> "${k.encodeURLParameter()}=${v.encodeURLParameter()}" }

    companion object {
        const val SESSION_COOKIE = "session"
        const val SNAPSHOT_PAGE_SIZE = 2000

        /** Value of the `session` cookie in a `Set-Cookie` header; "" when it is cleared; null if absent. */
        fun parseSessionCookie(header: String): String? {
            val first = header.substringBefore(';').trim()
            val name = first.substringBefore('=').trim()
            if (name != SESSION_COOKIE || !first.contains('=')) return null
            val value = first.substringAfter('=').trim()
            val expired = header.split(';').any {
                val part = it.trim()
                part.startsWith("Expires=", ignoreCase = true) && part.contains("1970")
            }
            return if (expired) "" else value
        }
    }
}
