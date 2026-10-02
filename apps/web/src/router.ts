import { createRouter, createWebHistory } from 'vue-router'
import { loadCurrentUser } from './session'
import HomeView from './views/HomeView.vue'
import LoginView from './views/LoginView.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { requiresAuth: true } },
    { path: '/login', name: 'login', component: LoginView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  const user = await loadCurrentUser()
  if (to.meta.requiresAuth && !user) return { name: 'login' }
  if (to.name === 'login' && user) return { name: 'home' }
  return true
})
