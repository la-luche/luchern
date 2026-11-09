package expo.modules.backgroundwork

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/** Keeps the existing RN/native pipeline alive when its activity is hidden. */
class ProcessingService : Service() {
  companion object {
    private const val CHANNEL = "luche-processing"
    private const val NOTIFICATION = 7401
    private val handler = Handler(Looper.getMainLooper())
    @Volatile var onEvent: ((String, String) -> Unit)? = null
    private var instance: ProcessingService? = null
    private val sessions = ProcessingSessions()

    fun begin(context: Context, id: String, title: String, subtitle: String, complete: (String) -> Unit) = handler.post {
      // Record intent before dispatch: end(id) may arrive before onStartCommand.
      sessions.request(id, complete)
      val intent = Intent(context, ProcessingService::class.java)
        .putExtra("sessionId", id).putExtra("title", title).putExtra("subtitle", subtitle)
      try {
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent)
        else context.startService(intent)
        handler.postDelayed({
          if (sessions.isPending(id)) {
            sessions.cancel(id)
            instance?.stopSelf()
          }
        }, 10_000)
      } catch (_: RuntimeException) {
        sessions.cancel(id)
        instance?.stopSelf()
      }
    }

    fun update(id: String, title: String, subtitle: String, progress: Double) = handler.post {
      instance?.takeIf { it.sessionId == id }?.let { service ->
        service.manager.notify(NOTIFICATION, service.notification(title, subtitle, progress))
      }
    }
    fun end(id: String) = handler.post {
      sessions.cancel(id)
      if (sessions.requestedId == null) instance?.stopSelf()
    }
    fun endAll() = handler.post {
      sessions.requestedId?.let { sessions.cancel(it) }
      instance?.stopSelf()
    }
  }

  private var sessionId: String? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private lateinit var manager: NotificationManager
  private val tick = object : Runnable {
    override fun run() {
      sessionId?.let { onEvent?.invoke("onTick", it) }
      handler.postDelayed(this, 1_000)
    }
  }

  override fun onCreate() {
    super.onCreate()
    instance = this
    manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Luche processing", NotificationManager.IMPORTANCE_LOW).apply {
        setShowBadge(false)
      })
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val id = intent?.getStringExtra("sessionId")
    if (id == null || !sessions.accepts(id)) {
      // A stale start must neither acquire a wake lock nor stop a newer session.
      if (sessions.requestedId == null) stopSelfResult(startId)
      return START_NOT_STICKY
    }
    sessionId = id
    val notification = notification(intent.getStringExtra("title") ?: "Luche", intent.getStringExtra("subtitle") ?: "", 0.0)
    try {
      if (Build.VERSION.SDK_INT >= 35) {
        startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROCESSING or ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else if (Build.VERSION.SDK_INT >= 29) {
        startForeground(NOTIFICATION, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
      } else startForeground(NOTIFICATION, notification)
      if (wakeLock?.isHeld != true) {
        wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Luche:processing").apply {
          // Bounded defensively; normal completion releases this immediately.
          acquire(6 * 60 * 60 * 1_000L)
        }
      }
      handler.removeCallbacks(tick)
      handler.post(tick)
      sessions.started(id)
    } catch (_: RuntimeException) {
      sessions.cancel(id)
      stopSelfResult(startId)
    }
    // Force-stop/task removal must not resurrect a user's cancelled work.
    return START_NOT_STICKY
  }

  private fun notification(title: String, subtitle: String, fraction: Double): Notification {
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val pending = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE) }
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    return builder.setSmallIcon(android.R.drawable.stat_sys_upload)
      .setContentTitle(title).setContentText(subtitle).setContentIntent(pending)
      .setOngoing(true).setOnlyAlertOnce(true).setShowWhen(false)
      .setVisibility(Notification.VISIBILITY_PRIVATE)
      .setProgress(1000, (fraction.coerceIn(0.0, 0.99) * 1000).toInt(), false).build()
  }

  override fun onTimeout(startId: Int, fgsType: Int) {
    sessionId?.let { sessions.cancel(it); onEvent?.invoke("onExpired", it) }
    stopSelf()
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    if (wakeLock?.isHeld == true) wakeLock?.release()
    wakeLock = null
    if (instance === this) instance = null
    sessionId?.let {
      if (sessions.accepts(it)) {
        sessions.cancel(it)
        onEvent?.invoke("onExpired", it)
      }
    }
    sessionId = null
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  override fun onBind(intent: Intent?): IBinder? = null
}
