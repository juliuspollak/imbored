import UIKit
import Capacitor
import ObjectiveC.runtime

private enum KeyboardAccessoryHider {
    private static var installed = false

    static func install() {
        guard !installed else { return }

        let selector = NSSelectorFromString("inputAccessoryView")
        let classNames = [
            ["UI", "Web", "Browser", "View"].joined(),
            ["WK", "Content", "View"].joined()
        ]

        var replacedAtLeastOneImplementation = false

        for className in classNames {
            guard let viewClass: AnyClass = NSClassFromString(className),
                  let method = class_getInstanceMethod(viewClass, selector) else {
                continue
            }

            let nilAccessoryView: @convention(block) (AnyObject) -> UIView? = { _ in nil }
            let replacement = imp_implementationWithBlock(nilAccessoryView)
            method_setImplementation(method, replacement)
            replacedAtLeastOneImplementation = true
        }

        // WKContentView is created by WebKit. If it was not loaded yet, leave
        // installed=false so applicationDidBecomeActive can retry once the
        // Capacitor bridge has created its WKWebView.
        installed = replacedAtLeastOneImplementation
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Capacitor renders HTML form controls in WKWebView. Unlike native chat
        // apps, WKWebView adds a Previous/Next/Done accessory bar above the iOS
        // keyboard. Hide that WebKit accessory so chat uses the normal keyboard
        // height and our own composer remains the only control above it.
        DispatchQueue.main.async {
            KeyboardAccessoryHider.install()
        }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, and invalidate timers.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Retry after the Capacitor bridge has created its WKWebView.
        KeyboardAccessoryHider.install()
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Keep Capacitor App API URL-open handling intact.
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Keep Capacitor universal-link handling intact.
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
