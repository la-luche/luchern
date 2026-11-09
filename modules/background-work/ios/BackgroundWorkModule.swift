import BackgroundTasks
import ExpoModulesCore
import UIKit

/// A lease for the *whole* user-initiated pipeline, not just one native export.
/// All mutable state is confined to the main queue.
public final class BackgroundWorkModule: Module {
  private var sessionID: String?
  private var requestID: String?
  private var continuedTask: BGTask?
  private var fallbackTask: UIBackgroundTaskIdentifier = .invalid
  private var timer: Timer?
  private var pending: Promise?
  private var mode = "unavailable"

  public func definition() -> ModuleDefinition {
    Name("BackgroundWork")
    Events("onTick", "onExpired", "onModeChanged")

    AsyncFunction("beginAsync") { (id: String, title: String, subtitle: String, promise: Promise) in
      self.begin(id: id, title: title, subtitle: subtitle, promise: promise)
    }.runOnQueue(.main)

    AsyncFunction("updateAsync") { (id: String, title: String, subtitle: String, fraction: Double) in
      guard id == self.sessionID else { return }
      if #available(iOS 26.0, *), let task = self.continuedTask as? BGContinuedProcessingTask {
        task.progress.completedUnitCount = Int64(min(0.99, max(0, fraction)) * 10_000)
        task.updateTitle(title, subtitle: subtitle)
      }
    }.runOnQueue(.main)

    AsyncFunction("endAsync") { (id: String, success: Bool) in
      guard id == self.sessionID else { return }
      self.finish(success: success)
    }.runOnQueue(.main)

    OnDestroy {
      DispatchQueue.main.async { self.finish(success: false) }
    }
  }

  private func begin(id: String, title: String, subtitle: String, promise: Promise) {
    if sessionID == id { promise.resolve(mode); return }
    finish(success: false)
    // Never try to create a continued task from a background retry.
    guard UIApplication.shared.applicationState != .background else {
      promise.resolve("unavailable")
      return
    }
    sessionID = id
    pending = promise
    startTimer(id: id)
    // Also bridges the brief interval between submission and the launch handler.
    fallbackTask = UIApplication.shared.beginBackgroundTask(withName: "Luche processing") { [weak self] in
      self?.expire(id: id)
    }
    mode = fallbackTask == .invalid ? "unavailable" : "limited"

    if #available(iOS 26.0, *) {
      let identifier = "\(Bundle.main.bundleIdentifier!).processing.\(UUID().uuidString)"
      requestID = identifier
      let scheduler = BGTaskScheduler.shared
      let registered = scheduler.register(forTaskWithIdentifier: identifier, using: .main) { [weak self] task in
        guard let self, self.sessionID == id,
              let task = task as? BGContinuedProcessingTask else {
          task.setTaskCompleted(success: false)
          return
        }
        self.continuedTask = task
        task.progress.totalUnitCount = 10_000
        task.expirationHandler = { [weak self] in
          DispatchQueue.main.async { self?.expire(id: id) }
        }
        self.endFallback()
        self.mode = "continued"
        self.sendEvent("onModeChanged", ["sessionId": id, "mode": self.mode])
        self.pending?.resolve(self.mode)
        self.pending = nil
      }
      if registered {
        let request = BGContinuedProcessingTaskRequest(identifier: identifier, title: title, subtitle: subtitle)
        // The model and software Core Image renderer use CPU, so this works on
        // devices without Apple's background-GPU entitlement/support as well.
        request.strategy = .fail
        do {
          try scheduler.submit(request)
          // Defend against a successful submission that never calls back.
          DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self, self.sessionID == id, self.pending != nil else { return }
            self.pending?.resolve(self.mode)
            self.pending = nil
          }
          return
        } catch {
          scheduler.cancel(taskRequestWithIdentifier: identifier)
        }
      }
    }
    pending?.resolve(mode)
    pending = nil
  }

  private func startTimer(id: String) {
    // RN's JS timers may stop in the background even while iOS grants CPU time.
    let timer = Timer(timeInterval: 1, repeats: true) { [weak self] _ in
      guard let self, self.sessionID == id else { return }
      self.sendEvent("onTick", ["sessionId": id])
    }
    self.timer = timer
    RunLoop.main.add(timer, forMode: .common)
  }

  private func expire(id: String) {
    guard sessionID == id else { return }
    // Stop native model/export work synchronously, even if JS cannot receive
    // its cancellation event before the OS suspends the process.
    NotificationCenter.default.post(name: Notification.Name("LucheProcessingExpired"), object: nil)
    sendEvent("onExpired", ["sessionId": id])
    finish(success: false)
  }

  private func endFallback() {
    if fallbackTask != .invalid {
      UIApplication.shared.endBackgroundTask(fallbackTask)
      fallbackTask = .invalid
    }
  }

  private func finish(success: Bool) {
    pending?.resolve("unavailable")
    pending = nil
    timer?.invalidate()
    timer = nil
    if let task = continuedTask {
      if #available(iOS 26.0, *), success, let task = task as? BGContinuedProcessingTask {
        task.progress.completedUnitCount = task.progress.totalUnitCount
      }
      task.setTaskCompleted(success: success)
    }
    continuedTask = nil
    if let requestID { BGTaskScheduler.shared.cancel(taskRequestWithIdentifier: requestID) }
    requestID = nil
    endFallback()
    sessionID = nil
    mode = "unavailable"
  }
}
