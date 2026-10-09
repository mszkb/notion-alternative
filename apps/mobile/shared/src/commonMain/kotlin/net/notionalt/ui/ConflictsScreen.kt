package net.notionalt.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.notionalt.core.UserContext
import net.notionalt.core.model.ConflictInfo

private fun reasonText(reason: String) = when (reason) {
    "changed" -> "Gleichzeitig auf einem anderen Gerät geändert"
    "deleted" -> "Auf einem anderen Gerät gelöscht"
    "parent_deleted" -> "Seite wurde auf einem anderen Gerät gelöscht"
    else -> reason
}

private fun preview(payload: JsonObject?): String {
    if (payload == null) return "(nicht vorhanden)"
    val text = (payload["content"] as? JsonPrimitive)?.content ?: (payload["title"] as? JsonPrimitive)?.content
    return text?.ifBlank { "(leer)" } ?: payload.keys.joinToString(", ").ifBlank { "(keine Felder)" }
}

/** Open conflicts of a workspace (ADR 0003); resolving them works in the web app for now. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConflictsScreen(context: UserContext, workspaceId: String, openPage: (String) -> Unit, back: () -> Unit) {
    val version by context.store.version.collectAsState()
    val conflicts = remember(version) { context.store.openConflicts(workspaceId) }
    val tokens = LocalTokens.current
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Konflikte") },
            navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück") } },
        )
    }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            item {
                Text(
                    "Beide Versionen sind gespeichert, nichts wurde überschrieben. Auflösen kannst du Konflikte vorerst in der Web-App.",
                    modifier = Modifier.padding(16.dp),
                    color = tokens.muted,
                )
            }
            if (conflicts.isEmpty()) item { Text("Keine offenen Konflikte.", modifier = Modifier.padding(16.dp)) }
            items(conflicts, key = { it.id }) { conflict -> ConflictRow(context, conflict, openPage) }
        }
    }
}

@Composable
private fun ConflictRow(context: UserContext, conflict: ConflictInfo, openPage: (String) -> Unit) {
    val tokens = LocalTokens.current
    val page = conflict.documentId?.let { context.store.document(it) }
    val own = conflict.local.deviceId == context.store.deviceId
    Column(
        Modifier.fillMaxWidth()
            .clickable(enabled = conflict.documentId != null) { conflict.documentId?.let(openPage) }
            .padding(16.dp),
    ) {
        Text(page?.let(::displayTitle) ?: "Seite", style = MaterialTheme.typography.titleMedium)
        Text(reasonText(conflict.reason), style = MaterialTheme.typography.bodySmall, color = tokens.warn)
        Text(
            (if (own) "Dieses Gerät: " else "Anderes Gerät: ") + preview(conflict.local.payload),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.padding(top = 6.dp),
        )
        Text("Server: " + preview(conflict.remote), style = MaterialTheme.typography.bodyMedium)
    }
    HorizontalDivider(color = tokens.border)
}
