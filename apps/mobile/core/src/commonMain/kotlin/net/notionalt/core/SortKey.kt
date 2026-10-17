package net.notionalt.core

/**
 * Fractional indexing, ported from the `fractional-indexing` package (v4, default digits) that
 * `@notion-alt/shared` uses (packages/shared/src/sort-key.ts). Keys compare as plain strings.
 */
object SortKey {
    private const val DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    private const val INT_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    private val SMALLEST_INTEGER = INT_DIGITS[0] + DIGITS[0].toString().repeat(INT_DIGITS.length / 2)

    private fun digit(c: Char): Int = DIGITS.indexOf(c).coerceAtLeast(0)

    private fun midpoint(a: String, b: String?): String {
        val zero = DIGITS[0]
        if (b != null && a >= b) throw IllegalArgumentException("$a >= $b")
        if (a.lastOrNull() == zero || (b != null && b.lastOrNull() == zero)) {
            throw IllegalArgumentException("trailing zero")
        }
        if (!b.isNullOrEmpty()) {
            var n = 0
            while ((a.getOrNull(n) ?: zero) == b.getOrNull(n)) n++
            if (n > 0) return b.substring(0, n) + midpoint(a.drop(n), b.drop(n))
        }
        val digitA = if (a.isNotEmpty()) digit(a[0]) else 0
        val digitB = if (b != null) (if (b.isNotEmpty()) digit(b[0]) else 0) else DIGITS.length
        return if (digitB - digitA > 1) {
            DIGITS[(digitA + digitB + 1) / 2].toString()
        } else if (b != null && b.length > 1) {
            b.substring(0, 1)
        } else {
            DIGITS[digitA] + midpoint(a.drop(1), null)
        }
    }

    private fun integerLength(head: Char): Int {
        val i = INT_DIGITS.indexOf(head)
        if (i == -1) throw IllegalArgumentException("invalid order key head: $head")
        val half = INT_DIGITS.length / 2
        return if (i < half) half - i + 1 else i - half + 2
    }

    private fun integerPart(key: String): String {
        val length = integerLength(key[0])
        if (length > key.length) throw IllegalArgumentException("invalid order key: $key")
        return key.substring(0, length)
    }

    private fun validate(key: String) {
        if (key == SMALLEST_INTEGER) throw IllegalArgumentException("invalid order key: $key")
        val i = integerPart(key)
        if (key.substring(i.length).lastOrNull() == DIGITS[0]) {
            throw IllegalArgumentException("invalid order key: $key")
        }
    }

    private fun incrementInteger(x: String): String? {
        if (x.length != integerLength(x[0])) throw IllegalArgumentException("invalid integer: $x")
        val head = x[0]
        var trailing = ""
        for (i in x.length - 1 downTo 1) {
            val d = digit(x[i]) + 1
            if (d == DIGITS.length) {
                trailing = DIGITS[0] + trailing
            } else {
                return head + x.substring(1, i) + DIGITS[d] + trailing
            }
        }
        val headIndex = INT_DIGITS.indexOf(head)
        if (headIndex == INT_DIGITS.length - 1) return null
        val h = INT_DIGITS[headIndex + 1]
        val delta = integerLength(h) - integerLength(head)
        return h + when {
            delta > 0 -> trailing + DIGITS[0]
            delta < 0 -> trailing.drop(1)
            else -> trailing
        }
    }

    private fun decrementInteger(x: String): String? {
        if (x.length != integerLength(x[0])) throw IllegalArgumentException("invalid integer: $x")
        val head = x[0]
        val last = DIGITS.last()
        var trailing = ""
        for (i in x.length - 1 downTo 1) {
            val d = digit(x[i]) - 1
            if (d == -1) {
                trailing = last + trailing
            } else {
                return head + x.substring(1, i) + DIGITS[d] + trailing
            }
        }
        val headIndex = INT_DIGITS.indexOf(head)
        if (headIndex == 0) return null
        val h = INT_DIGITS[headIndex - 1]
        val delta = integerLength(h) - integerLength(head)
        return h + when {
            delta > 0 -> trailing + last
            delta < 0 -> trailing.drop(1)
            else -> trailing
        }
    }

    /** `generateKeyBetween` of the library (`null` = list start/end). */
    fun generateKeyBetween(before: String?, after: String?): String {
        before?.let(::validate)
        after?.let(::validate)
        var a = before
        var b = after
        if (a != null && b != null && a > b) {
            val t = a
            a = b
            b = t
        }
        if (a == null) {
            if (b == null) return INT_DIGITS[INT_DIGITS.length / 2].toString() + DIGITS[0]
            val ib = integerPart(b)
            val fb = b.substring(ib.length)
            if (ib == SMALLEST_INTEGER) return ib + midpoint("", fb)
            if (ib < b) return ib
            return decrementInteger(ib) ?: throw IllegalStateException("cannot decrement any more")
        }
        if (b == null) {
            val ia = integerPart(a)
            val fa = a.substring(ia.length)
            return incrementInteger(ia) ?: (ia + midpoint(fa, null))
        }
        val ia = integerPart(a)
        val fa = a.substring(ia.length)
        val ib = integerPart(b)
        val fb = b.substring(ib.length)
        if (ia == ib) return ia + midpoint(fa, fb)
        val i = incrementInteger(ia) ?: throw IllegalStateException("cannot increment any more")
        if (i < b) return i
        return ia + midpoint(fa, null)
    }

    /**
     * Key between two neighbours, as `sortKeyBetween` in `@notion-alt/shared`: neighbours with equal
     * keys (concurrent inserts) leave no room, so the key goes after `before`.
     */
    fun between(before: String?, after: String?): String {
        if (before != null && after != null && before >= after) return generateKeyBetween(before, null)
        return generateKeyBetween(before, after)
    }
}

/** Orders items by sort key, ties broken by id (`compareBySortKey`). */
fun <T> List<T>.sortedBySortKey(sortKey: (T) -> String, id: (T) -> String): List<T> =
    sortedWith { x, y ->
        val a = sortKey(x)
        val b = sortKey(y)
        if (a != b) a.compareTo(b) else id(x).compareTo(id(y))
    }
