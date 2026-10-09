package net.notionalt.ui

import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import net.notionalt.core.Inline

/** Renders Markdown-inline content (ADR 0008) with clickable page and web links. */
fun inlineText(
    content: String,
    tokens: Tokens,
    pageTitle: (String) -> String?,
    openPage: (String) -> Unit,
    openUrl: (String) -> Unit,
): AnnotatedString = buildAnnotatedString {
    for (span in Inline.parse(content)) {
        val style = SpanStyle(
            fontWeight = if (span.bold) FontWeight.Bold else null,
            fontStyle = if (span.italic) FontStyle.Italic else null,
            fontFamily = if (span.code) FontFamily.Monospace else null,
            background = if (span.code) tokens.codeBg else androidx.compose.ui.graphics.Color.Unspecified,
        )
        val linkStyle = TextLinkStyles(SpanStyle(color = tokens.accent, textDecoration = TextDecoration.Underline))
        when {
            span.pageId != null -> {
                val id = span.pageId!!
                withLink(LinkAnnotation.Clickable("page:$id", linkStyle) { openPage(id) }) {
                    withStyle(style) { append(pageTitle(id)?.ifBlank { null } ?: span.text) }
                }
            }
            span.href != null -> {
                val href = span.href!!
                withLink(LinkAnnotation.Clickable(href, linkStyle) { openUrl(href) }) {
                    withStyle(style) { append(span.text) }
                }
            }
            else -> withStyle(style) { append(span.text) }
        }
    }
}
