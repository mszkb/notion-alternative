package net.notionalt.ui

import androidx.compose.ui.graphics.ImageBitmap

/** Decodes PNG/JPEG/GIF/WebP bytes with the platform's codec; null if it cannot. */
expect fun decodeImage(bytes: ByteArray): ImageBitmap?
