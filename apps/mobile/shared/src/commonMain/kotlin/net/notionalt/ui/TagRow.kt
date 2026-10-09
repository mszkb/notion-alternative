package net.notionalt.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.AssistChip
import androidx.compose.material3.InputChip
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import net.notionalt.core.UserContext
import net.notionalt.core.model.Tag

/** Tags of a page: tap a tag to remove it, "+ Tag" adds one (existing names are reused). */
@Composable
fun TagRow(context: UserContext, documentId: String, workspaceId: String, tags: List<Tag>) {
    var adding by remember { mutableStateOf(false) }
    var removing by remember { mutableStateOf<Tag?>(null) }
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        for (tag in tags) {
            InputChip(selected = false, onClick = { removing = tag }, label = { Text(tag.name) })
        }
        AssistChip(onClick = { adding = true }, label = { Text("+ Tag") })
    }
    if (adding) {
        var name by remember { mutableStateOf("") }
        val existing = remember { context.store.tags(workspaceId) }
        AlertDialog(
            onDismissRequest = { adding = false },
            title = { Text("Tag hinzufügen") },
            text = {
                androidx.compose.foundation.layout.Column {
                    OutlinedTextField(value = name, onValueChange = { name = it.take(50) }, singleLine = true, label = { Text("Name") })
                    val suggestions = existing.filter { t -> tags.none { it.id == t.id } && t.name.contains(name.trim(), ignoreCase = true) }.take(8)
                    Row(Modifier.horizontalScroll(rememberScrollState()).padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (t in suggestions) AssistChip(onClick = { name = t.name }, label = { Text(t.name) })
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (name.isNotBlank()) runCatching { context.store.addTag(documentId, name) }
                    adding = false
                }, enabled = name.isNotBlank()) { Text("Hinzufügen") }
            },
            dismissButton = { TextButton(onClick = { adding = false }) { Text("Abbrechen") } },
        )
    }
    removing?.let { tag ->
        AlertDialog(
            onDismissRequest = { removing = null },
            title = { Text("Tag „${tag.name}“ entfernen?") },
            text = { Text("Der Tag bleibt für andere Seiten erhalten.") },
            confirmButton = {
                TextButton(onClick = {
                    runCatching { context.store.removeTag(documentId, tag.id) }
                    removing = null
                }) { Text("Entfernen") }
            },
            dismissButton = { TextButton(onClick = { removing = null }) { Text("Abbrechen") } },
        )
    }
}
