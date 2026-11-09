package expo.modules.backgroundwork

import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class BackgroundWorkModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BackgroundWork")
    Events("onTick", "onExpired", "onModeChanged")

    OnCreate {
      ProcessingService.onEvent = { name, id -> sendEvent(name, mapOf("sessionId" to id)) }
    }
    OnDestroy {
      ProcessingService.onEvent = null
      ProcessingService.endAll()
    }

    AsyncFunction("beginAsync") { id: String, title: String, subtitle: String, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.resolve("unavailable")
      } else {
        ProcessingService.begin(context, id, title, subtitle) { promise.resolve(it) }
      }
    }
    AsyncFunction("updateAsync") { id: String, title: String, subtitle: String, progress: Double ->
      ProcessingService.update(id, title, subtitle, progress)
    }
    AsyncFunction("endAsync") { id: String, _success: Boolean ->
      ProcessingService.end(id)
    }
  }
}
