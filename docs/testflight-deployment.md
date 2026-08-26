# TestFlight deployment

The **Deploy to TestFlight** GitHub Actions workflow is deliberately manual. It checks out `main`, tests and builds the web app, syncs Capacitor, archives and signs the iOS app, uploads it to TestFlight, and optionally distributes it to an existing external group.

CI runs on GitHub's `macos-26` image and explicitly selects the newest installed stable Xcode 26 release. Before installing dependencies, it prints and validates both the Xcode version and iPhoneOS SDK version. The app is built with SDK 26 or later while its minimum supported deployment target remains iOS 15.0.

Ruby 3.1.7 and the locked Bundler environment are configured before Capacitor sync. This interpreter satisfies the locked CFPropertyList 3.0.9 requirement for Ruby below 3.2. CI places a temporary CocoaPods binstub at the front of `PATH`, ensuring Capacitor's internal `pod install` uses the repository's bundled CocoaPods rather than the runner's Homebrew installation. The workflow prints safe Ruby, Bundler, Fastlane, and CocoaPods executable/version diagnostics before syncing.

## One-time Apple setup

1. In App Store Connect, open **Users and Access → Integrations → App Store Connect API** and create a team API key with the **App Manager** role. Download its `.p8` file immediately; Apple only permits one download. Record the Key ID and Issuer ID.
2. In the Apple Developer portal, confirm the explicit App ID `au.imbored.app` has Push Notifications enabled.
3. Create an **Apple Distribution** certificate. Export the certificate together with its private key from Keychain Access as a password-protected `.p12`.
4. Create an **App Store Connect** distribution provisioning profile for `au.imbored.app` using that certificate. Download the `.mobileprovision`. It must contain the production `aps-environment` entitlement. The workflow validates both the App ID and that entitlement before archiving.
5. Confirm the existing external TestFlight group name (for example, `Family Testers`) and complete the app's Test Information, export-compliance, and Beta App Review contact fields in App Store Connect.

Automatic signing remains enabled for local Xcode use. On the disposable CI checkout, Fastlane changes only the `App` target's Release configuration to manual signing. CocoaPods and Capacitor framework targets do not receive an app provisioning profile. No signing setting or build number is committed back to the repository.

## GitHub secrets

Add these at **GitHub repository → Settings → Secrets and variables → Actions → New repository secret**. For stronger release controls, create a `testflight` environment, put the secrets there, and optionally require an approver. The workflow already targets that environment.

| Secret | Value |
| --- | --- |
| `APP_STORE_CONNECT_API_KEY_ID` | App Store Connect API Key ID |
| `APP_STORE_CONNECT_ISSUER_ID` | App Store Connect API Issuer ID |
| `APP_STORE_CONNECT_API_KEY_BASE64` | Base64 of the downloaded `.p8` file |
| `APPLE_TEAM_ID` | 10-character Apple Developer Team ID |
| `IOS_DISTRIBUTION_CERTIFICATE_BASE64` | Base64 of the exported `.p12` |
| `IOS_DISTRIBUTION_CERTIFICATE_PASSWORD` | Password used when exporting the `.p12` |
| `IOS_APP_STORE_PROFILE_BASE64` | Base64 of the `.mobileprovision` file |
| `VITE_SUPABASE_URL` | Production Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Production Supabase publishable/anon key |

`IOS_CI_KEYCHAIN_PASSWORD` is optional. If omitted, the runner generates an ephemeral password. To create the three base64 values on macOS, use `base64 -i path/to/file | pbcopy`, then paste the clipboard into the corresponding GitHub secret. Never add these source files or encoded values to Git.

The Supabase anon key is intended for client applications, but it is still stored as a GitHub secret to avoid accidental configuration disclosure. The workflow fails before dependency installation if either Vite value or any required Apple signing value is absent, and never prints their values.

## Running a release

1. Merge this workflow to the default branch. GitHub only exposes a manual workflow there.
2. Open **GitHub → Actions → Deploy to TestFlight → Run workflow**.
3. Select `main`.
4. Leave the build number blank normally. Enter optional **What to Test** notes and the exact external tester-group name. Clear the group to upload without external distribution.
5. Select **Run workflow**.

Only `workflow_dispatch` is configured: pushes, pull requests, and merges do not deploy. A concurrency lock prevents two TestFlight deployments from running simultaneously, and an in-progress release is never cancelled by a newer request.

## Versions and build numbers

The marketing version remains `1.0`. Fastlane reads the latest TestFlight build for version 1.0 and selects the next integer. The workflow-level concurrency lock removes the normal race between lookup and upload. This is safer than `github.run_number`, which can be lower than builds previously uploaded from Xcode or another CI system.

An override is available for recovery. It must be a positive integer greater than the latest TestFlight build; otherwise the workflow stops. `CURRENT_PROJECT_VERSION` is passed to `xcodebuild`, so source-controlled project files remain unchanged.

## After upload

Fastlane waits for Apple to process the upload. If a tester group was supplied, it then requests external distribution and asks Apple to notify testers. Existing group members receive Apple's TestFlight notification when Apple permits distribution; testers who enabled automatic updates may receive it automatically through TestFlight.

The first external build of a version, and some later builds, may require Beta App Review. The workflow does not bypass review. If distribution cannot be completed, the upload remains successful and the log displays a warning. Open **App Store Connect → imBoredToday → TestFlight**, select version 1.0/build number, complete any requested metadata, submit it for Beta App Review, and assign it to the external group. Apple sends notifications once the build is approved and distribution is enabled.

## Troubleshooting

- **Missing secret:** add the named secret to the `testflight` environment or repository. Environment secrets take effect only after any environment approval.
- **No signing certificate/private key:** export the `.p12` from a Mac that holds both the Apple Distribution certificate and its private key, then replace both certificate secrets.
- **Profile mismatch or non-production APNs:** regenerate an App Store Connect profile for `au.imbored.app` after enabling Push Notifications. Do not use a development or Ad Hoc profile.
- **Certificate is not included in profile:** regenerate the App Store provisioning profile and explicitly select the Apple Distribution certificate exported into `IOS_DISTRIBUTION_CERTIFICATE_BASE64`. The workflow compares their SHA-1 identifiers before archiving.
- **No usable Apple Distribution identity:** re-export the `.p12` from Keychain Access with both the certificate and its private key. The CI diagnostic lists only safe identity hashes/names from the temporary keychain.
- **Profile/certificate expired:** renew both in the Developer portal and replace the base64 secrets together.
- **API authorization error:** confirm Key ID, Issuer ID, complete `.p8` content, and the App Manager role. Replace revoked keys.
- **Build number already used:** rerun with the build-number field blank; if another uploader raced the workflow, use an override greater than the newest build.
- **External group not found:** use the exact App Store Connect group name, or leave it blank and assign the processed build manually.
- **Upload succeeds but distribution warns:** inspect TestFlight for Beta App Review, export compliance, test information, or agreement prompts. The IPA does not need to be uploaded again.
- **CocoaPods/Xcode compatibility failure:** inspect the early Xcode/SDK and Ruby/CocoaPods diagnostics. Capacitor's `pod` executable must resolve to the temporary Bundler binstub, not `/opt/homebrew`; update the locked dependency constraints deliberately if the bundled tools are incompatible.

## Manual Xcode fallback

On a trusted Mac with the production Vite variables available locally, run `npm ci`, `npm test`, `npm run build`, and `npm run ios:sync`. Open `ios/App/App.xcworkspace`, select **Any iOS Device (arm64)**, then choose **Product → Archive**. In Organizer, validate and select **Distribute App → App Store Connect → Upload**, using automatic signing or the same distribution profile. Set a build number greater than the latest TestFlight build without committing the project change. After processing, assign the build to the external group in App Store Connect and submit for Beta App Review if requested.
