// Must stay the first import (strict CSP without eval, #74).
import './eval-free'
import { createApp } from 'vue'
import App from './App.vue'
import { setupInstall } from './install'
import { requestPersistence } from './local/context'
import { registerServiceWorker } from './pwa'
import { router } from './router'
import './styles.css'
import { initTheme } from './theme'

initTheme()
createApp(App).use(router).mount('#app')
// Guests opening a read link (ADR 0022) get no offline app installed in their browser.
if (!window.location.pathname.startsWith('/share/')) void registerServiceWorker()
// Installed apps get persistent storage more readily: ask again after installing.
setupInstall(() => void requestPersistence())
