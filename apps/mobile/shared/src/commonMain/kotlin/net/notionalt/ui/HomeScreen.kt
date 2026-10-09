package net.notionalt.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Sync
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import net.notionalt.core.UserContext
import net.notionalt.core.model.Document

private data class TreeRow(val document: Document, val depth: Int, val hasChildren: Boolean)

/** Flattens the visible part of the page tree (children of expanded pages). */
private fun visibleTree(documents: List<Document>, expanded: Set<String>): List<TreeRow> {
    val byParent = documents.groupBy { it.parentId }
    val ids = documents.map { it.id }.toSet()
    val rows = mutableListOf<TreeRow>()
    fun visit(parentId: String?, depth: Int) {
        for (d in byParent[parentId].orEmpty()) {
            val children = byParent[d.id].orEmpty()
            rows += TreeRow(d, depth, children.isNotEmpty())
            if (d.id in expanded) visit(d.id, depth + 1)
        }
    }
    visit(null, 0)
    // Pages whose parent is not here (deleted elsewhere, not synced yet) stay reachable.
    for (d in documents) if (d.parentId != null && d.parentId !in ids) rows += TreeRow(d, 0, byParent[d.id] != null)
    return rows
}

fun displayTitle(document: Document): String =
    (document.icon?.let { "$it " } ?: "") + document.title.ifBlank { "Ohne Titel" }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    controller: AppController,
    context: UserContext,
    openPage: (String, String) -> Unit,
    openConflicts: (String) -> Unit,
) {
    val store = context.store
    val version by store.version.collectAsState()
    val status by context.sync.status.collectAsState()
    val scope = rememberCoroutineScope()
    val tokens = LocalTokens.current

    val workspaces = remember(version) { store.workspaces() }
    var selected by remember { mutableStateOf(store.preference("workspace")) }
    val workspace = workspaces.firstOrNull { it.id == selected } ?: workspaces.firstOrNull()
    val documents = remember(version, workspace?.id) { workspace?.let { store.documents(it.id) }.orEmpty() }
    val conflicts = remember(version, workspace?.id) { workspace?.let { store.openConflicts(it.id) }.orEmpty() }
    var expanded by remember { mutableStateOf(setOf<String>()) }
    val rows = remember(documents, expanded) { visibleTree(documents, expanded) }
    val favorites = remember(documents) { documents.filter { it.favorite } }

    var workspaceMenu by remember { mutableStateOf(false) }
    var menu by remember { mutableStateOf(false) }
    var confirmLogout by remember { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Box {
                        Row(
                            modifier = Modifier.clickable(enabled = workspaces.size > 1) { workspaceMenu = true },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(workspace?.name ?: "Notion Alt", maxLines = 1, overflow = TextOverflow.Ellipsis)
                            if (workspaces.size > 1) Icon(Icons.Filled.ArrowDropDown, contentDescription = "Workspace wählen")
                        }
                        DropdownMenu(expanded = workspaceMenu, onDismissRequest = { workspaceMenu = false }) {
                            for (w in workspaces) {
                                DropdownMenuItem(text = { Text(w.name) }, onClick = {
                                    selected = w.id
                                    store.setPreference("workspace", w.id)
                                    workspaceMenu = false
                                })
                            }
                        }
                    }
                },
                actions = {
                    if (conflicts.isNotEmpty() && workspace != null) {
                        IconButton(onClick = { openConflicts(workspace.id) }) {
                            Icon(Icons.Filled.Warning, contentDescription = "Konflikte", tint = tokens.warn)
                        }
                    }
                    IconButton(onClick = { controller.requestSync() }, enabled = !status.running) {
                        Icon(Icons.Filled.Sync, contentDescription = "Jetzt synchronisieren")
                    }
                    Box {
                        IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "Menü") }
                        DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                            DropdownMenuItem(text = { Text("Neu synchronisieren") }, onClick = {
                                menu = false
                                controller.requestSync(full = true)
                            })
                            DropdownMenuItem(text = { Text("Abmelden (${context.user.email})") }, onClick = {
                                menu = false
                                confirmLogout = true
                            })
                        }
                    }
                },
            )
        },
        floatingActionButton = {
            if (workspace != null) {
                FloatingActionButton(onClick = {
                    val document = store.createDocument(workspace.id)
                    openPage(workspace.id, document.id)
                }) { Icon(Icons.Filled.Add, contentDescription = "Neue Seite") }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            SyncStatusBar(context)
            PullToRefreshBox(
                isRefreshing = refreshing,
                onRefresh = {
                    refreshing = true
                    scope.launch {
                        context.sync.sync()
                        refreshing = false
                    }
                },
                modifier = Modifier.fillMaxSize(),
            ) {
                LazyColumn(Modifier.fillMaxSize()) {
                    if (workspace == null) {
                        item {
                            Text(
                                if (status.running) "Lade Daten vom Server …" else "Noch keine Daten auf diesem Gerät. Zum Synchronisieren nach unten ziehen.",
                                modifier = Modifier.padding(24.dp),
                                color = tokens.muted,
                            )
                        }
                    }
                    if (favorites.isNotEmpty()) {
                        item { SectionHeader("Favoriten") }
                        items(favorites, key = { "fav-" + it.id }) { d ->
                            PageRow(displayTitle(d), depth = 0, hasChildren = false, expanded = false, favorite = true,
                                onToggle = {}, onOpen = { openPage(d.workspaceId, d.id) }, onAddChild = null)
                        }
                        item { SectionHeader("Seiten") }
                    }
                    items(rows, key = { it.document.id }) { row ->
                        val d = row.document
                        PageRow(
                            title = displayTitle(d),
                            depth = row.depth,
                            hasChildren = row.hasChildren,
                            expanded = d.id in expanded,
                            favorite = false,
                            onToggle = { expanded = if (d.id in expanded) expanded - d.id else expanded + d.id },
                            onOpen = { openPage(d.workspaceId, d.id) },
                            onAddChild = {
                                val child = store.createDocument(d.workspaceId, parentId = d.id)
                                expanded = expanded + d.id
                                openPage(d.workspaceId, child.id)
                            },
                        )
                    }
                    if (workspace != null && documents.isEmpty()) {
                        item {
                            Text("Noch keine Seiten. Mit + legst du die erste an.", modifier = Modifier.padding(24.dp), color = tokens.muted)
                        }
                    }
                    item { Spacer(Modifier.size(96.dp)) }
                }
            }
        }
    }

    if (confirmLogout) {
        val pending = store.pendingCount()
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Abmelden?") },
            text = {
                Text(
                    if (pending > 0) {
                        "$pending Änderung(en) sind noch nicht auf dem Server. Sie bleiben auf diesem Gerät gespeichert und werden nach der nächsten Anmeldung mit demselben Konto gesendet."
                    } else {
                        "Deine Seiten bleiben auf diesem Gerät gespeichert."
                    },
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmLogout = false
                    scope.launch { controller.session.logout() }
                }) { Text("Abmelden") }
            },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = LocalTokens.current.muted,
        modifier = Modifier.padding(start = 16.dp, top = 12.dp, bottom = 4.dp),
    )
}

@Composable
private fun PageRow(
    title: String,
    depth: Int,
    hasChildren: Boolean,
    expanded: Boolean,
    favorite: Boolean,
    onToggle: () -> Unit,
    onOpen: () -> Unit,
    onAddChild: (() -> Unit)?,
) {
    val tokens = LocalTokens.current
    Row(
        modifier = Modifier.fillMaxWidth().clickable(onClick = onOpen).padding(start = (8 + depth * 16).dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (favorite) {
            Icon(Icons.Filled.Star, contentDescription = null, tint = tokens.warn, modifier = Modifier.padding(12.dp).size(20.dp))
        } else if (hasChildren) {
            IconButton(onClick = onToggle) {
                Icon(
                    if (expanded) Icons.Filled.KeyboardArrowDown else Icons.AutoMirrored.Filled.KeyboardArrowRight,
                    contentDescription = if (expanded) "Zuklappen" else "Aufklappen",
                )
            }
        } else {
            Spacer(Modifier.width(48.dp))
        }
        Text(
            title,
            modifier = Modifier.weight(1f).padding(vertical = 12.dp),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            style = MaterialTheme.typography.bodyLarge,
        )
        if (onAddChild != null) {
            IconButton(onClick = onAddChild) {
                Icon(Icons.Filled.Add, contentDescription = "Unterseite anlegen", tint = tokens.muted)
            }
        }
    }
}
