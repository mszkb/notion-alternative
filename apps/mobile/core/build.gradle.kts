import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.kotlin.multiplatform)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.sqldelight)
}

kotlin {
    // Platform-independent client logic (API, local database, sync). The JVM target serves the
    // Android app (an Android consumer accepts JVM libraries) and the unit tests.
    jvm {
        compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
    }
    iosArm64()
    iosSimulatorArm64()

    sourceSets {
        commonMain.dependencies {
            api(libs.kotlinx.coroutines.core)
            api(libs.kotlinx.serialization.json)
            api(libs.ktor.client.core)
            api(libs.sqldelight.runtime)
            implementation(libs.sqldelight.coroutines)
        }
        commonTest.dependencies {
            implementation(kotlin("test"))
            implementation(libs.kotlinx.coroutines.test)
            implementation(libs.ktor.client.mock)
        }
        jvmTest.dependencies {
            implementation(libs.sqldelight.sqlite.driver)
            implementation(libs.ktor.client.cio)
        }
        iosMain.dependencies {
            implementation(libs.ktor.client.darwin)
            implementation(libs.sqldelight.native.driver)
        }
    }
}

sqldelight {
    databases {
        create("UserDatabase") {
            packageName.set("net.notionalt.core.db")
            srcDirs("src/commonMain/sqldelight/user")
        }
        create("AppDatabase") {
            packageName.set("net.notionalt.core.appdb")
            srcDirs("src/commonMain/sqldelight/app")
        }
    }
}

tasks.withType<Test>().configureEach {
    testLogging { events("passed", "skipped", "failed") }
    // Integration test against a running PHP server (see apps/mobile/README.md).
    System.getenv("NOTION_ALT_SERVER")?.let { environment("NOTION_ALT_SERVER", it) }
}
