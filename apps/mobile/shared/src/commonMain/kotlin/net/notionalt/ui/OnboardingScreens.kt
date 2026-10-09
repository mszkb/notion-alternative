package net.notionalt.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import net.notionalt.core.api.ServerUrl

@Composable
private fun OnboardingColumn(content: @Composable () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .safeDrawingPadding()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Spacer(Modifier.height(32.dp))
        content()
    }
}

@Composable
fun ServerScreen(controller: AppController) {
    val scope = rememberCoroutineScope()
    var address by rememberSaveable { mutableStateOf(controller.session.serverUrl ?: "") }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val tokens = LocalTokens.current

    fun submit() {
        if (busy) return
        busy = true
        error = null
        scope.launch {
            error = controller.session.connect(address)
            busy = false
        }
    }

    OnboardingColumn {
        Text("Willkommen bei Notion Alt", style = MaterialTheme.typography.headlineMedium)
        Text(
            "Gib die Adresse deines Servers ein, so wie du sie im Browser öffnest.",
            style = MaterialTheme.typography.bodyLarge,
        )
        OutlinedTextField(
            value = address,
            onValueChange = { address = it },
            label = { Text("Server-Adresse") },
            placeholder = { Text("https://notizen.example.org") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Go),
            keyboardActions = KeyboardActions(onGo = { submit() }),
            modifier = Modifier.fillMaxWidth(),
        )
        Text(
            "Beispiele: https://server.tailnet-name.ts.net (Tailscale) oder http://192.168.1.20:8080 im Heimnetz.",
            style = MaterialTheme.typography.bodySmall,
            color = tokens.muted,
        )
        val normalized = ServerUrl.normalize(address)
        if (normalized is ServerUrl.Result.Ok && ServerUrl.isPlainHttp(normalized.url)) {
            Text(
                "Hinweis: Mit http:// wird unverschlüsselt übertragen. Das geht nur in der Entwicklerversion und sollte nur im eigenen Netz genutzt werden.",
                style = MaterialTheme.typography.bodySmall,
                color = tokens.warn,
            )
        }
        error?.let { Text(it, color = tokens.error) }
        Button(onClick = { submit() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Verbinden")
        }
    }
}

@Composable
fun LoginScreen(controller: AppController, serverUrl: String, message: String?) {
    val scope = rememberCoroutineScope()
    var email by rememberSaveable { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var error by remember { mutableStateOf(message) }
    var busy by remember { mutableStateOf(false) }
    val tokens = LocalTokens.current

    fun submit() {
        if (busy) return
        if (email.isBlank() || password.isEmpty()) {
            error = "Bitte E-Mail und Passwort eingeben."
            return
        }
        busy = true
        error = null
        scope.launch {
            error = controller.session.login(email, password)
            busy = false
        }
    }

    OnboardingColumn {
        Text("Anmelden", style = MaterialTheme.typography.headlineMedium)
        Text("Server: $serverUrl", style = MaterialTheme.typography.bodyMedium, color = tokens.muted)
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("E-Mail") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(
            value = password,
            onValueChange = { password = it },
            label = { Text("Passwort") },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { submit() }),
            modifier = Modifier.fillMaxWidth(),
        )
        error?.let { Text(it, color = tokens.error) }
        Button(onClick = { submit() }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
            if (busy) CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp) else Text("Anmelden")
        }
        TextButton(onClick = { controller.session.changeServer() }) { Text("Anderen Server wählen") }
        Text(
            "Ein Konto legst du in der Web-App an. Deine Seiten bleiben auch ohne Verbindung auf diesem Gerät lesbar.",
            style = MaterialTheme.typography.bodySmall,
            color = tokens.muted,
        )
    }
}
