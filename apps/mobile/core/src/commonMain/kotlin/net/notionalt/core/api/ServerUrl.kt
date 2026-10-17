package net.notionalt.core.api

/** Turns what the user typed into the server's base URL (without `/api` and trailing slash). */
object ServerUrl {
    sealed interface Result {
        data class Ok(val url: String) : Result
        data class Invalid(val message: String) : Result
    }

    fun normalize(input: String): Result {
        var url = input.trim()
        if (url.isEmpty()) return Result.Invalid("Bitte die Adresse des Servers eingeben.")
        if (url.any { it.isWhitespace() }) return Result.Invalid("Die Adresse darf keine Leerzeichen enthalten.")
        val scheme = Regex("^([a-zA-Z][a-zA-Z0-9+.-]*)://").find(url)?.groupValues?.get(1)?.lowercase()
        if (scheme == null) {
            url = "https://$url"
        } else if (scheme != "http" && scheme != "https") {
            return Result.Invalid("Nur Adressen mit http:// oder https:// werden unterstützt.")
        } else {
            url = scheme + url.substring(scheme.length)
        }
        // Query and fragment are never part of the base URL.
        url = url.substringBefore('#').substringBefore('?').trimEnd('/')
        if (url.endsWith("/api")) url = url.removeSuffix("/api").trimEnd('/')
        val host = url.substringAfter("://").substringBefore('/').substringBefore(':')
        if (host.isEmpty()) return Result.Invalid("Die Adresse enthält keinen Servernamen.")
        return Result.Ok(url)
    }

    fun isPlainHttp(url: String): Boolean = url.startsWith("http://")
}
