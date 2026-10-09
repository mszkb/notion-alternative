package net.notionalt.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.FormatIndentDecrease
import androidx.compose.material.icons.automirrored.filled.FormatIndentIncrease
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import net.notionalt.core.UserContext
import net.notionalt.core.model.Block
import net.notionalt.core.store.BlockState
import net.notionalt.core.store.calloutIcon
import net.notionalt.core.store.checked
import net.notionalt.core.store.indent
import net.notionalt.core.store.level
import net.notionalt.core.store.listStyle
import net.notionalt.core.sync.SyncEngine

/** Block kinds offered in the editor (ADR 0019); attrs are set to what the web editor writes. */
private data class BlockKind(val label: String, val type: String, val attrs: JsonObject)

private val blockKinds = listOf(
    BlockKind("Text", "paragraph", JsonObject(emptyMap())),
    BlockKind("H1", "heading", JsonObject(mapOf("level" to JsonPrimitive(1)))),
    BlockKind("H2", "heading", JsonObject(mapOf("level" to JsonPrimitive(2)))),
    BlockKind("H3", "heading", JsonObject(mapOf("level" to JsonPrimitive(3)))),
    BlockKind("• Liste", "list_item", JsonObject(mapOf("list" to JsonPrimitive("bullet")))),
    BlockKind("1. Liste", "list_item", JsonObject(mapOf("list" to JsonPrimitive("ordered")))),
    BlockKind("To-do", "todo", JsonObject(mapOf("checked" to JsonPrimitive(false)))),
    BlockKind("Toggle", "toggle", JsonObject(emptyMap())),
    BlockKind("Zitat", "quote", JsonObject(emptyMap())),
    BlockKind("Code", "code", JsonObject(emptyMap())),
    BlockKind("Hinweis", "callout", JsonObject(mapOf("icon" to JsonPrimitive("💡")))),
    BlockKind("Trenner", "divider", JsonObject(emptyMap())),
)

/** Typed prefix → block kind (the web editor's Markdown shortcuts). */
private val markdownShortcuts: List<Pair<String, BlockKind>> by lazy {
    fun kind(label: String) = blockKinds.first { it.label == label }
    listOf(
        "### " to kind("H3"),
        "## " to kind("H2"),
        "# " to kind("H1"),
        "- " to kind("• Liste"),
        "* " to kind("• Liste"),
        "1. " to kind("1. Liste"),
        "[] " to kind("To-do"),
        "[ ] " to kind("To-do"),
        "> " to kind("Zitat"),
        "```" to kind("Code"),
        "---" to kind("Trenner"),
    )
}

private fun JsonObject.withIndent(indent: Int): JsonObject {
    val map = toMutableMap()
    if (indent > 0) map["indent"] = JsonPrimitive(indent) else map.remove("indent")
    return JsonObject(map)
}

/** Keeps the indent when the type changes, where the type supports it (ADR 0019). */
private fun attrsFor(kind: BlockKind, current: Block): JsonObject =
    if (current.indent > 0) kind.attrs.withIndent(current.indent) else kind.attrs

/** Blocks hidden because a toggle above them is closed (children = following blocks with larger indent). */
private fun visibleBlocks(blocks: List<Block>, collapsed: Set<String>): List<Block> {
    val out = mutableListOf<Block>()
    var hideAbove: Int? = null
    for (b in blocks) {
        val hidden = hideAbove
        if (hidden != null) {
            if (b.indent > hidden) continue
            hideAbove = null
        }
        out += b
        if (b.type == "toggle" && b.id in collapsed) hideAbove = b.indent
    }
    return out
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PageScreen(
    controller: AppController,
    context: UserContext,
    workspaceId: String,
    documentId: String,
    openPage: (String) -> Unit,
    openConflicts: () -> Unit,
    back: () -> Unit,
) {
    val store = context.store
    val version by store.version.collectAsState()
    val tokens = LocalTokens.current
    val uriHandler = LocalUriHandler.current
    val document = remember(version) { store.document(documentId) }
    var loaded by remember { mutableStateOf(store.isDocumentLoaded(documentId)) }
    var outcome by remember { mutableStateOf<SyncEngine.OpenOutcome?>(null) }

    LaunchedEffect(documentId) {
        if (!loaded) {
            outcome = context.sync.ensureDocumentLoaded(workspaceId, documentId)
            loaded = store.isDocumentLoaded(documentId)
        }
    }

    val blocks = remember(version, loaded) { if (loaded) store.blocks(documentId) else emptyList() }
    val conflicts = remember(version) { store.openConflicts(workspaceId).filter { it.documentId == documentId } }
    var editingId by remember { mutableStateOf<String?>(null) }
    // Collapsed toggles are a per-device state (ADR 0019), not synced.
    var collapsed by remember(documentId) {
        mutableStateOf(store.preference("collapsed:$documentId")?.split(',')?.filter { it.isNotEmpty() }?.toSet() ?: emptySet())
    }
    var menu by remember { mutableStateOf(false) }
    var confirmDelete by remember { mutableStateOf(false) }
    var moving by remember { mutableStateOf(false) }
    // Undo of this page's edits since it was opened (ADR 0008: structural steps take a checkpoint).
    val undoStack = remember(documentId) { mutableStateListOf<List<BlockState>>() }
    var pendingUndo by remember { mutableStateOf(false) }
    fun checkpoint() {
        undoStack.add(store.blockStates(documentId))
        if (undoStack.size > 50) undoStack.removeAt(0)
    }
    fun undo() {
        val target = undoStack.removeLastOrNull() ?: return
        runCatching { store.applyBlockState(documentId, target) }
    }
    LaunchedEffect(pendingUndo, editingId) {
        if (pendingUndo && editingId == null) {
            // The editor saved its text when it closed; undo afterwards.
            undo()
            pendingUndo = false
        }
    }
    val titles = remember(version) { store.documents(workspaceId).associate { it.id to it.title } }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(document?.let(::displayTitle) ?: "", maxLines = 1) },
                navigationIcon = {
                    IconButton(onClick = back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Zurück") }
                },
                actions = {
                    if (document != null && document.deletedAt == null) {
                        IconButton(
                            onClick = {
                                if (editingId != null) {
                                    editingId = null
                                    pendingUndo = true
                                } else {
                                    undo()
                                }
                            },
                            enabled = undoStack.isNotEmpty(),
                        ) { Icon(Icons.AutoMirrored.Filled.Undo, contentDescription = "Rückgängig") }
                        IconButton(onClick = { store.setFavorite(documentId, !document.favorite) }) {
                            Icon(
                                if (document.favorite) Icons.Filled.Star else Icons.Filled.StarBorder,
                                contentDescription = if (document.favorite) "Aus Favoriten entfernen" else "Zu Favoriten",
                                tint = if (document.favorite) tokens.warn else LocalContentColorOrMuted(),
                            )
                        }
                        Box {
                            IconButton(onClick = { menu = true }) { Icon(Icons.Filled.MoreVert, contentDescription = "Menü") }
                            DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                                DropdownMenuItem(text = { Text("Unterseite anlegen") }, onClick = {
                                    menu = false
                                    openPage(store.createDocument(workspaceId, parentId = documentId).id)
                                })
                                DropdownMenuItem(text = { Text("Verschieben nach …") }, onClick = {
                                    menu = false
                                    moving = true
                                })
                                DropdownMenuItem(text = { Text("Seite löschen") }, onClick = {
                                    menu = false
                                    confirmDelete = true
                                })
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().imePadding()) {
            SyncStatusBar(context)
            if (conflicts.isNotEmpty()) {
                Surface(color = tokens.warn.copy(alpha = 0.15f), modifier = Modifier.fillMaxWidth().clickable(onClick = openConflicts)) {
                    Text(
                        "⚠ ${conflicts.size} Konflikt(e) auf dieser Seite – beide Versionen sind erhalten. Antippen für Details.",
                        modifier = Modifier.padding(12.dp),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            when {
                document == null -> Notice("Diese Seite gibt es auf diesem Gerät nicht (mehr).")
                document.deletedAt != null -> Column {
                    Notice("Diese Seite liegt im Papierkorb.")
                    TextButton(onClick = { store.restoreDocument(documentId) }, modifier = Modifier.padding(horizontal = 16.dp)) {
                        Text("Wiederherstellen")
                    }
                }
                !loaded && outcome == SyncEngine.OpenOutcome.OFFLINE ->
                    Notice("Der Inhalt dieser Seite ist noch nicht auf diesem Gerät. Sobald der Server erreichbar ist, wird er geladen.")
                !loaded && outcome == SyncEngine.OpenOutcome.MISSING -> Notice("Der Server kennt diese Seite nicht.")
                !loaded -> Notice("Lade Seite …")
                else -> PageEditor(
                    context = context,
                    documentId = documentId,
                    title = document.title,
                    blocks = blocks,
                    editingId = editingId,
                    setEditing = { id ->
                        if (id != null && id != editingId) checkpoint()
                        editingId = id
                    },
                    checkpoint = ::checkpoint,
                    collapsed = collapsed,
                    toggleCollapsed = { id ->
                        collapsed = if (id in collapsed) collapsed - id else collapsed + id
                        store.setPreference("collapsed:$documentId", collapsed.joinToString(","))
                    },
                    pageTitle = { titles[it] },
                    openPage = openPage,
                    openUrl = { runCatching { uriHandler.openUri(it) } },
                    tokens = tokens,
                )
            }
        }
    }

    if (moving && document != null) {
        val excluded = remember(documentId) { store.subtree(documentId) }
        val targets = remember(version) { store.documents(workspaceId).filter { it.id !in excluded } }
        AlertDialog(
            onDismissRequest = { moving = false },
            title = { Text("Verschieben nach") },
            text = {
                LazyColumn(Modifier.height(360.dp)) {
                    item {
                        Text(
                            "Oberste Ebene",
                            modifier = Modifier.fillMaxWidth().clickable {
                                runCatching { store.moveDocument(documentId, null) }
                                moving = false
                            }.padding(vertical = 12.dp),
                            color = if (document.parentId == null) tokens.muted else tokens.text,
                        )
                    }
                    items(targets, key = { it.id }) { target ->
                        Text(
                            displayTitle(target),
                            modifier = Modifier.fillMaxWidth().clickable {
                                runCatching { store.moveDocument(documentId, target.id) }
                                moving = false
                            }.padding(vertical = 12.dp),
                            color = if (document.parentId == target.id) tokens.muted else tokens.text,
                            maxLines = 1,
                        )
                    }
                }
            },
            confirmButton = { TextButton(onClick = { moving = false }) { Text("Abbrechen") } },
        )
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("Seite löschen?") },
            text = { Text("Die Seite und ihre Unterseiten kommen in den Papierkorb und lassen sich in der Web-App wiederherstellen.") },
            confirmButton = {
                TextButton(onClick = {
                    confirmDelete = false
                    store.deleteDocument(documentId)
                    back()
                }) { Text("Löschen") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("Abbrechen") } },
        )
    }
}

@Composable
private fun LocalContentColorOrMuted() = LocalTokens.current.muted

@Composable
private fun Notice(text: String) {
    Text(text, modifier = Modifier.padding(24.dp), color = LocalTokens.current.muted)
}

@Composable
private fun PageEditor(
    context: UserContext,
    documentId: String,
    title: String,
    blocks: List<Block>,
    editingId: String?,
    setEditing: (String?) -> Unit,
    checkpoint: () -> Unit,
    collapsed: Set<String>,
    toggleCollapsed: (String) -> Unit,
    pageTitle: (String) -> String?,
    openPage: (String) -> Unit,
    openUrl: (String) -> Unit,
    tokens: Tokens,
) {
    val store = context.store
    val visible = remember(blocks, collapsed) { visibleBlocks(blocks, collapsed) }
    val listState = rememberLazyListState()
    LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = androidx.compose.foundation.layout.PaddingValues(bottom = 200.dp)) {
        item(key = "title") { TitleField(context, documentId, title) }
        items(visible, key = { it.id }) { block ->
            val number = remember(blocks, block.id) { orderedNumber(blocks, block) }
            if (block.type == "image" && block.id != editingId) {
                ImageBlock(context, block, edit = { setEditing(block.id) })
            } else if (block.id == editingId) {
                BlockEditor(
                    context = context,
                    block = block,
                    done = { setEditing(null) },
                    startEditing = setEditing,
                    checkpoint = checkpoint,
                )
            } else {
                BlockView(
                    block = block,
                    number = number,
                    collapsed = block.id in collapsed,
                    toggleCollapsed = { toggleCollapsed(block.id) },
                    onCheck = { checked ->
                        checkpoint()
                        store.updateBlock(block.id, attrs = JsonObject(block.attrs + ("checked" to JsonPrimitive(checked))))
                    },
                    edit = { setEditing(block.id) },
                    pageTitle = pageTitle,
                    openPage = openPage,
                    openUrl = openUrl,
                    tokens = tokens,
                )
            }
        }
        item(key = "add") {
            TextButton(
                onClick = {
                    checkpoint()
                    val block = store.createBlock(documentId)
                    setEditing(block.id)
                },
                modifier = Modifier.padding(horizontal = 8.dp),
            ) {
                Icon(Icons.Filled.Add, contentDescription = null)
                Text(" Block hinzufügen")
            }
        }
    }
}

/** Position in an ordered list: consecutive ordered items with the same indent. */
private fun orderedNumber(blocks: List<Block>, block: Block): Int {
    if (block.type != "list_item" || block.listStyle != "ordered") return 0
    val index = blocks.indexOfFirst { it.id == block.id }
    var n = 1
    var i = index - 1
    while (i >= 0) {
        val b = blocks[i]
        if (b.indent > block.indent) {
            i--
            continue
        }
        if (b.type == "list_item" && b.listStyle == "ordered" && b.indent == block.indent) n++ else break
        i--
    }
    return n
}

@Composable
private fun TitleField(context: UserContext, documentId: String, title: String) {
    var value by remember(documentId) { mutableStateOf(title) }
    var saved by remember(documentId) { mutableStateOf(title) }
    val current by rememberUpdatedState(value)
    // A title changed elsewhere (pull) shows up unless the user is typing.
    LaunchedEffect(title) { if (value == saved) { value = title; saved = title } }
    LaunchedEffect(value) {
        delay(600)
        if (value != saved) {
            context.store.renameDocument(documentId, value.take(500))
            saved = value
        }
    }
    DisposableEffect(documentId) {
        onDispose {
            if (current != saved) runCatching { context.store.renameDocument(documentId, current.take(500)) }
        }
    }
    val tokens = LocalTokens.current
    Box(Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
        if (value.isEmpty()) {
            Text("Ohne Titel", style = MaterialTheme.typography.headlineMedium, color = tokens.muted)
        }
        BasicTextField(
            value = value,
            onValueChange = { value = it.replace("\n", " ") },
            textStyle = MaterialTheme.typography.headlineMedium.copy(color = tokens.text, fontWeight = FontWeight.Bold),
            cursorBrush = SolidColor(tokens.accent),
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun blockTextStyle(block: Block, tokens: Tokens): TextStyle {
    val base = MaterialTheme.typography.bodyLarge.copy(color = tokens.text)
    return when (block.type) {
        "heading" -> when (block.level) {
            1 -> MaterialTheme.typography.headlineSmall.copy(color = tokens.text, fontWeight = FontWeight.Bold)
            2 -> MaterialTheme.typography.titleLarge.copy(color = tokens.text, fontWeight = FontWeight.Bold)
            else -> MaterialTheme.typography.titleMedium.copy(color = tokens.text, fontWeight = FontWeight.Bold)
        }
        "code" -> base.copy(fontFamily = FontFamily.Monospace, fontSize = 14.sp)
        "quote" -> base.copy(color = tokens.text)
        else -> base
    }
}

@Composable
private fun BlockView(
    block: Block,
    number: Int,
    collapsed: Boolean,
    toggleCollapsed: () -> Unit,
    onCheck: (Boolean) -> Unit,
    edit: () -> Unit,
    pageTitle: (String) -> String?,
    openPage: (String) -> Unit,
    openUrl: (String) -> Unit,
    tokens: Tokens,
) {
    val style = blockTextStyle(block, tokens)
    val indent = (16 + block.indent * 20).dp
    if (block.type == "divider") {
        HorizontalDivider(
            modifier = Modifier.fillMaxWidth().clickable(onClick = edit).padding(start = indent, end = 16.dp, top = 14.dp, bottom = 14.dp),
            color = tokens.border,
        )
        return
    }
    val text = if (block.type == "code") {
        androidx.compose.ui.text.AnnotatedString(block.content)
    } else {
        inlineText(block.content, tokens, pageTitle, openPage, openUrl)
    }
    val empty = block.content.isEmpty()
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = edit)
            .padding(start = indent, end = 16.dp, top = 4.dp, bottom = 4.dp)
            .let {
                when (block.type) {
                    "code" -> it.background(tokens.codeBg, RoundedCornerShape(6.dp)).padding(8.dp)
                    "callout" -> it.background(tokens.sidebar, RoundedCornerShape(6.dp)).padding(8.dp)
                    else -> it
                }
            },
        verticalAlignment = if (block.type == "todo" || block.type == "toggle") Alignment.CenterVertically else Alignment.Top,
    ) {
        when (block.type) {
            "list_item" -> Text(if (block.listStyle == "ordered") "$number. " else "•  ", style = style)
            "todo" -> Checkbox(checked = block.checked, onCheckedChange = onCheck, modifier = Modifier.size(32.dp))
            "toggle" -> IconButton(onClick = toggleCollapsed, modifier = Modifier.size(32.dp)) {
                Icon(
                    if (collapsed) Icons.AutoMirrored.Filled.KeyboardArrowRight else Icons.Filled.KeyboardArrowDown,
                    contentDescription = if (collapsed) "Aufklappen" else "Zuklappen",
                )
            }
            "callout" -> Text((block.calloutIcon ?: "💡") + "  ", style = style)
            "quote" -> Box(Modifier.width(3.dp).height(24.dp).background(tokens.border))
            "image", "file" -> Text("📎 ", style = style)
            else -> {}
        }
        if (block.type == "quote") Spacer(Modifier.width(10.dp))
        val shown = when {
            (block.type == "image" || block.type == "file") && empty ->
                androidx.compose.ui.text.AnnotatedString("Anhang (in der App noch nicht anzeigbar)")
            else -> text
        }
        Text(
            text = if (empty && block.type != "image" && block.type != "file") androidx.compose.ui.text.AnnotatedString(" ") else shown,
            style = if (block.type == "todo" && block.checked) style.copy(color = tokens.muted, textDecoration = androidx.compose.ui.text.style.TextDecoration.LineThrough) else style,
            modifier = Modifier.weight(1f),
        )
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun BlockEditor(
    context: UserContext,
    block: Block,
    done: () -> Unit,
    startEditing: (String) -> Unit,
    checkpoint: () -> Unit,
) {
    val store = context.store
    val tokens = LocalTokens.current
    var value by remember(block.id) { mutableStateOf(TextFieldValue(block.content, TextRange(block.content.length))) }
    var saved by remember(block.id) { mutableStateOf(block.content) }
    val current by rememberUpdatedState(value.text)
    val focus = remember { FocusRequester() }
    LaunchedEffect(block.id) { runCatching { focus.requestFocus() } }
    LaunchedEffect(value.text) {
        delay(500)
        if (value.text != saved) {
            runCatching { store.updateBlock(block.id, content = value.text) }
            saved = value.text
        }
    }
    DisposableEffect(block.id) {
        onDispose {
            if (current != saved) runCatching { store.updateBlock(block.id, content = current) }
        }
    }

    fun onChange(next: TextFieldValue) {
        // Markdown shortcuts at the start of a text block, as in the web editor.
        if (block.type == "paragraph" && next.text.length > value.text.length) {
            val shortcut = markdownShortcuts.firstOrNull { next.text.startsWith(it.first) && !value.text.startsWith(it.first) }
            if (shortcut != null) {
                checkpoint()
                val kind = shortcut.second
                val rest = next.text.removePrefix(shortcut.first)
                runCatching {
                    if (kind.type == "divider") {
                        store.updateBlock(block.id, type = "divider", content = "", attrs = JsonObject(emptyMap()))
                        saved = ""
                        done()
                    } else {
                        store.updateBlock(block.id, type = kind.type, content = rest, attrs = attrsFor(kind, block))
                        saved = rest
                        value = TextFieldValue(rest, TextRange(rest.length))
                    }
                }
                return
            }
        }
        val newline = next.text.indexOf('\n')
        if (block.type != "code" && newline >= 0) {
            // Enter splits the block: the tail becomes a new block of a sensible type.
            val head = next.text.substring(0, newline)
            val tail = next.text.substring(newline + 1)
            val continues = block.type == "list_item" || block.type == "todo"
            checkpoint()
            if (continues && head.isEmpty() && tail.isEmpty()) {
                // Enter in an empty list item ends the list.
                runCatching {
                    store.updateBlock(block.id, type = "paragraph", content = "", attrs = JsonObject(emptyMap()).withIndent(block.indent))
                }
                saved = ""
                value = TextFieldValue("")
                return
            }
            val type = if (continues) block.type else "paragraph"
            val attrs = when {
                // Enter on a toggle creates its first child (ADR 0019).
                block.type == "toggle" -> JsonObject(mapOf("indent" to JsonPrimitive((block.indent + 1).coerceAtMost(5))))
                block.type == "todo" -> JsonObject(block.attrs + ("checked" to JsonPrimitive(false)))
                continues -> block.attrs
                block.indent > 0 -> JsonObject(mapOf("indent" to JsonPrimitive(block.indent)))
                else -> JsonObject(emptyMap())
            }
            val created = runCatching { store.splitBlock(block.id, head, tail, type, attrs) }.getOrNull()
            if (created != null) {
                saved = head
                startEditing(created.id)
            }
            return
        }
        value = next
    }

    Column(Modifier.fillMaxWidth().padding(start = (12 + block.indent * 20).dp, end = 12.dp, top = 4.dp, bottom = 4.dp)) {
        Surface(
            shape = RoundedCornerShape(6.dp),
            color = if (block.type == "code") tokens.codeBg else tokens.surface,
            border = androidx.compose.foundation.BorderStroke(1.dp, tokens.accent),
        ) {
            BasicTextField(
                value = value,
                onValueChange = ::onChange,
                textStyle = blockTextStyle(block, tokens),
                cursorBrush = SolidColor(tokens.accent),
                modifier = Modifier.fillMaxWidth().padding(10.dp).focusRequester(focus),
            )
        }
        Row(
            modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(top = 4.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton(onClick = done) { Icon(Icons.Filled.Check, contentDescription = "Fertig") }
            IconButton(onClick = {
                if (current != saved) { store.updateBlock(block.id, content = current); saved = current }
                checkpoint()
                store.deleteBlock(block.id)
                done()
            }) { Icon(Icons.Filled.Delete, contentDescription = "Block löschen", tint = tokens.error) }
            IconButton(onClick = { checkpoint(); runCatching { store.moveBlockBy(block.id, -1) } }) {
                Icon(Icons.Filled.ArrowUpward, contentDescription = "Nach oben")
            }
            IconButton(onClick = { checkpoint(); runCatching { store.moveBlockBy(block.id, 1) } }) {
                Icon(Icons.Filled.ArrowDownward, contentDescription = "Nach unten")
            }
            IconButton(onClick = {
                checkpoint()
                store.updateBlock(block.id, attrs = block.attrs.withIndent((block.indent - 1).coerceAtLeast(0)))
            }, enabled = block.indent > 0) {
                Icon(Icons.AutoMirrored.Filled.FormatIndentDecrease, contentDescription = "Ausrücken")
            }
            IconButton(onClick = {
                checkpoint()
                store.updateBlock(block.id, attrs = block.attrs.withIndent((block.indent + 1).coerceAtMost(5)))
            }, enabled = block.indent < 5) {
                Icon(Icons.AutoMirrored.Filled.FormatIndentIncrease, contentDescription = "Einrücken")
            }
            // Attachment blocks keep their type: changing it would drop the attachment reference.
            for (kind in if (block.type == "image" || block.type == "file") emptyList() else blockKinds) {
                val selected = kind.type == block.type &&
                    (kind.type != "heading" || block.level == (kind.attrs["level"] as JsonPrimitive).content.toInt()) &&
                    (kind.type != "list_item" || block.listStyle == (kind.attrs["list"] as JsonPrimitive).content)
                FilterChip(
                    selected = selected,
                    onClick = {
                        if (current != saved) { store.updateBlock(block.id, content = current); saved = current }
                        checkpoint()
                        if (kind.type == "divider") {
                            store.updateBlock(block.id, type = "divider", content = "", attrs = JsonObject(emptyMap()))
                            done()
                        } else {
                            store.updateBlock(block.id, type = kind.type, attrs = attrsFor(kind, block))
                        }
                    },
                    label = { Text(kind.label) },
                )
            }
        }
    }
}
