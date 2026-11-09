import Foundation
import Network

/// Changes the app's privacy context only. No NetworkExtension, DNS profile,
/// system preferences, URL rewriting, or TLS trust override is involved.
@MainActor
final class DNSRecovery {
  static let shared = DNSRecovery()
  static let allowedHosts: Set<String> = ["luche.ai", "go.luche.ai", "doctor.luche.ai"]
  private let duration: TimeInterval
  private let clock: () -> Date
  private let probe: (String) async -> Bool
  private let configure: (Bool) -> Void
  private var activeUntil: Date = .distantPast
  private var nextProbeAt: Date = .distantPast
  private var pending: Task<Bool, Never>?
  private var expiry: Task<Void, Never>?

  init(
    duration: TimeInterval = 300,
    clock: @escaping () -> Date = Date.init,
    probe: @escaping (String) async -> Bool = DNSRecovery.googleIsReachable,
    configure: @escaping (Bool) -> Void = DNSRecovery.configureContext
  ) {
    self.duration = duration
    self.clock = clock
    self.probe = probe
    self.configure = configure
  }

  func activate(hostname: String) async -> Bool {
    guard Self.allowedHosts.contains(hostname.lowercased()) else { return false }
    expireIfNeeded()
    guard activeUntil <= clock() else { return false }
    if let pending { return await pending.value }
    guard nextProbeAt <= clock() else { return false }

    // Don't switch an app that can still make small requests to a resolver
    // that this network cannot reach. Coalesce failures into one bounded probe.
    nextProbeAt = clock().addingTimeInterval(30)
    let task = Task { await probe(hostname) }
    pending = task
    let reachable = await task.value
    pending = nil
    guard reachable, activeUntil <= clock() else { return false }
    configure(true)
    activeUntil = clock().addingTimeInterval(duration)
    expiry?.cancel()
    let expiryDelay = UInt64(duration * 1_000_000_000)
    expiry = Task { [weak self] in
      try? await Task.sleep(nanoseconds: expiryDelay)
      guard !Task.isCancelled else { return }
      self?.expireIfNeeded()
    }
    return true
  }

  func expireIfNeeded() {
    if activeUntil != .distantPast && activeUntil <= clock() {
      configure(false)
      activeUntil = .distantPast
    }
  }

  nonisolated static func configureContext(_ enabled: Bool) {
    let resolver: NWParameters.PrivacyContext.ResolverConfiguration? = enabled
      ? .https(URL(string: "https://dns.google/dns-query")!, serverAddresses: [
          .hostPort(host: "8.8.8.8", port: 443),
          .hostPort(host: "8.8.4.4", port: 443),
          .hostPort(host: "2001:4860:4860::8888", port: 443),
          .hostPort(host: "2001:4860:4860::8844", port: 443)
        ])
      : nil
    // A preferred encrypted DNS configuration supplied by iOS/the user still
    // takes precedence. This API cannot promise to override such a profile.
    NWParameters.PrivacyContext.default.requireEncryptedNameResolution(
      enabled, fallbackResolver: resolver
    )
  }

  nonisolated static func googleIsReachable(_ hostname: String) async -> Bool {
    var components = URLComponents(string: "https://dns.google/resolve")!
    components.queryItems = [URLQueryItem(name: "name", value: hostname),
                            URLQueryItem(name: "type", value: "A")]
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 4
    config.timeoutIntervalForResource = 4
    config.httpShouldSetCookies = false
    config.httpCookieStorage = nil
    config.urlCache = nil
    let session = URLSession(configuration: config)
    defer { session.invalidateAndCancel() }
    do {
      let (data, response) = try await session.data(from: components.url!)
      guard (response as? HTTPURLResponse)?.statusCode == 200,
            data.count < 65_536,
            let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            json["Status"] as? Int == 0,
            let answers = json["Answer"] as? [[String: Any]] else { return false }
      return answers.contains { answer in
        answer["type"] as? Int == 1 &&
          (answer["data"] as? String).flatMap { IPv4Address($0) } != nil
      }
    } catch {
      return false
    }
  }
}
