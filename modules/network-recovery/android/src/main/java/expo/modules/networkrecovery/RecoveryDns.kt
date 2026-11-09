package expo.modules.networkrecovery

import java.net.InetAddress
import java.net.UnknownHostException
import okhttp3.Dns

/** System DNS until a failed request activates a bounded recovery window. */
internal class RecoveryDns(
  private val system: Dns,
  private val alternate: Dns,
  private val clock: () -> Long = { System.nanoTime() / 1_000_000 },
  private val durationMs: Long = 300_000,
  private val changed: () -> Unit = {}
) : Dns {
  @Volatile private var activeUntil = Long.MIN_VALUE

  @Synchronized fun activate(hostname: String): Boolean {
    if (!accepts(hostname) || clock() < activeUntil) return false
    activeUntil = clock() + durationMs
    changed()
    return true
  }

  override fun lookup(hostname: String): List<InetAddress> {
    if (accepts(hostname) && clock() < activeUntil) {
      try {
        return alternate.lookup(hostname).also {
          if (it.isEmpty()) throw UnknownHostException("Empty resolver response")
        }
      } catch (_: UnknownHostException) {
        // A network may block Google. Keep the original resolver usable.
      }
    }
    return system.lookup(hostname)
  }

  companion object {
    fun accepts(hostname: String): Boolean = hostname.lowercase() in
      setOf("luche.ai", "go.luche.ai", "doctor.luche.ai")
  }
}
