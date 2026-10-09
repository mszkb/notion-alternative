package net.notionalt.ui

import androidx.compose.ui.graphics.ImageBitmap

/** Decodes PNG/JPEG/GIF/WebP bytes with the platform's codec; null if it cannot. */
expect fun decodeImage(bytes: ByteArray): ImageBitmap?

/**
 * A smaller copy for the offline cache (longest side about 1600 px, JPEG); null if it cannot be
 * made. Keeps cached rows well below Android's 2 MB cursor window.
 */
expect fun shrinkForCache(bytes: ByteArray): ByteArray?

/** Largest cached image; bigger ones are shown but not kept offline. */
const val MAX_CACHED_IMAGE_BYTES = 1_500_000
