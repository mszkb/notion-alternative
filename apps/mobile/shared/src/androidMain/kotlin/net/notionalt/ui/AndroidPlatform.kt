package net.notionalt.ui

import android.content.Context
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import app.cash.sqldelight.driver.android.AndroidSqliteDriver
import io.ktor.client.HttpClient
import net.notionalt.core.DriverFactory
import java.util.concurrent.TimeUnit

class AndroidPlatform(private val context: Context) : Platform {
    override val deviceName: String = "Android-App auf ${Build.MANUFACTURER} ${Build.MODEL}".take(100)

    override val drivers = DriverFactory { name, schema -> AndroidSqliteDriver(schema, context, name) }

    override fun httpClient(): HttpClient = platformHttpClient()

    override val backgroundSync: BackgroundSync = object : BackgroundSync {
        override fun schedule() {
            runCatching { enqueue() }
        }

        override fun cancel() {
            runCatching { WorkManager.getInstance(context).cancelUniqueWork(SYNC_WORK) }
        }

        private fun enqueue() {
            val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(SYNC_WORK, ExistingPeriodicWorkPolicy.KEEP, request)
        }
    }

    override val push: PushRegistrar = NoopPushRegistrar

    companion object {
        private const val SYNC_WORK = "notion-alt-sync"
    }
}

/** One controller per process, shared by the activity and the background worker. */
object AppGraph {
    @Volatile
    private var instance: AppController? = null

    fun controller(context: Context): AppController =
        instance ?: synchronized(this) {
            instance ?: AppController(AndroidPlatform(context.applicationContext)).also { instance = it }
        }
}

/** Periodic sync in the background (#156); data integrity never depends on it (principle 4). */
class SyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        AppGraph.controller(applicationContext).syncNow()
        return Result.success()
    }
}
