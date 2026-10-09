rootProject.name = "notion-alt-mobile"

pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        google()
        mavenCentral()
    }
}

// `-Pmobile.jvmOnly=true` builds and tests only the platform-independent core on the JVM, for
// machines without access to Google's Maven repository and the Android SDK.
val jvmOnly = providers.gradleProperty("mobile.jvmOnly").orNull == "true"

include(":core")
if (!jvmOnly) {
    include(":shared")
    include(":androidApp")
}

// The full root build loads the Android plugin next to Kotlin (they must share a class loader).
if (jvmOnly) rootProject.buildFileName = "build-jvm.gradle.kts"
