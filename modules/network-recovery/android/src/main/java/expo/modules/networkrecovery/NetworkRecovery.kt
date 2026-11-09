package expo.modules.networkrecovery

import android.content.Context
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.IOException
import java.io.EOFException
import java.net.InetAddress
import java.net.SocketException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import okhttp3.Call
import okhttp3.ConnectionPool
import okhttp3.Dns
import okhttp3.EventListener
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.dnsoverhttps.DnsOverHttps

object NetworkRecovery {
  private val pool = ConnectionPool()
  private val alternate: Dns by lazy {
    DnsOverHttps.Builder()
      .client(OkHttpClient.Builder()
        .callTimeout(4, TimeUnit.SECONDS)
        .connectTimeout(3, TimeUnit.SECONDS)
        .retryOnConnectionFailure(false)
        .build())
      .url("https://dns.google/dns-query".toHttpUrl())
      .bootstrapDnsHosts(
        InetAddress.getByName("8.8.8.8"), InetAddress.getByName("8.8.4.4"),
        InetAddress.getByName("2001:4860:4860::8888"),
        InetAddress.getByName("2001:4860:4860::8844")
      )
      .includeIPv6(true)
      .build()
  }
  internal val dns = RecoveryDns(Dns.SYSTEM, object : Dns {
    override fun lookup(hostname: String): List<InetAddress> = alternate.lookup(hostname)
  }, changed = {
    // Discard idle connections to the address that just failed. In-flight
    // operations are not replayed, and TLS still authenticates the URL host.
    pool.evictAll()
  })
  private val failures = object : EventListener() {
    override fun callFailed(call: Call, ioe: IOException) {
      if (!call.isCanceled() && call.request().url.isHttps && isTransportFailure(ioe)) {
        dns.activate(call.request().url.host)
      }
    }
  }

  @JvmStatic fun install(context: Context) {
    // Called from MainApplication before React Native initializes networking.
    OkHttpClientProvider.setOkHttpClientFactory(OkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder(context)
        .dns(dns)
        .connectionPool(pool)
        .eventListener(failures)
        .build()
    })
  }

  internal fun isTransportFailure(error: IOException): Boolean =
    error is UnknownHostException || error is SocketException ||
      error is SocketTimeoutException || error is EOFException
}
