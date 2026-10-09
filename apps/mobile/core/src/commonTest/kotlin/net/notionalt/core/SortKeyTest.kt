package net.notionalt.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Expected values were generated with the `fractional-indexing` package (v4) the web app uses. */
class SortKeyTest {
    private val vectors = listOf(
        Triple(null, null, "a0"),
        Triple(null, "a0", "Zz"),
        Triple("a0", null, "a1"),
        Triple("a0", "a1", "a0V"),
        Triple("a1", "a2", "a1V"),
        Triple("a0V", "a1", "a0l"),
        Triple("Zz", "a0", "ZzV"),
        Triple("Zz", "a1", "a0"),
        Triple(null, "Y00", "Xzzz"),
        Triple("bzz", null, "c000"),
        Triple("a0", "a0V", "a0G"),
        Triple("zzzzzzzzzzzzzzzzzzzzzzzzzzy", null, "zzzzzzzzzzzzzzzzzzzzzzzzzzz"),
        Triple("a0", "a001", "a000V"),
        Triple("a1", "b00", "a2"),
        Triple("Zzz", "a0", "ZzzV"),
        Triple("a0", "a1V", "a1"),
        Triple("b125", "b129", "b127"),
        Triple("a8", "a9", "a8V"),
        Triple("a9", null, "aA"),
        Triple("az", null, "b00"),
        Triple("Zy", null, "Zz"),
        Triple(null, "Zz", "Zy"),
        Triple("a0V", "a0X", "a0W"),
        Triple("a0V", "a0W", "a0VV"),
    )

    @Test
    fun matchesTheJavaScriptLibrary() {
        for ((a, b, expected) in vectors) {
            assertEquals(expected, SortKey.generateKeyBetween(a, b), "between $a and $b")
        }
    }

    @Test
    fun appendingAndPrependingRepeatedly() {
        var key: String? = null
        val keys = mutableListOf<String>()
        repeat(70) { key = SortKey.generateKeyBetween(key, null).also(keys::add) }
        assertEquals(listOf("b05", "b06", "b07"), keys.takeLast(3))
        var first: String? = null
        repeat(70) { first = SortKey.generateKeyBetween(null, first) }
        assertEquals("Yzt", first)
        var upper = "a1"
        repeat(20) { upper = SortKey.generateKeyBetween("a0", upper) }
        assertEquals("a0000G", upper)
    }

    @Test
    fun equalNeighboursAppendAfterBefore() {
        // Concurrent inserts can leave two siblings with the same key (sort-key.ts).
        assertEquals("a2", SortKey.between("a1", "a1"))
        assertEquals("a2", SortKey.between("a1", "a0"))
        assertEquals("a0V", SortKey.between("a0", "a1"))
    }

    @Test
    fun ordersByKeyThenId() {
        val items = listOf("a1" to "b", "a0" to "z", "a1" to "a")
        val sorted = items.sortedBySortKey({ it.first }, { it.second })
        assertEquals(listOf("a0" to "z", "a1" to "a", "a1" to "b"), sorted)
        assertTrue("Zz" < "a0")
    }
}
