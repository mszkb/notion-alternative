package net.notionalt.core

import kotlin.random.Random
import kotlin.test.Test
import kotlin.test.assertTrue

/** Block text comes from other devices and imports: parsing must never throw or drop characters. */
class InlineFuzzTest {
    @Test
    fun neverThrowsAndKeepsAllPlainCharacters() {
        val alphabet = "ab *_`[]()\\\\page:x\n🍝ü"
        val random = Random(42)
        repeat(20_000) {
            val source = (0 until random.nextInt(0, 40)).map { alphabet[random.nextInt(alphabet.length)] }.joinToString("")
            val spans = Inline.parse(source)
            val text = spans.joinToString("") { it.text }
            // Markup characters may disappear, letters never.
            for (c in "abü") assertTrue(text.count { it == c } == source.count { it == c }, "lost '$c' in <$source>")
            assertTrue(text.length <= source.length)
        }
        // Real-world samples.
        listOf("**", "**a", "_", "`", "[a](", "[a](page:", "[](https://x)", "\\", "a\\*b", "***x***", "[x](page:00000000-0000-0000-0000-000000000000)")
            .forEach { Inline.parse(it) }
    }
}
