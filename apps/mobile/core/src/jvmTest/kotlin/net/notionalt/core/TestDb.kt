package net.notionalt.core

import app.cash.sqldelight.driver.jdbc.sqlite.JdbcSqliteDriver
import net.notionalt.core.db.UserDatabase
import net.notionalt.core.store.LocalStore

fun memoryStore(): LocalStore {
    val driver = JdbcSqliteDriver(JdbcSqliteDriver.IN_MEMORY)
    UserDatabase.Schema.create(driver)
    var tick = 0
    return LocalStore(driver) { "2026-10-09T12:00:${(tick++).toString().padStart(2, '0')}.000Z" }
}
