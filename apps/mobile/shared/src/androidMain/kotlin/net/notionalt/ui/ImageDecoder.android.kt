package net.notionalt.ui

import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap

/** Longest side shown on a phone; larger photos are subsampled to save memory. */
private const val MAX_SIDE = 2048

actual fun decodeImage(bytes: ByteArray): ImageBitmap? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > MAX_SIDE) sample *= 2
    val options = BitmapFactory.Options().apply { inSampleSize = sample }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.asImageBitmap()
}.getOrNull()

actual fun shrinkForCache(bytes: ByteArray): ByteArray? = runCatching {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    // Small enough already: keep the original (no JPEG artefacts, transparency stays).
    if (bytes.size <= MAX_CACHED_IMAGE_BYTES && maxOf(bounds.outWidth, bounds.outHeight) <= 1600) return@runCatching bytes
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / sample > 1600) sample *= 2
    val bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample })
        ?: return@runCatching null
    val out = java.io.ByteArrayOutputStream()
    // JPEG has no alpha: transparent images would turn black.
    val format = if (bitmap.hasAlpha()) android.graphics.Bitmap.CompressFormat.PNG else android.graphics.Bitmap.CompressFormat.JPEG
    bitmap.compress(format, 85, out)
    out.toByteArray()
}.getOrNull()
