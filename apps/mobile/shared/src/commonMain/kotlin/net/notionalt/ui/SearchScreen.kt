package net.notionalt.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.imePadding
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import net.notionalt.core.UserContext
import net.notionalt.core.model.Document

/** Local search over titles and text of the pages on this device; works offline. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SearchScreen(context: UserContext, workspaceId: String, openPage: (String) -> Unit, back: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var results by remember { mutableStateOf<List<Document>>(emptyList()) }
    val focus = remember { FocusRequester() }
    val tokens = LocalTokens.current
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    LaunchedEffect(query) {
        delay(200)
        results = context.store.search(workspaceId, query)
    }
    Scaffold(topBar = {
        TopAppBar(
            title = { Text("Suchen") },
            navigationIcon = { IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück") } },
        )
    }) { padding ->
        Column(Modifier.padding(padding).consumeWindowInsets(padding).fillMaxSize().imePadding()) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                placeholder = { Text("Titel oder Text …") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(16.dp).focusRequester(focus),
            )
            LazyColumn(Modifier.fillMaxSize()) {
                if (query.isNotBlank() && results.isEmpty()) {
                    item {
                        Text(
                            "Nichts gefunden. Durchsucht werden nur Seiten, deren Inhalt auf diesem Gerät ist.",
                            modifier = Modifier.padding(16.dp),
                            color = tokens.muted,
                        )
                    }
                }
                items(results, key = { it.id }) { d ->
                    Text(
                        displayTitle(d),
                        style = MaterialTheme.typography.bodyLarge,
                        modifier = Modifier.fillMaxWidth().clickable { openPage(d.id) }.padding(horizontal = 16.dp, vertical = 14.dp),
                    )
                }
            }
        }
    }
}
