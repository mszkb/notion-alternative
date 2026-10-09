rootProject.name = "notion-alt-mobile"

pluginManagement {
    repositories {
        if (providers.gradleProperty("mobile.jvmOnly").orNull != "true") google()
        // Google's mirror of Maven Central first: Maven Central rate-limits busy shared egress IPs.
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
        gradlePluginPortal()
    }
}

// `-Pmobile.jvmOnly=true` builds and tests only the platform-independent core on the JVM, for
// machines without access to Google's Maven repository and the Android SDK.
val jvmOnly = providers.gradleProperty("mobile.jvmOnly").orNull == "true"

dependencyResolutionManagement {
    repositories {
        if (!jvmOnly) google()
        maven("https://maven-central.storage-download.googleapis.com/maven2/")
        mavenCentral()
    }
}

include(":core")
if (!jvmOnly) {
    include(":shared")
    include(":androidApp")
}

// The full root build loads the Android plugin next to Kotlin (they must share a class loader).
if (jvmOnly) rootProject.buildFileName = "build-jvm.gradle.kts"
