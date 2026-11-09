package expo.modules.backgroundwork

/** Main-thread state shared by bridge calls and asynchronous service starts. */
internal class ProcessingSessions {
  var requestedId: String? = null
    private set
  private var completion: ((String) -> Unit)? = null

  fun request(id: String, callback: (String) -> Unit) {
    completion?.invoke("unavailable")
    requestedId = id
    completion = callback
  }

  fun accepts(id: String) = requestedId == id
  fun isPending(id: String) = accepts(id) && completion != null

  fun started(id: String) {
    if (!accepts(id)) return
    val callback = completion
    completion = null
    callback?.invoke("continued")
  }

  fun cancel(id: String) {
    if (!accepts(id)) return
    requestedId = null
    val callback = completion
    completion = null
    callback?.invoke("unavailable")
  }
}
