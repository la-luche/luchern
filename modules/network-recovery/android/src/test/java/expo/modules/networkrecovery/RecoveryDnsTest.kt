package expo.modules.networkrecovery

import java.net.InetAddress
import java.net.UnknownHostException
import java.net.SocketTimeoutException
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import org.junit.Assert.*
import org.junit.Test

class RecoveryDnsTest {
  private fun resolver(block: (String) -> List<InetAddress>): Dns = object : Dns {
    override fun lookup(hostname: String): List<InetAddress> = block(hostname)
  }

  private val ordinary = InetAddress.getByName("192.0.2.1")
  private val recovered = InetAddress.getByName("127.0.0.1")

  @Test fun normalFirstThenFallbackThenExpiry() {
    var now = 0L
    var alternateCalls = 0
    var evictions = 0
    val dns = RecoveryDns(resolver { listOf(ordinary) }, resolver {
      alternateCalls++
      listOf(recovered)
    }, clock = { now }, changed = { evictions++ })
    assertEquals(listOf(ordinary), dns.lookup("luche.ai"))
    assertEquals(0, alternateCalls)
    assertFalse(dns.activate("luche.ai.attacker.example"))
    assertTrue(dns.activate("luche.ai"))
    assertFalse(dns.activate("luche.ai"))
    assertEquals(1, evictions)
    assertEquals(listOf(recovered), dns.lookup("luche.ai"))
    assertEquals(listOf(ordinary), dns.lookup("unrelated.example"))
    now = 300_001
    assertEquals(listOf(ordinary), dns.lookup("luche.ai"))
  }

  @Test fun unavailableAlternateLeavesSystemResolverUsable() {
    val dns = RecoveryDns(resolver { listOf(ordinary) }, resolver { throw UnknownHostException("blocked") })
    dns.activate("luche.ai")
    assertEquals(listOf(ordinary), dns.lookup("luche.ai"))
  }

  @Test fun certificateFailuresDoNotActivateRecovery() {
    assertFalse(NetworkRecovery.isTransportFailure(SSLHandshakeException("untrusted")))
    assertFalse(NetworkRecovery.isTransportFailure(SSLPeerUnverifiedException("wrong hostname")))
    assertTrue(NetworkRecovery.isTransportFailure(SocketTimeoutException("timeout")))
  }

  @Test fun alternateAddressPreservesHttpsHostAndCertificateValidation() {
    val certificate = HeldCertificate.Builder().addSubjectAlternativeName("luche.ai").build()
    val serverCerts = HandshakeCertificates.Builder().heldCertificate(certificate).build()
    val trusted = HandshakeCertificates.Builder().addTrustedCertificate(certificate.certificate).build()
    val server = MockWebServer()
    server.useHttps(serverCerts.sslSocketFactory(), false)
    server.start()
    val dns = RecoveryDns(resolver { throw UnknownHostException("normal DNS failed") }, resolver { listOf(recovered) })
    val client = OkHttpClient.Builder().dns(dns)
      .sslSocketFactory(trusted.sslSocketFactory(), trusted.trustManager).build()
    try {
      val url = server.url("/api/health").newBuilder().host("luche.ai").build()
      try {
        client.newCall(Request.Builder().url(url).build()).execute().close()
        fail("The normal resolver should be tried first")
      } catch (_: UnknownHostException) { }
      dns.activate("luche.ai")
      server.enqueue(MockResponse().setBody("ok"))
      client.newCall(Request.Builder().url(url).build()).execute().use {
        assertEquals(200, it.code)
        assertEquals("ok", it.body!!.string())
      }
      val request = server.takeRequest()
      assertEquals("luche.ai:${server.port}", request.getHeader(":authority") ?: request.getHeader("Host"))
      // The same IP and trusted certificate cannot authenticate another name.
      dns.activate("doctor.luche.ai")
      try {
        client.newCall(Request.Builder().url(url.newBuilder().host("doctor.luche.ai").build()).build())
          .execute().close()
        fail("Hostname verification must remain enabled")
      } catch (_: SSLPeerUnverifiedException) { }
    } finally {
      client.connectionPool.evictAll()
      client.dispatcher.executorService.shutdown()
      server.shutdown()
    }
  }
}
