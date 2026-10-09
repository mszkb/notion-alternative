package net.notionalt.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonPrimitive
import net.notionalt.core.UserContext
import net.notionalt.core.model.Block

/**
 * Image block (ADR 0012): content from the local cache, otherwise loaded from the server and
 * cached so it stays visible offline. Uploading images is not supported in the app yet.
 */
@Composable
fun ImageBlock(context: UserContext, block: Block, edit: () -> Unit) {
    val tokens = LocalTokens.current
    val attachmentId = (block.attrs["attachmentId"] as? JsonPrimitive)?.content
    var image by remember(attachmentId) { mutableStateOf<ImageBitmap?>(null) }
    var state by remember(attachmentId) { mutableStateOf("Bild wird geladen …") }
    LaunchedEffect(attachmentId) {
        if (attachmentId == null) {
            state = "Bild ohne Anhang"
            return@LaunchedEffect
        }
        val bytes = withContext(Dispatchers.Default) {
            loadImageBytes(context, attachmentId)
        }
        image = bytes?.let(::decodeImage)
        if (image == null) state = if (bytes == null) "Bild offline nicht verfügbar" else "Bildformat wird nicht unterstützt"
    }
    Column(Modifier.fillMaxWidth().clickable(onClick = edit).padding(horizontal = (16 + 0).dp, vertical = 6.dp)) {
        val bitmap = image
        if (bitmap != null) {
            Image(
                bitmap = bitmap,
                contentDescription = block.content.ifBlank { "Bild" },
                contentScale = ContentScale.FillWidth,
                modifier = Modifier.fillMaxWidth(),
            )
        } else {
            Text("🖼 $state", color = tokens.muted, style = MaterialTheme.typography.bodyMedium)
        }
        if (block.content.isNotBlank()) {
            Text(block.content, color = tokens.muted, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 4.dp))
        }
    }
}

/**
 * Image bytes from the offline cache, else from the server (then a smaller copy is cached).
 * Never throws: a broken cache entry or network error just shows the placeholder.
 */
suspend fun loadImageBytes(context: UserContext, attachmentId: String): ByteArray? {
    val cached = try {
        context.store.cachedAttachment(attachmentId)
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }
    if (cached != null) return cached
    return try {
        context.api.attachmentContent(attachmentId)?.also { bytes ->
            shrinkForCache(bytes)?.takeIf { it.size <= MAX_CACHED_IMAGE_BYTES }?.let {
                runCatching { context.store.cacheAttachment(attachmentId, it) }
            }
        }
    } catch (error: CancellationException) {
        throw error
    } catch (_: Exception) {
        null
    }
}
