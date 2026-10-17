# 0020 – Native Apps mit Kotlin Multiplatform und Compose Multiplatform

- **Status:** Accepted
- **Datum:** 2026-10-09

## Kontext

Neben der PWA (Phase 4) soll es native Clients für Android und iOS geben (Epic #147). Sie müssen dieselben Prinzipien einhalten wie die Web-App: local-first, offline-first, keine stillen Überschreibungen, Sync über das bestehende Protokoll (ADR 0002, ADR 0017) ohne Änderungen am Server. Möglichst viel Code soll zwischen Android und iOS geteilt werden.

## Optionen

1. **Kotlin Multiplatform (KMP) + Compose Multiplatform** – Logik und UI einmal in Kotlin, echte native Apps mit SQLite, Hintergrund-Sync (WorkManager/BGTask) und Keystore/Keychain. Nachteil: zweite Implementierung des Sync-Protokolls neben TypeScript.
2. **Capacitor (SPA im WebView)** – fast kein neuer Code, aber IndexedDB im WebView ist auf iOS nicht verlässlich persistent, Hintergrund-Sync und Speicherverhalten sind eingeschränkt; das Problem „PWA auf iOS“ bleibt im Kern bestehen.
3. **Tauri 2 Mobile** – ebenfalls WebView-basiert, Mobile-Unterstützung noch jung, Rust als zusätzliche Sprache.
4. **React Native** – teilt TypeScript mit der Web-App, aber die Vue-Komponenten nicht; lokale DB, Hintergrundarbeit und Editor wären ebenfalls neu, mit großem JS-Abhängigkeitsbaum.

## Entscheidung

Option 1: **KMP + Compose Multiplatform** in `apps/mobile` (Gradle, Version Catalog `gradle/libs.versions.toml`).

- **Module:**
  - `core/` – plattformunabhängige Logik in `commonMain` (Modelle, API-Client, lokale Datenbank, Sync, Sortierschlüssel, Markdown-Inline). Targets `jvm` (dient der Android-App und den Unit-Tests) sowie `iosArm64`/`iosSimulatorArm64`. Es ist ein eigenes Modul ohne Android-Plugin, damit Logik und Tests auch ohne Android-SDK bauen (`-Pmobile.jvmOnly=true`).
  - `shared/` – Compose-UI in `commonMain`, Plattformcode in `androidMain`/`iosMain` hinter Schnittstellen (`Platform`, `DriverFactory`, `BackgroundSync`, `PushRegistrar`).
  - `androidApp/` – Activity, Manifest, Netzwerk-Sicherheitskonfiguration.
  - `iosApp/` (Xcode-Hülle) folgt mit dem iOS-Build.
- **Bibliotheken:** Ktor Client (OkHttp/Darwin), kotlinx.serialization, kotlinx.coroutines, kotlinx.datetime, SQLDelight, Navigation Compose (Multiplatform), keine DI-Bibliothek (manuelle Verdrahtung); Tests mit kotlin.test. ktlint/detekt und Turbine folgen bei Bedarf.
- **Lokale Speicherung:** SQLDelight statt Dexie. Übernommen aus ADR 0001/0009: eine Datenbank pro Benutzer, Entität und Operation in derselben Transaktion, Feldnamen camelCase wie im Web-Client. Die lokale Suche wird SQLite FTS5 statt MiniSearch nutzen.
- **Auth:** zunächst das vorhandene Session-Cookie: Die App liest es aus `Set-Cookie` und sendet es selbst als `Cookie`-Header (unabhängig von `Secure`/`Path`). Token-Auth (#152) und Ablage im Keystore/Keychain (#171) folgen.
- **Code-Sharing mit der Web-App** über Verträge statt Code: Contract-Tests (`packages/contract-tests`), gemeinsame Testvektoren (z. B. Sortierschlüssel aus `fractional-indexing`), JSON Schema, Design-Tokens aus `apps/web/src/styles.css`. Verworfen: Kotlin/JS-Bibliotheken für die Web-App (zweiter Build-Stack im Web, große Bundles) und Codegenerierung aus zod (die zod-Schemas enthalten Verfeinerungen, die sich nicht verlustfrei übertragen lassen).
- **Mindestversionen:** Android 8 (API 26), iOS 16 (zu prüfen, wenn der iOS-Build steht).
- **HTTP:** Debug-Builds erlauben unverschlüsseltes HTTP (Heimnetz, Tailscale ohne Zertifikat), Release-Builds nur HTTPS.

## Konsequenzen

- Zwei Client-Implementierungen des Sync-Protokolls. Gegenmaßnahmen: Contract-Tests als Spezifikation, gemeinsame Testvektoren, ein Integrationstest der App gegen den echten Server (zwei Geräte) und eine Parity-Checkliste.
- Neue Toolchain (Gradle, Android SDK, später Xcode) in CI: Workflow `.github/workflows/android.yml` baut die Debug-APK und veröffentlicht sie in der Pre-Release `android-dev`.
- Folgeaufgaben laut Epic #147: Vision, MVP-Scope und Nicht-Ziele anpassen (native App ist kein Nicht-Ziel mehr), Roadmap-Abschnitt „Native Apps“, Mobile-Architektur in `docs/architecture/`, Token-Auth, Keystore, Push (FCM/APNs), iOS-Build.
