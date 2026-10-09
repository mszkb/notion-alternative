package net.notionalt.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import net.notionalt.core.SessionState

@Composable
fun App(controller: AppController) {
    NotionAltTheme {
        Surface(modifier = Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            val state by controller.session.state.collectAsState()
            when (val s = state) {
                is SessionState.NeedsServer -> ServerScreen(controller)
                is SessionState.NeedsLogin -> LoginScreen(controller, s.serverUrl, s.message, s.localUser?.email)
                is SessionState.Ready -> MainScreen(controller, s.context)
            }
        }
    }
}
