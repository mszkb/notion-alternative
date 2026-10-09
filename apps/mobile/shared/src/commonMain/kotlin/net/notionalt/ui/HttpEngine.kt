package net.notionalt.ui

import io.ktor.client.HttpClient

/** HTTP client with the platform's engine (OkHttp on Android, Darwin on iOS). */
expect fun platformHttpClient(): HttpClient
