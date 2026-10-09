package net.notionalt.core

import kotlinx.serialization.json.JsonObject
import net.notionalt.core.model.Block
import net.notionalt.core.model.Document
import net.notionalt.core.model.SnapshotResponse
import kotlin.test.Test
import kotlin.time.measureTime

class LoadProbe {
    @Test
    fun snapshotOf10000Pages() {
        if (System.getenv("LOAD_PROBE") == null) return
        val store = memoryStore()
        val ws = "11111111-1111-4111-8111-111111111111"
        val docs = (0 until 10_000).map { Document(newId(), ws, null, "Seite $it", "a$it", false, null, null, "c", "u", 1, null) }
        val seen = mutableSetOf<String>()
        store.beginResync(ws)
        val t = measureTime {
            for (chunk in docs.chunked(2000)) {
                store.applySnapshotPage(ws, SnapshotResponse(chunk, emptyList(), cursor = 1), false, seen)
            }
            store.finishResync(ws, 1, false, seen)
        }
        val list = measureTime { store.documents(ws) }
        println("LOAD snapshot 10k pages: $t, documents(): $list")
        val blocks = (0 until 300).map { Block(newId(), docs[0].id, "paragraph", "Text $it", JsonObject(emptyMap()), "a$it", 1, null) }
        val c = measureTime { store.applyDocumentContent(ws, net.notionalt.core.model.DocumentResponse(docs[0], blocks, 5)) }
        println("LOAD page with 300 blocks: $c")
    }
}
