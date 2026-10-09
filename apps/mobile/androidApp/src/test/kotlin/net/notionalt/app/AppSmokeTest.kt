package net.notionalt.app

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.hasContentDescription
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.isFocused
import androidx.compose.ui.test.isToggleable
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextInputSelection
import androidx.compose.ui.test.performKeyInput
import androidx.compose.ui.test.pressKey
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
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

    private fun context() = AppGraph.controller(compose.activity).current!!

    @Test
    fun onboardingLoginAndEditing() {
        try {
            walkThrough()
        } catch (error: Throwable) {
            // The semantics tree shows what was on screen when a step failed.
            println(compose.onRoot(useUnmergedTree = true).printToString(maxDepth = 30))
            throw error
        }
    }

    private fun walkThrough() {
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

        // Enter in the middle of a block splits it without duplicating the tail.
        compose.onNodeWithText("Block hinzufügen", substring = true).performClick()
        compose.waitUntilAtLeastOneExists(isFocused(), 5_000)
        compose.onNode(isFocused()).performTextInput("KopfSchwanz")
        compose.onNode(isFocused()).performTextInputSelection(androidx.compose.ui.text.TextRange(4))
        compose.onNode(isFocused()).performTextInput("\n")
        compose.onNodeWithContentDescription("Fertig").performClick()
        compose.waitUntilAtLeastOneExists(hasText("Kopf"), 5_000)
        compose.onNodeWithText("Schwanz").assertExists()
        compose.onNodeWithText("KopfSchwanz").assertDoesNotExist()

        // Backspace at the start joins the block with the one above.
        compose.onNodeWithText("Schwanz").performClick()
        compose.waitUntilAtLeastOneExists(isFocused(), 5_000)
        compose.onNode(isFocused()).performTextInputSelection(androidx.compose.ui.text.TextRange(0))
        compose.onNode(isFocused()).performKeyInput { pressKey(androidx.compose.ui.input.key.Key.Backspace) }
        compose.waitUntilAtLeastOneExists(hasText("KopfSchwanz"), 5_000)
        compose.onNodeWithContentDescription("Fertig").performClick()
        compose.onNodeWithText("Schwanz").assertDoesNotExist()

        // Slash menu: "/zit" offers the quote block.
        compose.onNodeWithText("Block hinzufügen", substring = true).performClick()
        compose.waitUntilAtLeastOneExists(isFocused(), 5_000)
        compose.onNode(isFocused()).performTextInput("/zit")
        compose.waitUntilAtLeastOneExists(hasText("Zitat"), 5_000)
        compose.onNodeWithText("Zitat").performClick()
        compose.onNode(isFocused()).performTextInput("Weisheit")
        compose.onNodeWithContentDescription("Fertig").performClick()
        compose.waitUntilAtLeastOneExists(hasText("Weisheit"), 5_000)
        compose.onNodeWithText("/zit").assertDoesNotExist()

        // Markdown shortcut, to-do, undo and the move dialog on the same page.
        compose.onNodeWithText("Block hinzufügen", substring = true).performClick()
        compose.waitUntilAtLeastOneExists(isFocused(), 5_000)
        compose.onNode(isFocused()).performTextInput("[] ")
        compose.onNode(isFocused()).performTextInput("Aufgabe")
        compose.onNodeWithContentDescription("Fertig").performClick()
        compose.waitUntilAtLeastOneExists(hasText("Aufgabe"), 5_000)
        compose.onNode(isToggleable()).performClick()
        compose.onNode(isToggleable()).assertIsOn()
        compose.onNodeWithContentDescription("Rückgängig").performClick()
        compose.onNode(isToggleable()).assertIsOff()
        compose.onNodeWithContentDescription("Menü").performClick()
        compose.onNodeWithText("Verschieben nach …").performClick()
        compose.waitUntilAtLeastOneExists(hasText("Oberste Ebene"), 5_000)
        compose.onNodeWithText("Abbrechen").performClick()
        compose.onNodeWithContentDescription("Zurück").performClick()

        // The change reaches the server (queue empty again).
        compose.waitUntilAtLeastOneExists(hasContentDescription("Neue Seite"), 5_000)
        compose.waitUntil(30_000) { context().store.pendingCount() == 0L }

        // Local search finds the new text and opens the page.
        compose.onNodeWithContentDescription("Suchen").performClick()
        compose.waitUntilAtLeastOneExists(isFocused(), 5_000)
        compose.onNode(isFocused()).performTextInput("Smoketest")
        compose.waitUntilAtLeastOneExists(hasText("Ohne Titel"), 5_000)
        compose.onNodeWithText("Ohne Titel").performClick()
        compose.waitUntilAtLeastOneExists(hasText("Hallo vom Smoketest"), 5_000)
        compose.onNodeWithContentDescription("Zurück").performClick()
        compose.onNodeWithContentDescription("Zurück").performClick()

        // "Alles offline verfügbar machen" from the menu.
        compose.waitUntilAtLeastOneExists(hasContentDescription("Menü"), 5_000)
        compose.onNodeWithContentDescription("Menü").performClick()
        compose.onNodeWithText("Alles offline verfügbar machen").performClick()
        compose.waitUntilAtLeastOneExists(hasText("Fertig:", substring = true), 30_000)
    }
}
