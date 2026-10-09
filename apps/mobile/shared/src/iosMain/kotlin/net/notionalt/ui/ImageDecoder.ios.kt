package net.notionalt.ui

import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.toComposeImageBitmap
import org.jetbrains.skia.Image

actual fun decodeImage(bytes: ByteArray): ImageBitmap? =
    runCatching { Image.makeFromEncoded(bytes).toComposeImageBitmap() }.getOrNull()

actual fun shrinkForCache(bytes: ByteArray): ByteArray? = bytes.takeIf { it.size <= MAX_CACHED_IMAGE_BYTES }
