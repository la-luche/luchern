import ExpoModulesCore

public final class NetworkRecoveryModule: Module {
  public func definition() -> ModuleDefinition {
    Name("NetworkRecovery")

    AsyncFunction("activate") { (hostname: String) async -> Bool in
      await DNSRecovery.shared.activate(hostname: hostname)
    }
  }
}
