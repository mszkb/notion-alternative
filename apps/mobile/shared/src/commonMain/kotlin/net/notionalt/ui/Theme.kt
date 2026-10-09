package net.notionalt.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/** Values of the design tokens in apps/web/src/styles.css (docs/product/ux-guide.md). */
@Immutable
data class Tokens(
    val bg: Color,
    val surface: Color,
    val sidebar: Color,
    val text: Color,
    val muted: Color,
    val border: Color,
    val accent: Color,
    val onAccent: Color,
    val error: Color,
    val ok: Color,
    val warn: Color,
    val codeBg: Color,
)

val LightTokens = Tokens(
    bg = Color(0xFFF6F6F4),
    surface = Color(0xFFFFFFFF),
    sidebar = Color(0xFFF0EFEB),
    text = Color(0xFF1F1F1F),
    muted = Color(0xFF666666),
    border = Color(0xFFE2E2DF),
    accent = Color(0xFF2563D9),
    onAccent = Color(0xFFFFFFFF),
    error = Color(0xFFC62828),
    ok = Color(0xFF2B7530),
    warn = Color(0xFF9A5B00),
    codeBg = Color(0x26878378),
)

val DarkTokens = Tokens(
    bg = Color(0xFF191919),
    surface = Color(0xFF232323),
    sidebar = Color(0xFF1F1F1F),
    text = Color(0xFFECECEC),
    muted = Color(0xFF9B9B9B),
    border = Color(0xFF353535),
    accent = Color(0xFF6C9CFF),
    onAccent = Color(0xFF111111),
    error = Color(0xFFEF5350),
    ok = Color(0xFF66BB6A),
    warn = Color(0xFFFFB74D),
    codeBg = Color(0x40878378),
)

val LocalTokens = staticCompositionLocalOf { LightTokens }

@Composable
fun NotionAltTheme(content: @Composable () -> Unit) {
    val tokens = if (isSystemInDarkTheme()) DarkTokens else LightTokens
    val scheme = if (isSystemInDarkTheme()) {
        darkColorScheme(
            primary = tokens.accent,
            onPrimary = tokens.onAccent,
            background = tokens.bg,
            onBackground = tokens.text,
            surface = tokens.surface,
            onSurface = tokens.text,
            surfaceVariant = tokens.sidebar,
            onSurfaceVariant = tokens.muted,
            outline = tokens.border,
            error = tokens.error,
        )
    } else {
        lightColorScheme(
            primary = tokens.accent,
            onPrimary = tokens.onAccent,
            background = tokens.bg,
            onBackground = tokens.text,
            surface = tokens.surface,
            onSurface = tokens.text,
            surfaceVariant = tokens.sidebar,
            onSurfaceVariant = tokens.muted,
            outline = tokens.border,
            error = tokens.error,
        )
    }
    androidx.compose.runtime.CompositionLocalProvider(LocalTokens provides tokens) {
        MaterialTheme(colorScheme = scheme, content = content)
    }
}
