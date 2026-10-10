import { createRouter, createWebHistory } from 'vue-router'
import WorkspaceLayout from './layouts/WorkspaceLayout.vue'
import { lastWorkspaceId, openLocalStore, refreshWorkspaces, workspaces } from './local/context'
import { connection, loadCurrentUser } from './session'
import AccountView from './views/AccountView.vue'
import ConflictsView from './views/ConflictsView.vue'
import ExportView from './views/ExportView.vue'
import HistoryView from './views/HistoryView.vue'
import HomeView from './views/HomeView.vue'
import LoginView from './views/LoginView.vue'
import MembersView from './views/MembersView.vue'
import PageView from './views/PageView.vue'
import RejectedView from './views/RejectedView.vue'
import SharedPageView from './views/SharedPageView.vue'
import TagView from './views/TagView.vue'
import TrashView from './views/TrashView.vue'
import WorkspaceHome from './views/WorkspaceHome.vue'

// Views are bundled eagerly: lazy chunks could not be fetched after losing the network.

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView, meta: { requiresAuth: true } },
    { path: '/login', name: 'login', component: LoginView },
    // Read links for guests (ADR 0022): no session, no local database.
    { path: '/share/:token', name: 'shared', component: SharedPageView, meta: { guest: true } },
    { path: '/account', name: 'account', component: AccountView, meta: { requiresAuth: true } },
    {
      path: '/w/:workspaceId',
      component: WorkspaceLayout,
      meta: { requiresAuth: true },
      children: [
        { path: '', name: 'workspace', component: WorkspaceHome },
        { path: 'p/:documentId', name: 'page', component: PageView },
        { path: 'p/:documentId/history', name: 'history', component: HistoryView },
        { path: 'tags/:tagId', name: 'tag', component: TagView },
        { path: 'conflicts', name: 'conflicts', component: ConflictsView },
        { path: 'trash', name: 'trash', component: TrashView },
        { path: 'export', name: 'export', component: ExportView },
        { path: 'members', name: 'members', component: MembersView },
        { path: 'rejected', name: 'rejected', component: RejectedView },
      ],
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

router.beforeEach(async (to) => {
  if (to.meta.guest) return true
  let user
  try {
    user = await loadCurrentUser()
  } catch {
    // Server unreachable and nobody signed in on this device before: only login is possible.
    return to.name === 'login' ? true : { name: 'login' }
  }
  // With an expired session the login page stays reachable to sign in again.
  if (to.name === 'login') return user && connection.value !== 'expired' ? { name: 'home' } : true
  if (!to.meta.requiresAuth) return true
  if (!user) return { name: 'login' }

  const store = await openLocalStore(user.id)
  if (to.name === 'home' && to.query.choose === undefined) {
    if (workspaces.value.length === 0) await refreshWorkspaces(store)
    const last = lastWorkspaceId()
    const target = workspaces.value.find((w) => w.id === last) ?? workspaces.value[0]
    if (target) return { name: 'workspace', params: { workspaceId: target.id } }
  }
  return true
})
