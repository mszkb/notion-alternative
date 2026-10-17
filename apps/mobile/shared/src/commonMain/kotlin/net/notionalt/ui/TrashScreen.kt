package net.notionalt.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.notionalt.core.UserContext

/** Deleted pages of a workspace (#66); restoring brings back subpages and blocks. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TrashScreen(context: UserContext, workspaceId: String, back: () -> Unit) {
    val version by context.store.version.collectAsState()
    val trashed = remember(version) { context.store.trashedDocuments(workspaceId) }
    val tokens = LocalTokens.current
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Papierkorb") },
            navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück") } },
        )
    }) { padding ->
        LazyColumn(Modifier.padding(padding).fillMaxSize()) {
            if (trashed.isEmpty()) item { Text("Der Papierkorb ist leer.", modifier = Modifier.padding(16.dp), color = tokens.muted) }
            items(trashed, key = { it.id }) { d ->
                Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(displayTitle(d), style = MaterialTheme.typography.bodyLarge, modifier = Modifier.weight(1f), maxLines = 1)
                    TextButton(onClick = { context.store.restoreDocument(d.id) }) { Text("Wiederherstellen") }
                }
            }
        }
    }
}
