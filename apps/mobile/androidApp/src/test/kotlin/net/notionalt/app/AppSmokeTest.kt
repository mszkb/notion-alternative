package net.notionalt.app

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import net.notionalt.ui.AppGraph
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.annotation.Config

/**
 * Starts the real app (Robolectric) and walks through onboarding, login, the page list and the
 * editor against a running server. Without NOTION_ALT_SERVER only the start screen is checked.
 */
@OptIn(ExperimentalTestApi::class)
@RunWith(AndroidJUnit4::class)
@Config(sdk = [34])
class AppSmokeTest {
    @get:Rule
    val compose = createAndroidComposeRule<MainActivity>()

    private val server: String? = System.getenv("NOTION_ALT_SERVER")

    @Test
    fun onboardingLoginAndEditing() {
        compose.waitUntilAtLeastOneExists(hasText("Willkommen bei Notion Alt"), 10_000)
        val url = server ?: return

        compose.onNodeWithText("Server-Adresse").performTextInput(url)
        compose.onNodeWithText("Verbinden").performClick()
        compose.waitUntilAtLeastOneExists(hasText("E-Mail"), 20_000)

        compose.onNodeWithText("E-Mail").performTextInput("test@example.org")
        compose.onNodeWithText("Passwort").performTextInput("geheim12345")
        compose.onNode(hasText("Anmelden") and androidx.compose.ui.test.hasClickAction()).performClick()

        // Home: the workspace from the snapshot and the sync status.
        compose.waitUntilAtLeastOneExists(hasText("Personal"), 30_000)
        compose.waitUntilAtLeastOneExists(hasText("Synchronisiert", substring = true), 30_000)

        // New page, one block of text.
        compose.onNodeWithContentDescription("Neue Seite").performClick()
        compose.waitUntilAtLeastOneExists(hasText("Block hinzufügen", substring = true), 10_000)
        compose.onNodeWithText("Block hinzufügen", substring = true).performClick()
        compose.waitUntilAtLeastOneExists(isFocused(), 5_000)
        compose.onNode(isFocused()).performTextInput("Hallo vom Smoketest")
        compose.onNodeWithContentDescription("Fertig").performClick()
        compose.waitUntilAtLeastOneExists(hasText("Hallo vom Smoketest"), 5_000)
        compose.onNodeWithContentDescription("Zurück").performClick()

        // The change reaches the server (queue empty again).
        compose.waitUntilAtLeastOneExists(hasContentDescription("Neue Seite"), 5_000)
        val context = AppGraph.controller(compose.activity).current!!
        compose.waitUntil(30_000) { context.store.pendingCount() == 0L }
    }
}
