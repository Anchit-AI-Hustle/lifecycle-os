# Lifecycle OS — iOS & Android (Capacitor)

The native apps are a **Capacitor** shell that loads the live web app
(`https://knickgasm.vercel.app`) in a full-screen
native WebView. This keeps one codebase, keeps `/api/*` and Google sign-in
working against the real https origin, and means **content updates ship with
your normal Vercel deploy — no app rebuild needed**.

Config: `capacitor.config.json` (`appId: com.knickgasm.lifecycleos`). The native
projects live in `android/` and `ios/`. `mobile-shell/` is the splash / offline
fallback bundled into the app.

> These native folders are excluded from the Vercel deploy via `.vercelignore`.

## Prerequisites
```bash
npm install            # pulls @capacitor/* already in package.json
npx cap sync           # copies web shell + config into android/ and ios/
```

## Android → APK (or AAB for Play Store)
Needs the **Android SDK** (Android Studio, or cmdline-tools). It could NOT be
built in the cloud dev container because `dl.google.com` (the SDK source) is
blocked there — build on your machine:

```bash
# one-time: install Android Studio, then let it install SDK + platform-tools
npm run mobile:android          # → android/app/build/outputs/apk/debug/app-debug.apk
# or open the project and press Run:
npm run mobile:android:open
```
- **Debug APK** (installable directly on any device via `adb install app-debug.apk`
  or by sideloading): `android/app/build/outputs/apk/debug/app-debug.apk`.
- **Release AAB for Play Store**: in Android Studio → Build → Generate Signed
  Bundle → AAB, sign with a new keystore, upload to Play Console
  (one-time $25 developer account).

## iOS → IPA (App Store / TestFlight)
Requires **macOS + Xcode** — cannot be built on Linux/Windows. (There is no
`.dmg` for iOS apps; `.dmg` is a macOS desktop-installer format. The iOS
installable is an `.ipa`, distributed through TestFlight or the App Store.)

```bash
# on a Mac:
sudo gem install cocoapods       # one-time
npm run mobile:ios:open          # opens ios/App/App.xcworkspace in Xcode
```
In Xcode: set your Team (Apple Developer account, $99/yr) → Product → Archive →
Distribute App → App Store Connect / TestFlight, or Ad Hoc for a direct `.ipa`.

## App-store review note
Because the app loads a remote URL, Apple may flag it under guideline 4.2
("minimum functionality") for public App Store listing. For an internal
business tool this is usually fine via **TestFlight** or **Apple Business
Manager (custom app / unlisted)** and Google Play **internal testing** — no
public listing required. If public listing is needed, bundle the pages locally
(`webDir`) instead of `server.url` and add native features (push, share).

## Updating the apps
Web/content changes: just deploy to Vercel — the shell reloads the live URL.
Only rebuild the native apps when you change `capacitor.config.json`, native
plugins, icons, or the splash screen.
