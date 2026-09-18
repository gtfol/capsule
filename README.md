# capsule scan

Photograph one garment, review its details, and save it to your [capsule](https://capsule.gtfol.dev) wardrobe.

Native SwiftUI + SwiftData, iOS 17+, iPhone only. No third-party dependencies or bundled credentials. Uses your existing capsule account.

## Build and run

1. Open `CapsuleScan.xcodeproj` in Xcode 26.6 or newer. Xcode 26.6 works on macOS 26.2–26.x; Xcode 27 requires macOS 26.6 or newer.
2. Select the **CapsuleScan** scheme and an iPhone simulator. Install an iOS runtime under Xcode Settings → Components if needed.
3. Run. The simulator uses **choose a photo**; the camera is available on a physical iPhone.
4. For a physical device, select your development team under Signing & Capabilities. Change the placeholder bundle identifier `dev.gtfol.capsulescan` if your team requires a unique identifier.

First launch opens **sign in to capsule**. The system browser uses capsule’s existing Google login (or email login when enabled). Confirm the connection and return to the app; future launches open capture directly.

Choose one photo, edit the draft, then tap **save to capsule**. A name is required. After saving, return to capture or open your wardrobe on the web. There is no separate local wardrobe or local/remote toggle.

## Sign-in and drafts

The browser returns a short-lived, single-use code bound to a PKCE verifier held in the app. The app checks the callback and state, exchanges the code over HTTPS, and stores its account and restricted `wardrobe:write` credential atomically in Keychain. No token copying, account passwords, or new backend is needed. Connections expire after one year and can be revoked in capsule Settings → Integrations; signing out also revokes the connection.

The web handoff must be deployed before using this app. See capsule’s `docs/scan-sign-in.md` for the server protocol. Existing manually entered tokens are migrated only after checking their account with capsule.

For unfinished scans, tap **close → save draft**. Drafts and failed uploads appear under the tray button. Signed-in capture and draft editing work offline; uploads wait for an explicit retry. A 401/403 asks you to sign in again and keeps the draft. Drafts are bound to their account and cannot be sent to a different one.

Successful saves leave a small internal receipt to prevent resubmission. They disappear from drafts, and their local photo and encoded request are removed. Already-saved records from older versions are preserved but no longer presented as a second wardrobe. Manage completed items in capsule. Choose a category if known: capsule’s API defaults an omitted category to `tops`.

## Optional vision extraction

Add your own OpenAI API key in Settings to use `gpt-4.1-mini` through the Responses API. Newly selected garment photos are sent directly to OpenAI to draft category, color, name, and an optional visible brand. Usage is billed to your OpenAI account. Requests set `store: false`; provider retention policies still apply.

Without a key, Core Image estimates the dominant color in the center of the photo and leaves category unset. If external extraction fails, the app falls back to on-device color and manual editing. Late responses cannot replace fields you already edited.

## Data and security

- SwiftData stores drafts and save receipts; pending JPEGs are separate files in Application Support, referenced by stable relative UUID filenames.
- Photos are oriented, downscaled to at most 1600 px, flattened to JPEG, and stripped of source metadata off the main actor.
- Prices are canonical decimal strings parsed with `Decimal`, never floating-point amounts. Currency defaults from the device locale.
- Capsule tokens and OpenAI keys are stored only in Keychain (`WhenUnlockedThisDeviceOnly`, no Keychain sync). They are never included in SwiftData, image files, logs, or configuration.
- Capsule receives only its documented create fields. The complete body stays below 3,800,000 bytes; each image also respects capsule's 1,500,000-byte limit.
- The exact pending body and idempotency UUID are persisted before network submission. Timeout, offline, and server-error retries reuse both across launches. Saving edited fields after failure resets both; an idempotency conflict rotates the key and retries once.
- The HTTP client rejects redirects rather than forwarding bearer credentials elsewhere. Errors shown to users never include server response bodies.
- Camera access is requested only when used. The system photo picker grants access to the selected photo without requesting broad library access.
- No analytics, automatic remote saves, background sync, or new backend. The OS may include local app data in a device backup; there is no app-level iCloud sync.

## Tests

With Xcode selected and an iPhone simulator installed:

```sh
scripts/test-ios.sh
```

This builds the iPhone simulator and unsigned physical-device targets, then runs XCTest on an available iPhone simulator. Results are written to `TestResults.xcresult`; move or remove a previous result bundle before repeating. It does not install to or test a physical camera.

The same networking, extraction, image, and idempotency tests can also run on macOS with the full Xcode developer directory selected:

```sh
swift test
```

Tests use generated images and ephemeral mock credentials, never real capsule or OpenAI credentials. SwiftData/editor tests run in the iPhone test target. See [verification](docs/verification.md) for the current verification record and device checklist.

## Project layout

- `CapsuleScan/Core`: destination/extractor protocols, URLSession client, image processing, Keychain, decimal validation, save coordination.
- `CapsuleScan/Persistence`: SwiftData model and explicit-save adapter.
- `CapsuleScan/UI`: sign-in, capture, review, drafts, settings.
- `CapsuleScanTests`: request, error, retry, extraction, image-limit, persistence, and editor regression tests.
- `scripts/generate-project.py`: optional standard-library-only project generator. The complete generated Xcode project is committed; no generation step is needed to build.
- `scripts/make-icon.swift`: renders capsule's lowercase black “c” mark on an opaque white app icon.

`ItemExtractor` and `WardrobeDestination` are the extension seams. This version deliberately contains only the sign-in → single photo → reviewed item → capsule save flow.
