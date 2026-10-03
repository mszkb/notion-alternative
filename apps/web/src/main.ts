import { createApp } from 'vue'
import App from './App.vue'
import { setupInstall } from './install'
import { requestPersistence } from './local/context'
import { registerServiceWorker } from './pwa'
import { router } from './router'
import './styles.css'

createApp(App).use(router).mount('#app')
void registerServiceWorker()
// Installed apps get persistent storage more readily: ask again after installing.
setupInstall(() => void requestPersistence())
