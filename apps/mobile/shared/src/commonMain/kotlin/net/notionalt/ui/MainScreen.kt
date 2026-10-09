package net.notionalt.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import kotlinx.serialization.Serializable
import net.notionalt.core.UserContext

@Serializable
data object HomeRoute

@Serializable
data class PageRoute(val workspaceId: String, val documentId: String)

@Serializable
data class ConflictsRoute(val workspaceId: String)

@Serializable
data class SearchRoute(val workspaceId: String)

@Composable
fun MainScreen(controller: AppController, context: UserContext) {
    val nav = rememberNavController()
    // Sync when the app comes to the foreground (and on start); push is only a hint.
    LifecycleResumeEffect(context) {
        controller.requestSync()
        onPauseOrDispose { }
    }
    NavHost(navController = nav, startDestination = HomeRoute) {
        composable<HomeRoute> {
            HomeScreen(
                controller = controller,
                context = context,
                openPage = { workspaceId, id -> nav.navigate(PageRoute(workspaceId, id)) },
                openConflicts = { workspaceId -> nav.navigate(ConflictsRoute(workspaceId)) },
                openSearch = { workspaceId -> nav.navigate(SearchRoute(workspaceId)) },
            )
        }
        composable<SearchRoute> { entry ->
            val route = entry.toRoute<SearchRoute>()
            SearchScreen(
                context = context,
                workspaceId = route.workspaceId,
                openPage = { id -> nav.navigate(PageRoute(route.workspaceId, id)) },
                back = { nav.popBackStack() },
            )
        }
        composable<PageRoute> { entry ->
            val route = entry.toRoute<PageRoute>()
            PageScreen(
                controller = controller,
                context = context,
                workspaceId = route.workspaceId,
                documentId = route.documentId,
                openPage = { id -> nav.navigate(PageRoute(route.workspaceId, id)) },
                openConflicts = { nav.navigate(ConflictsRoute(route.workspaceId)) },
                back = { nav.popBackStack() },
            )
        }
        composable<ConflictsRoute> { entry ->
            val route = entry.toRoute<ConflictsRoute>()
            ConflictsScreen(
                context = context,
                workspaceId = route.workspaceId,
                openPage = { id -> nav.navigate(PageRoute(route.workspaceId, id)) },
                back = { nav.popBackStack() },
            )
        }
    }
}
