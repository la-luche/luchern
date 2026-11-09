package expo.modules.backgroundwork

import org.junit.Assert.*
import org.junit.Test

class ProcessingSessionsTest {
  @Test fun cancelledStartCannotBecomeAnOrphanSession() {
    val sessions = ProcessingSessions()
    val results = mutableListOf<String>()
    sessions.request("A") { results.add(it) }
    assertTrue(sessions.isPending("A"))
    assertTrue(results.isEmpty()) // startForegroundService alone isn't a grant
    sessions.cancel("A")
    assertFalse(sessions.accepts("A")) // late onStartCommand must not promote
    sessions.started("A")
    assertEquals(listOf("unavailable"), results)
  }

  @Test fun staleStartAndEndCannotAffectANewerRequest() {
    val sessions = ProcessingSessions()
    val first = mutableListOf<String>()
    val second = mutableListOf<String>()
    sessions.request("A") { first.add(it) }
    sessions.request("B") { second.add(it) }
    sessions.cancel("A")
    sessions.started("A")
    assertFalse(sessions.accepts("A"))
    assertTrue(sessions.accepts("B"))
    assertTrue(second.isEmpty())
    sessions.started("B")
    assertEquals(listOf("unavailable"), first)
    assertEquals(listOf("continued"), second)
  }

  @Test fun promotionResolvesOnlyOnceAndLeaseRemainsUntilEnded() {
    val sessions = ProcessingSessions()
    val results = mutableListOf<String>()
    sessions.request("A") { results.add(it) }
    sessions.started("A")
    sessions.started("A")
    assertTrue(sessions.accepts("A"))
    assertFalse(sessions.isPending("A"))
    sessions.cancel("A")
    assertNull(sessions.requestedId)
    assertEquals(listOf("continued"), results)
  }
}
