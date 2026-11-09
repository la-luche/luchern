import Foundation

@main
struct DNSRecoveryChecks {
  @MainActor static func main() async {
    var now = Date(timeIntervalSince1970: 1_000)
    var probes = 0
    var configurations: [Bool] = []
    let recovery = DNSRecovery(clock: { now }, probe: { _ in probes += 1; return true },
                               configure: { configurations.append($0) })
    precondition(configurations.isEmpty, "Normal networking must not be configured at startup")
    let rejected = await recovery.activate(hostname: "luche.ai.example")
    precondition(!rejected && probes == 0)
    let activated = await recovery.activate(hostname: "luche.ai")
    precondition(activated && configurations == [true] && probes == 1)
    let repeated = await recovery.activate(hostname: "luche.ai")
    precondition(!repeated && probes == 1, "An active window must not repeat the probe")
    now = now.addingTimeInterval(301)
    recovery.expireIfNeeded()
    precondition(configurations == [true, false], "Normal DNS must be restored after the window")

    var failedProbes = 0
    let unavailable = DNSRecovery(clock: { now }, probe: { _ in failedProbes += 1; return false },
                                  configure: { _ in preconditionFailure("Unreachable resolver must not be enabled") })
    let blocked = await unavailable.activate(hostname: "luche.ai")
    let repeatedBlocked = await unavailable.activate(hostname: "luche.ai")
    precondition(!blocked && !repeatedBlocked && failedProbes == 1, "Failure storms must be bounded")
    now = now.addingTimeInterval(31)
    _ = await unavailable.activate(hostname: "luche.ai")
    precondition(failedProbes == 2)

    let transport = NSError(domain: NSURLErrorDomain, code: NSURLErrorNetworkConnectionLost)
    let wrapped = NSError(domain: "AVFoundationErrorDomain", code: -11800,
                          userInfo: [NSUnderlyingErrorKey: transport])
    precondition(luchePlaybackErrorDescription(wrapped)!.contains("Network connection failed"))
    for code in [NSURLErrorCancelled, NSURLErrorBadServerResponse, NSURLErrorServerCertificateUntrusted] {
      let other = NSError(domain: NSURLErrorDomain, code: code)
      precondition(luchePlaybackErrorDescription(other) == other.localizedDescription)
    }
    print("PASS: normal-first, host restriction, activation, expiry, unavailable-resolver cooldown, wrapped video transport errors, certificate/HTTP/cancel exclusions")
    if CommandLine.arguments.contains("--probe") {
      let reachable = await DNSRecovery.googleIsReachable("luche.ai")
      print("Google DNS HTTPS probe reachable: \(reachable)")
      precondition(reachable, "Live DoH control failed")
    }
  }
}
