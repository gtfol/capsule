# capsule

Browse and edit your [capsule](https://capsule.gtfol.dev) wardrobe, wishlist, and outfits on iPhone, or photograph a garment to add it.

Native SwiftUI + SwiftData, iOS 17+, iPhone only. No third-party dependencies or bundled credentials. Uses your existing capsule account.

The interface follows the shared [design reference](https://github.com/gtfol/ai/blob/889bd107969475a8c269d4428972b47b61b9794d/DESIGN.md): a monochrome canvas, regular typography, open sections, and native controls. Lato Regular is bundled for offline use under the [SIL Open Font License](CapsuleScan/Resources/Lato-OFL.txt), with Dynamic Type support. The font comes from [Google Fonts](https://github.com/google/fonts/tree/main/ofl/lato).

[Support](https://gtfol.dev/contact) · [Privacy](https://capsule.gtfol.dev/privacy) · [Terms](https://capsule.gtfol.dev/terms)

## Build and run

1. Open `apps/ios/CapsuleScan.xcodeproj` in Xcode 26.6 or newer. Xcode 26.6 works on macOS 26.2–26.x; Xcode 27 requires macOS 26.6 or newer.
2. Select the **CapsuleScan** scheme and an iPhone simulator. Install an iOS runtime under Xcode Settings → Components if needed.
3. Run. The simulator uses **choose a photo**; the camera is available on a physical iPhone.
4. For a physical device, select your development team under Signing & Capabilities. The app uses bundle identifier `dev.gtfol.capsule`.

First launch opens **sign in to capsule**, then the native wardrobe grid. The system browser uses capsule’s existing Google login (or email login when enabled). Approve wardrobe, wishlist, and outfit access and return to the app. Older capture-only connections must sign in once more; their permissions are never expanded silently.

The grid loads the signed-in account’s server wardrobe, supports category filters and pull-to-refresh, and opens an editable item sheet. Edit name, brand, category, color, size, decimal price, currency, description, and purchase link. Select front/back/side, upload or capture a replacement, remove a view, or run on-device background removal. Cutouts crop around the garment while retaining the original photo’s proportions and stay transparent PNGs through preview, local drafts, and upload. Pull-to-refresh reloads existing records and photos as well as new items. Save and delete require an explicit tap. Revision conflicts keep your edits and offer an explicit reload; failed saves retry the same body and key until you change the form.

Tap **+** to capture or choose a photo, review the draft, then tap **save to capsule**. A name is required. A successful upload returns to the native wardrobe. Unfinished scans are still available under the tray button on the capture screen.

The wardrobe is online-only: it is not replicated in SwiftData and there is no background sync queue. Refresh reads current server records; saves go directly to the existing REST API. In-memory photos are account/revision scoped and bounded to 24 MB / 32 entries. Network errors show a retry action; already loaded records may remain visible until refreshed. Local scan drafts retain their existing recovery behavior.

New camera and library photos are processed with Apple's on-device Vision foreground mask. The review shows a cropped cutout on white, with a little padding. Choose **original** or **cutout** before saving; **use original** also lets you skip processing while it runs. Nothing is written until you save. If isolation fails, the original photo stays available and details can still be edited. The selected version is kept in drafts and sent to capsule; reopening a draft does not reprocess it.

This is foreground isolation, not garment classification. Use one garment laid out clearly; nearby objects or a person wearing the garment may also be included. No account, API key, or server request is needed for this processing. Check edges on the review screen before saving. The original/cutout choice is available for a new scan, before its first draft or upload save.

## Wishlist

Switch to **wishlist** in the bottom navigation. Browse by category and sort by recent additions, rating, or biggest price drop. Add a piece with **+**, edit its details and front/back/side photos, and tap **save to wishlist**. Half-star ratings can be cleared by tapping the same value again; VoiceOver supports adjustable ratings.

Saved items show an interactive price dot chart with date/source details and a currency selector when needed. Refetch a listing or add an alternative to record a new quote. Unavailable listings are marked without erasing history. Current price chooses the cheapest healthy source in the item's currency. Save edits before checking prices or confirming **move to wardrobe**. The move is atomic and duplicate-aware; deleting a piece also updates the web app.

Wishlist requires a fresh sign-in for its additional permissions. Everything uses the signed-in account's online records, with no offline wishlist copy or background price checks. Shopping-link import and Share Sheet support are separate work.

## Outfits

Switch to **outfits** to browse the same saved looks as the web app. Create an outfit from one to six owned pieces, a reusable full-body model photo, and optional styling notes. An explicit confirmation sends those images to OpenAI and saves the result to your account. The current server-configured model is shown before rendering. Rename or remove an outfit, open its wardrobe pieces, or save its image to Photos. Sharing remains a separate feature.

The model photo is stored on this iPhone, scoped to the signed-in account, and can be replaced or removed. It is not background-removed. **Settings → outfit rendering** manages the same encrypted account API key used by the web app; the key is never downloaded to the phone. This is separate from the optional Keychain key for photo-detail extraction.

Rendering uses durable server receipts: retries and status checks for a single attempt never call the paid provider twice. The phone keeps only the account-scoped attempt UUID to recover after a network interruption or restart, not an offline upload queue. An interrupted or failed attempt requires an explicit new render. Since a provider timeout can still incur a charge, the app reports uncertain results and lets the user check existing outfits first.

Existing installations sign in again for explicit outfit permissions. The native permission migration must be applied before deployment. App Review's existing 1.0 build is not replaced by this beta.

## Sign-in and drafts

The browser returns a short-lived, single-use code bound to a PKCE verifier held in the app. The app checks the callback and state, exchanges the code over HTTPS, and stores its account and scoped `items:read`, `wardrobe:write`, `wishlist:write`, and native-only `wardrobe:delete` / `wishlist:delete` credential, plus native-only `outfits:read` / `outfits:write` / `outfits:delete`, atomically in Keychain. No token copying, account passwords, or new backend is needed. Connections expire after one year and can be revoked in capsule Settings → Integrations; signing out also revokes the connection.

The web handoff must be deployed before using this app. See the [web sign-in protocol](../web/docs/scan-sign-in.md) for the server protocol. Existing manually entered tokens are migrated only after checking their account with capsule.

For unfinished scans, tap **close → save draft**. Drafts and failed uploads appear under the tray button. Signed-in capture and draft editing work offline; uploads wait for an explicit retry. A 401/403 asks you to sign in again and keeps the draft. Drafts are bound to their account and cannot be sent to a different one.

Successful saves leave a small internal receipt to prevent resubmission. They disappear from drafts, and their local photo and encoded request are removed. Already-saved records from older versions are preserved but no longer presented as a second wardrobe. Manage completed items in capsule. Choose a category if known: capsule’s API defaults an omitted category to `tops`.

## Optional vision extraction

Add your own OpenAI API key in Settings to use `gpt-4.1-mini` through the Responses API. Newly selected garment photos are sent directly to OpenAI to draft category, color, name, and an optional visible brand. Usage is billed to your OpenAI account. Requests set `store: false`; provider retention policies still apply.

Settings calls this **photo details** and shows **color only** when OpenAI processing is disabled. Tap its information icon for the on-device behavior, model, billing, and key-storage details. Saving a key requires explicit permission to send photos to OpenAI; previously saved keys also require this consent before photo processing is enabled.

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

From `apps/ios`, with Xcode selected and an iPhone simulator installed:

```sh
scripts/test-ios.sh
```

This builds the iPhone simulator and unsigned physical-device targets, then runs XCTest on an available iPhone simulator. Results are written to `TestResults.xcresult`; move or remove a previous result bundle before repeating. It does not install to or test a physical camera.

Keep simulator signing enabled (the script uses ad-hoc signing, with no Apple account required). `CODE_SIGNING_ALLOWED=NO` removes the simulator’s Keychain identity and prevents sign-in credentials from being saved. The test suite exercises the real system Keychain in an isolated namespace to catch this setup error.

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

`ItemExtractor` and `WardrobeDestination` are the extension seams. Sharing, shopping-link import, batch capture, search, and export remain separate features.
