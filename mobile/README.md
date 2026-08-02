# KNICKGASM Lifecycle OS — Mobile (Android + iOS)

Two ways the app runs on phones. **#1 works today, no build tools, no stores.**

## 1. Install as a PWA (recommended, instant)
The deployed web app is a full PWA — installable on both platforms now.
- **Android (Chrome):** open the site → ⋮ menu → **Install app / Add to Home screen**.
- **iOS (Safari):** open the site → Share → **Add to Home Screen**.
Launches full-screen, has an offline shell, app icon, and the daily/agent flows.
Updates ship automatically with each web deploy — nothing to resubmit.

## 2. App-store apps via Capacitor (this folder)
A thin native wrapper that loads the hosted PWA (`server.url` in
`capacitor.config.json`), so the store apps stay in sync with the website and
web updates don't require resubmission.

### What I can and can't do from here
The scaffold (config, scripts, fallback shell) is committed. **Building and
publishing must be done on a developer machine** — it needs native toolchains
and paid store accounts that don't exist in this environment:
- **Android:** Node + Android Studio + JDK; a Google Play Console account ($25 one-time).
- **iOS:** a **Mac** + Xcode + an Apple Developer account ($99/yr).

### Build steps (on your machine)
```bash
cd mobile
npm install
# Android
npm run add:android && npm run sync && npm run open:android   # → build/sign in Android Studio → Play Console
# iOS (Mac only)
npm run add:ios && npm run sync && npm run open:ios           # → archive/sign in Xcode → App Store Connect
```

### Config notes
- `appId`: `com.knickgasm.lifecycleos` (change before first publish if needed — it's permanent per store listing).
- `server.url`: the live deployment (`https://knickgasm.vercel.app`). Point it at your production domain if different.
- Icons/splash: drop a 1024×1024 PNG and run `npx @capacitor/assets generate` (add `@capacitor/assets`) to produce all Android/iOS icon + splash sizes; otherwise Android Studio/Xcode use placeholders.
- Auth: the app uses Google sign-in via Supabase — add the app's redirect/bundle origins to the Supabase + Google OAuth allowed lists before store review.

### Store-review caveat
Pure web-wrapper apps can draw extra scrutiny (esp. Apple guideline 4.2). The
PWA-feature set (offline shell, native voice via the device mic/speaker, push-
ready) helps; if Apple pushes back, bundle the assets locally (drop `server.url`,
point `webDir` at a copied build) instead of loading remote. The PWA path (#1)
sidesteps this entirely.
