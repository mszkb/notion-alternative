package net.notionalt.core

/** A run of text with its formatting, from the Markdown-inline subset of `Block.content` (ADR 0008). */
data class InlineSpan(
    val text: String,
    val bold: Boolean = false,
    val italic: Boolean = false,
    val code: Boolean = false,
    /** http(s)/mailto link. */
    val href: String? = null,
    /** Page link `[title](page:<uuid>)`. */
    val pageId: String? = null,
)

/**
 * Simplified port of `parseInline` (packages/shared/src/inline.ts) for display: `**bold**`,
 * `_italic_`/`*italic*`, `` `code` ``, `[text](url)` and page links. Anything that does not form
 * valid syntax stays literal text, so nothing is dropped.
 */
object Inline {
    private val escapable = setOf('\\', '*', '_', '`', '[', ']')
    private val uuid = Regex("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")

    fun parse(source: String): List<InlineSpan> {
        val out = mutableListOf<InlineSpan>()
        parseRange(source, 0, source.length, InlineSpan(""), out, allowLinks = true)
        // Merge neighbours with equal formatting.
        val merged = mutableListOf<InlineSpan>()
        for (span in out) {
            val last = merged.lastOrNull()
            if (last != null && last.copy(text = "") == span.copy(text = "")) {
                merged[merged.size - 1] = last.copy(text = last.text + span.text)
            } else if (span.text.isNotEmpty()) {
                merged += span
            }
        }
        return merged
    }

    /** Plain text without markup (titles of page links, previews). */
    fun plain(source: String): String = parse(source).joinToString("") { it.text }

    private fun findClosing(src: String, from: Int, end: Int, marker: String): Int {
        var i = from
        while (i < end) {
            if (src[i] == '\\' && i + 1 < end) {
                i += 2
                continue
            }
            if (src.startsWith(marker, i) && i + marker.length <= end) return i
            i++
        }
        return -1
    }

    private fun parseRange(src: String, start: Int, end: Int, style: InlineSpan, out: MutableList<InlineSpan>, allowLinks: Boolean) {
        val text = StringBuilder()
        fun flush() {
            if (text.isNotEmpty()) out += style.copy(text = text.toString())
            text.clear()
        }
        var i = start
        while (i < end) {
            val ch = src[i]
            if (ch == '\\' && i + 1 < end && src[i + 1] in escapable) {
                text.append(src[i + 1])
                i += 2
                continue
            }
            if (ch == '`') {
                val close = src.indexOf('`', i + 1)
                if (close != -1 && close < end && close > i + 1) {
                    flush()
                    out += style.copy(text = src.substring(i + 1, close), code = true)
                    i = close + 1
                    continue
                }
            }
            if (ch == '*' && i + 1 < end && src[i + 1] == '*') {
                val close = findClosing(src, i + 2, end, "**")
                if (close > i + 2) {
                    flush()
                    parseRange(src, i + 2, close, style.copy(bold = true), out, allowLinks)
                    i = close + 2
                    continue
                }
            }
            if (ch == '_' || ch == '*') {
                val close = findClosing(src, i + 1, end, ch.toString())
                if (close > i + 1) {
                    flush()
                    parseRange(src, i + 1, close, style.copy(italic = true), out, allowLinks)
                    i = close + 1
                    continue
                }
            }
            if (ch == '[' && allowLinks) {
                val closeText = findClosing(src, i + 1, end, "]")
                if (closeText != -1 && closeText + 1 < end && src[closeText + 1] == '(') {
                    val closeHref = src.indexOf(')', closeText + 2)
                    if (closeHref != -1 && closeHref < end) {
                        val href = src.substring(closeText + 2, closeHref)
                        val pageId = href.removePrefix("page:").takeIf { href.startsWith("page:") && uuid.matches(it) }
                        val safe = href.startsWith("http://") || href.startsWith("https://") || href.startsWith("mailto:")
                        if (pageId != null || safe) {
                            flush()
                            val linkStyle = if (pageId != null) style.copy(pageId = pageId) else style.copy(href = href)
                            parseRange(src, i + 1, closeText, linkStyle, out, allowLinks = false)
                            i = closeHref + 1
                            continue
                        }
                    }
                }
            }
            text.append(ch)
            i++
        }
        flush()
    }
}
