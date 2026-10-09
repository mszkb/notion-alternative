package net.notionalt.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.notionalt.core.UserContext

/** Cover gradients of the web app (`.cover-*` in apps/web/src/styles.css, #136). */
private val gradients = mapOf(
    "sunrise" to (Color(0xFFF6D365) to Color(0xFFFDA085)),
    "ocean" to (Color(0xFF89F7FE) to Color(0xFF2563D9)),
    "forest" to (Color(0xFFA8E063) to Color(0xFF2B7530)),
    "dusk" to (Color(0xFF614385) to Color(0xFF516395)),
    "sand" to (Color(0xFFF5EFE6) to Color(0xFFD6C4A8)),
    "slate" to (Color(0xFF8E9EAB) to Color(0xFF3D4A57)),
)

/** Page cover: a gradient or an attached image (`attachment:<uuid>`), nothing otherwise. */
@Composable
fun PageCover(context: UserContext, cover: String?) {
    if (cover == null) return
    val modifier = Modifier.fillMaxWidth().height(120.dp)
    if (cover.startsWith("gradient:")) {
        val (from, to) = gradients[cover.removePrefix("gradient:")] ?: return
        Box(modifier.background(Brush.linearGradient(listOf(from, to), start = Offset.Zero, end = Offset.Infinite)))
        return
    }
    val attachmentId = cover.removePrefix("attachment:").takeIf { cover.startsWith("attachment:") } ?: return
    var image by remember(attachmentId) { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(attachmentId) {
        val bytes = withContext(Dispatchers.Default) {
            context.store.cachedAttachment(attachmentId) ?: try {
                context.api.attachmentContent(attachmentId)?.also { context.store.cacheAttachment(attachmentId, it) }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                null
            }
        }
        image = bytes?.let(::decodeImage)
    }
    val bitmap = image
    if (bitmap != null) {
        Image(bitmap = bitmap, contentDescription = null, contentScale = ContentScale.Crop, modifier = modifier)
    } else {
        Box(modifier.background(LocalTokens.current.sidebar))
    }
}
