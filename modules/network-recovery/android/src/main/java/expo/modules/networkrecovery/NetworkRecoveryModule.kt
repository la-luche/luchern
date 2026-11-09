package expo.modules.networkrecovery

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NetworkRecoveryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NetworkRecovery")
    AsyncFunction("activate") { hostname: String -> NetworkRecovery.dns.activate(hostname) }
  }
}
