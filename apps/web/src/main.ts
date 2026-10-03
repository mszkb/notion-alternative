import { createApp } from 'vue'
import App from './App.vue'
import { registerServiceWorker } from './pwa'
import { router } from './router'
import './styles.css'

createApp(App).use(router).mount('#app')
void registerServiceWorker()
