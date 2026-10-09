package net.notionalt.core

import app.cash.sqldelight.db.QueryResult
import app.cash.sqldelight.db.SqlDriver
import app.cash.sqldelight.db.SqlSchema
import io.ktor.client.HttpClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import net.notionalt.core.api.ApiClient
import net.notionalt.core.api.ApiException
import net.notionalt.core.api.ApiJson
import net.notionalt.core.api.NotOurServerException
import net.notionalt.core.api.ServerUrl
import net.notionalt.core.api.SessionCookieStore
import net.notionalt.core.api.UnreachableException
import net.notionalt.core.appdb.AppDatabase
import net.notionalt.core.db.UserDatabase
import net.notionalt.core.model.User
import net.notionalt.core.store.LocalStore
import net.notionalt.core.sync.ApiTransport
import net.notionalt.core.sync.SyncEngine

/** Opens SQLite databases on the platform (SQLDelight driver, expect/actual in the app). */
fun interface DriverFactory {
    fun create(name: String, schema: SqlSchema<QueryResult.Value<Unit>>): SqlDriver
}

/** A signed-in (or offline-started) user with their database and sync. */
class UserContext(
    val user: User,
    val api: ApiClient,
    val store: LocalStore,
    val sync: SyncEngine,
)

sealed interface SessionState {
    data object NeedsServer : SessionState
    data class NeedsLogin(val serverUrl: String, val message: String? = null) : SessionState
    data class Ready(val context: UserContext) : SessionState
}

/**
 * Server address, session cookie and the current user, kept in a small app database across
 * restarts. The user's content lives in a database of its own per user (ADR 0009).
 * The app starts offline with the last user; the session is only checked when the server answers.
 */
class AppSession(
    private val drivers: DriverFactory,
    private val http: HttpClient,
    private val deviceName: String,
) {
    private val settings = AppDatabase(drivers.create("app.db", AppDatabase.Schema)).settingQueries

    private fun setting(key: String): String? = settings.get(key).executeAsOneOrNull()
    private fun putSetting(key: String, value: String?) {
        if (value == null) settings.remove(key) else settings.put(key, value)
    }

    private val cookies = object : SessionCookieStore {
        override fun cookie(): String? = setting(KEY_COOKIE)
        override fun setCookie(value: String?) = putSetting(KEY_COOKIE, value)
    }

    // Declared before `_state`: the initial state opens the last user's store.
    private val stores = mutableMapOf<String, LocalStore>()

    private val _state = MutableStateFlow<SessionState>(initialState())
    val state: StateFlow<SessionState> = _state.asStateFlow()

    val serverUrl: String? get() = setting(KEY_SERVER)

    private fun initialState(): SessionState {
        val server = setting(KEY_SERVER) ?: return SessionState.NeedsServer
        val user = setting(KEY_USER)?.let {
            runCatching { ApiJson.decodeFromString(User.serializer(), it) }.getOrNull()
        } ?: return SessionState.NeedsLogin(server)
        return SessionState.Ready(open(server, user))
    }

    private fun open(server: String, user: User): UserContext {
        val api = ApiClient(http, server, cookies)
        val store = stores.getOrPut(user.id) {
            LocalStore(drivers.create("user-${user.id}.db", UserDatabase.Schema))
        }
        return UserContext(user, api, store, SyncEngine(store, ApiTransport(api), deviceName))
    }

    /** Checks the address and stores it; returns an error message in German, or null. */
    suspend fun connect(input: String): String? {
        val url = when (val result = ServerUrl.normalize(input)) {
            is ServerUrl.Result.Invalid -> return result.message
            is ServerUrl.Result.Ok -> result.url
        }
        val api = ApiClient(http, url, cookies)
        try {
            if (api.health().status != "ok") return "Der Server meldet ein Problem. Bitte später erneut versuchen."
            api.authStatus()
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            return describeConnectError(url, error)
        }
        if (url != setting(KEY_SERVER)) putSetting(KEY_COOKIE, null)
        putSetting(KEY_SERVER, url)
        _state.value = SessionState.NeedsLogin(url)
        return null
    }

    fun changeServer() {
        _state.value = SessionState.NeedsServer
    }

    /** Signs in; returns an error message in German, or null. */
    suspend fun login(email: String, password: String): String? {
        val server = setting(KEY_SERVER) ?: return "Kein Server eingestellt."
        val api = ApiClient(http, server, cookies)
        val user = try {
            api.login(email.trim().lowercase(), password).user
        } catch (error: CancellationException) {
            throw error
        } catch (error: ApiException) {
            return when {
                error.status == 401 -> "E-Mail oder Passwort ist falsch."
                error.status == 429 -> "Zu viele Versuche. Bitte etwas warten und erneut versuchen."
                error.status == 400 -> "Bitte eine gültige E-Mail-Adresse und ein Passwort eingeben."
                else -> "Anmeldung fehlgeschlagen (${error.status}: ${error.message})."
            }
        } catch (error: Exception) {
            return describeConnectError(server, error)
        }
        if (!api.hasSession) {
            return "Der Server hat keine Sitzung gesetzt. Läuft er hinter einem Proxy, der Cookies entfernt?"
        }
        putSetting(KEY_USER, ApiJson.encodeToString(User.serializer(), user))
        _state.value = SessionState.Ready(open(server, user))
        return null
    }

    /** Signs out. Local data of the user stays on the device (local-first). */
    suspend fun logout() {
        val ready = _state.value as? SessionState.Ready
        try {
            ready?.context?.api?.logout()
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // Offline: the cookie is dropped locally anyway; the server session expires by itself.
        }
        putSetting(KEY_COOKIE, null)
        putSetting(KEY_USER, null)
        _state.value = SessionState.NeedsLogin(setting(KEY_SERVER) ?: "")
    }

    companion object {
        private const val KEY_SERVER = "serverUrl"
        private const val KEY_COOKIE = "sessionCookie"
        private const val KEY_USER = "user"

        fun describeConnectError(url: String, error: Exception): String = when (error) {
            is UnreachableException -> buildString {
                append("Der Server unter $url ist nicht erreichbar. ")
                append("Stimmt die Adresse, und ist das Telefon im richtigen Netz (WLAN, Tailscale)?")
                val detail = error.message.orEmpty()
                if (detail.contains("CLEARTEXT", ignoreCase = true)) {
                    append(" Unverschlüsseltes HTTP ist in dieser Version nicht erlaubt – bitte https:// verwenden.")
                } else if (detail.contains("certificate", ignoreCase = true) || detail.contains("SSL", ignoreCase = true)) {
                    append(" Das Zertifikat des Servers wird nicht akzeptiert (selbst signiert?).")
                }
            }
            is NotOurServerException -> "Unter $url antwortet kein Notion-Alt-Server. Bitte die Adresse prüfen (ohne /api am Ende)."
            is ApiException -> "Der Server antwortet mit einem Fehler (${error.status}: ${error.message})."
            else -> "Unerwarteter Fehler: ${error.message ?: error}"
        }
    }
}
