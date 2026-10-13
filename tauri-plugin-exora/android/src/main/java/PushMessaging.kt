package com.plugin.exora

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import app.tauri.annotation.InvokeArg
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import com.google.firebase.FirebaseApp
import com.google.firebase.installations.FirebaseInstallations
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import org.json.JSONArray
import org.json.JSONObject

@InvokeArg
class PushOptions { var enabled: Boolean = false; var walletAddress: String? = null }

/** Android owns only SDK delivery. Rust validates messages and chooses application actions. */
object PushMessaging {
    const val CHANNEL = "exora_remote_alerts"
    @Volatile var changed: (() -> Unit)? = null
    @Volatile var foreground = false
    private val generation = AtomicLong()
    private val mainHandler = Handler(Looper.getMainLooper())
    private val setupWorker = Executors.newSingleThreadExecutor { task ->
        Thread(task, "exora-push-setup")
    }
    private fun prefs(context: Context) = context.getSharedPreferences("exora_push", Context.MODE_PRIVATE)
    fun enabled(context: Context) = prefs(context).getBoolean("enabled", false)
    fun status(context: Context): JSObject {
        val app = FirebaseApp.getApps(context).firstOrNull()
        return JSObject().put("configured", app != null)
            .put("enabled", enabled(context))
            .put("projectId", app?.options?.projectId ?: JSONObject.NULL)
            .put("installationId", prefs(context).getString("installationId", null) ?: JSONObject.NULL)
    }
    fun channel(context: Context) {
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(CHANNEL, "EXORA market alerts", NotificationManager.IMPORTANCE_HIGH)
            channel.description = "Market notifications from your EXORA monitoring service"
            channel.lockscreenVisibility = android.app.Notification.VISIBILITY_PRIVATE
            context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
    }
    fun configure(context: Context, invoke: Invoke) {
        val options = invoke.parseArgs(PushOptions::class.java)
        val enable = options.enabled
        val wallet = options.walletAddress?.lowercase()
        if (enable && (wallet == null || !wallet.matches(Regex("0x[0-9a-f]{40}")))) { invoke.reject("Sign in before enabling notifications."); return }
        val request = generation.incrementAndGet()
        val completed = AtomicBoolean(false)
        val timeout = Runnable {
            if (completed.compareAndSet(false, true)) {
                generation.compareAndSet(request, request + 1)
                invoke.reject("Notification setup took too long. Check your connection and retry.")
            }
        }
        fun finish(error: String? = null) {
            if (!completed.compareAndSet(false, true)) return
            mainHandler.removeCallbacks(timeout)
            val result = if (error == null) status(context) else null
            mainHandler.post {
                if (error == null) invoke.resolve(result!!) else invoke.reject(error)
            }
        }
        fun current(): Boolean {
            if (generation.get() == request && !completed.get()) return true
            finish("Notification setup was canceled.")
            return false
        }
        mainHandler.postDelayed(timeout, 25_000)
        if (FirebaseApp.getApps(context).isEmpty()) {
            if (!enable) { prefs(context).edit().clear().apply(); finish(); return }
            finish("Push notifications are not configured in this build."); return
        }
        if (!enable) {
            // Stop showing messages immediately, even if remote unregistration needs a retry.
            prefs(context).edit().clear().apply()
            val manager = context.getSystemService(NotificationManager::class.java)
            for (notice in manager.activeNotifications) {
                if (Build.VERSION.SDK_INT < 26 || notice.notification.channelId == CHANNEL) manager.cancel(notice.tag, notice.id)
            }
        }
        if (enable && !NotificationManagerCompat.from(context).areNotificationsEnabled()) {
            finish("Allow notifications in Android settings before connecting this device."); return
        }
        // FCM 26's auto-init setter can synchronously fetch the FID. Every SDK call
        // and Task callback must stay off the UI thread, including after registration.
        val setupExecutor = Executor { task ->
            setupWorker.execute {
                if (!current()) return@execute
                try { task.run() } catch (_: Exception) {
                    finish(if (enable) "Could not set up notifications. Please retry."
                        else "Notifications are disabled here. Reconnect to finish unregistering this device.")
                }
            }
        }
        setupExecutor.execute setup@ {
            val messaging = FirebaseMessaging.getInstance()
            if (!enable) {
                messaging.isAutoInitEnabled = false
                messaging.unregister().addOnCompleteListener(setupExecutor) { task ->
                    if (task.isSuccessful) finish()
                    else finish("Notifications are disabled here. Reconnect to finish unregistering this device.")
                }
                return@setup
            }
            channel(context)
            messaging.register().addOnCompleteListener(setupExecutor) registration@ { registration ->
                if (!registration.isSuccessful) { finish("Could not register for notifications. Check your connection and retry."); return@registration }
                FirebaseInstallations.getInstance().id.addOnCompleteListener(setupExecutor) installation@ { task ->
                    if (!task.isSuccessful) { finish("Could not read this device's notification registration. Please retry."); return@installation }
                    messaging.isAutoInitEnabled = true
                    if (!current()) return@installation
                    prefs(context).edit().putBoolean("enabled", true).putString("walletAddress", wallet).putString("installationId", task.result).apply()
                    finish()
                }
            }
        }
    }
    fun registered(context: Context, id: String) {
        if (enabled(context)) prefs(context).edit().putString("installationId", id).apply()
    }
    @Synchronized fun enqueue(context: Context, event: JSONObject) {
        if (!enabled(context)) return
        val old = runCatching { JSONArray(prefs(context).getString("inbox", "[]")) }.getOrDefault(JSONArray())
        val next = JSONArray()
        for (i in maxOf(0, old.length() - 19) until old.length()) next.put(old.get(i))
        next.put(event)
        prefs(context).edit().putString("inbox", next.toString()).commit()
        changed?.invoke()
    }
    @Synchronized fun take(context: Context): JSObject {
        val inbox = runCatching { JSONArray(prefs(context).getString("inbox", "[]")) }.getOrDefault(JSONArray())
        prefs(context).edit().remove("inbox").commit()
        return JSObject().put("events", inbox)
    }
    @Synchronized fun verification(context: Context, data: Map<String, String>) {
        val claim = data["claimHash"] ?: return
        val challenge = data["challenge"] ?: return
        val registration = data["registrationId"] ?: return
        if (listOf(claim, challenge, registration).any { !it.matches(Regex("[a-fA-F0-9]{64}")) }) return
        prefs(context).edit().putString("verification", JSONObject().put("claimHash", claim)
            .put("challenge", challenge).put("registrationId", registration).toString()).commit()
    }
    @Synchronized fun takeVerification(context: Context): JSObject {
        val value = prefs(context).getString("verification", null)
        prefs(context).edit().remove("verification").commit()
        return JSObject().put("verification", value?.let { JSONObject(it) } ?: JSONObject.NULL)
    }
    fun intent(context: Context, intent: Intent?) {
        if (!enabled(context) || intent == null) return
        val messageId = intent.getStringExtra("google.message_id") ?: intent.getStringExtra("exora_message_id") ?: return
        val event = JSONObject().put("id", messageId.take(200)).put("tapped", true)
            .put("title", "EXORA notification").put("body", "Refresh your market data to see the latest update.")
            .put("screen", intent.getStringExtra("screen") ?: "alerts")
            .put("marketId", intent.getStringExtra("marketId") ?: JSONObject.NULL)
            .put("observedAt", intent.getStringExtra("observedAt") ?: JSONObject.NULL)
        intent.removeExtra("google.message_id"); intent.removeExtra("exora_message_id")
        enqueue(context, event)
    }
}

class ExoraMessagingService : FirebaseMessagingService() {
    override fun onRegistered(installationId: String) { PushMessaging.registered(this, installationId) }
    override fun onUnregistered(installationId: String) {
        if (!PushMessaging.enabled(this)) getSharedPreferences("exora_push", Context.MODE_PRIVATE).edit().remove("installationId").apply()
    }
    override fun onMessageReceived(message: RemoteMessage) {
        if (!PushMessaging.enabled(this)) return
        if (message.data["kind"] == "exora-enrollment") {
            val observed = message.data["observedAt"]?.toLongOrNull() ?: return
            val now = System.currentTimeMillis() / 1000
            if (observed <= now + 60 && now - observed <= 120) PushMessaging.verification(this, message.data)
            return
        }
        val accountAddress = message.data["accountAddress"]
        if (accountAddress != null && !accountAddress.equals(getSharedPreferences("exora_push", Context.MODE_PRIVATE).getString("walletAddress", null), ignoreCase = true)) return
        val id = message.data["alertId"]?.takeIf { it.isNotBlank() && it.length <= 100 } ?: message.messageId ?: return
        val observed = message.data["observedAt"]?.toLongOrNull() ?: (message.sentTime / 1000)
        val now = System.currentTimeMillis() / 1000
        if (observed > now + 60 || now - observed > 300) return
        val title = (message.data["title"] ?: message.notification?.title ?: "EXORA alert").take(100)
        val body = (message.data["body"] ?: message.notification?.body ?: "A market alert is ready. Open EXORA to refresh your data.").take(500)
        val event = JSONObject().put("id", id.take(200)).put("tapped", false).put("title", title).put("body", body)
            .put("screen", message.data["screen"] ?: "alerts").put("marketId", message.data["marketId"] ?: JSONObject.NULL)
            .put("observedAt", message.data["observedAt"] ?: (message.sentTime / 1000).toString())
        PushMessaging.enqueue(this, event)
        if (PushMessaging.foreground) return
        if (!NotificationManagerCompat.from(this).areNotificationsEnabled()) return
        PushMessaging.channel(this)
        val intent = packageManager.getLaunchIntentForPackage(packageName) ?: return
        intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        intent.putExtra("exora_message_id", id)
        for (key in listOf("screen", "marketId", "observedAt")) message.data[key]?.let { intent.putExtra(key, it) }
        val pending = PendingIntent.getActivity(this, id.hashCode(), intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, PushMessaging.CHANNEL)
            .setSmallIcon(R.drawable.ic_exora_notification).setContentTitle(title).setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(pending).setAutoCancel(true)
            .setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).setPriority(NotificationCompat.PRIORITY_HIGH).build()
        try { NotificationManagerCompat.from(this).notify(id.hashCode(), notification) } catch (_: SecurityException) { }
    }
}
