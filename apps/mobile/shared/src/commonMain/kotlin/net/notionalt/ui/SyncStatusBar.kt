package net.notionalt.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.notionalt.core.UserContext

/** Sync state in one line: offline, synced, n pending, error (#156). */
@Composable
fun SyncStatusBar(context: UserContext) {
    val status by context.sync.status.collectAsState()
    val version by context.store.version.collectAsState()
    val pending = remember(version, status) { context.store.pendingCount() }
    val issues = remember(version, status) { context.store.issues() }
    val tokens = LocalTokens.current
    var showIssues by remember { mutableStateOf(false) }

    val (text, color) = when {
        status.sessionExpired -> "Sitzung abgelaufen – Änderungen bleiben auf dem Gerät. Bitte ab- und wieder anmelden." to tokens.warn
        issues.isNotEmpty() -> "${issues.size} Änderung(en) vom Server abgelehnt – antippen für Details" to tokens.error
        !status.online -> (if (pending > 0) "Offline – $pending Änderung(en) ausstehend" else "Offline – lokale Daten") to tokens.warn
        status.lastError != null -> "Fehler: ${status.lastError}" + (if (pending > 0) " · $pending ausstehend" else "") to tokens.error
        status.running -> "Synchronisiere …" to tokens.muted
        pending > 0 -> "$pending Änderung(en) ausstehend" to tokens.muted
        status.lastSyncAt != null -> "Synchronisiert ${status.lastSyncAt!!.substring(11, 16)} UTC" to tokens.ok
        else -> "Noch nicht synchronisiert" to tokens.muted
    }
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(tokens.sidebar)
            .clickable(enabled = issues.isNotEmpty()) { showIssues = true }
            .padding(horizontal = 16.dp, vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (status.running) {
            CircularProgressIndicator(modifier = Modifier.size(12.dp).padding(end = 0.dp), strokeWidth = 2.dp)
            Text("  ", style = MaterialTheme.typography.labelMedium)
        }
        Text(text, style = MaterialTheme.typography.labelMedium, color = color)
    }
    if (showIssues) {
        AlertDialog(
            onDismissRequest = { showIssues = false },
            confirmButton = { TextButton(onClick = { showIssues = false }) { Text("Schließen") } },
            title = { Text("Abgelehnte Änderungen") },
            text = {
                LazyColumn {
                    item {
                        Text(
                            "Diese Änderungen hat der Server nicht übernommen. Sie bleiben auf dem Gerät gespeichert und werden nicht verworfen.",
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                    items(issues) { issue ->
                        Text(
                            "• ${issue.entity}/${issue.kind}: ${issue.code} – ${issue.message}",
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.padding(top = 6.dp),
                        )
                    }
                }
            },
        )
    }
}
