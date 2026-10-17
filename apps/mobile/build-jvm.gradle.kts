// Root build for `-Pmobile.jvmOnly=true` (see settings.gradle.kts): without the Android plugin.
plugins {
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.sqldelight) apply false
}
