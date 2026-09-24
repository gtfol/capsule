# verification

## Native outfits — 1.2 (14)

- Added the online outfit grid, detail/rename/delete, wardrobe-piece selection, reusable account-scoped model photo, encrypted account rendering-key settings, and explicit OpenAI render confirmation. Saved outfits use the same records as the web app.
- Passed 49 shared core tests and 78 iPhone simulator tests on Xcode 26.6 / iOS 26.5. Recovery tests cover a timed-out paid render, restarting the app, a failed result fetch, account isolation, and revision-safe edits without repeating provider requests.
- The iPhone simulator build and unsigned iPhone Release archive pass without compiler warnings.
- Web checks: 320 tests passed, two unrelated database suites skipped. Native outfit/PKCE checks ran against disposable local PostgreSQL; OpenAI was mocked. Lint, TypeScript and the production web build passed.
- Inspected rendered SwiftUI layouts at 390- and 430-point widths using disposable fixtures. The render action stays visible beneath the scrolling wardrobe; the model-photo placeholder reuses the approved web silhouette.
- Saved and applied `db/migrations/20260924_native_outfits.sql` in Capsule Supabase (snippet `1e547e30-3b47-4f4b-93ad-27d73b9620cc`). Existing connections retain their current permissions and reconnect explicitly. Build 1.2 (13) uploaded successfully; build 14 also includes the support-link changes merged during preparation. Processing and internal-group availability are verified separately.
- Still requires a physical-device check of model-photo camera/library selection and saving an outfit image to Photos, plus one real-account render and verification on the web. Automated checks do not make a paid OpenAI request. App Review's existing 1.0 (10) is unchanged.

## Native wardrobe — build 8

The native wardrobe reads server records online and supports filtering, detail editing, front/back/side uploads/capture, background removal, explicit saves and deletion. It does not create an offline wardrobe store. The shared core suite passes 38 tests and the iPhone suite passes 59 tests, including pagination through empty pages, account changes during requests, bearer isolation, unchanged-photo preservation, exact-body retries, edited retry key rotation, and revision conflicts. The API suite passes 315 tests, including new account/photo/deletion checks against disposable Postgres (two unrelated database suites are skipped).

The unsigned iPhone Release archive also builds without compiler warnings. A disposable preview with approved gallery images was inspected on the gallery iPhone and iPhone 17 Pro Max simulators. Checks covered the grid, category filtering and empty state, front/back/side selection, edit fields and keyboard dismissal, unsaved-change confirmation, a simulated failed save retaining edits, and entry into capture. No production wardrobe was modified. Build 8 uploaded successfully to App Store Connect on September 23; Apple processing and internal-group assignment are tracked separately.

Before release, verify a real-account sign-in upgrade, native grid photos, an edit appearing on web after its normal sync, a web edit causing a native revision conflict, and explicit deletion propagating to web. Existing physical capture verification below predates this feature.

## Automated checks

Release 1.0 (5) adds on-device foreground isolation for new photos, a cropped white JPEG preview, and an original/cutout choice before the first save. It also includes the account-deletion link at the bottom of Settings. All 47 iPhone simulator tests and 31 macOS core tests pass on Xcode 26.6 with no compiler warnings. Regression tests cover white compositing, crop padding, JPEG/upload size limits, invalid input, original-image fallback, explicit-save persistence, reopening a cutout draft, cancellation, and ignoring late cutouts after saving.

The real Vision engine was also exercised on macOS using the existing sweater gallery asset: it produced a 1276 × 1279 JPEG (396,290 bytes), and the output was visually inspected. That already isolated source is a smoke check, not evidence of accuracy on real camera backgrounds. Physical-iPhone segmentation quality, especially sleeves/straps and similarly colored floors or bedding, still needs verification before submission. Foreground detection can include nearby objects or a wearer; it is not clothing classification.

Release 1.0 (4) adds a **terms** link in Settings to Apple's Standard License Agreement. The iPhone simulator build and unsigned Release archive pass without warnings on Xcode 26.6. Distribution upload completed successfully after renewal of the Xcode account session.

On September 18, 2026, Allen confirmed that camera capture and saving to capsule worked on his physical iPhone, and that both the item and photo appeared in his web wardrobe. This confirms that core live flow; it does not replace the remaining offline/retry, account-deletion, or optional OpenAI checks below.

The App Store preparation for 1.0 (3) passes 40 iPhone tests and 28 macOS core tests. Its Release archive builds without warnings on Xcode 26.6. New coverage verifies that an existing OpenAI key cannot enable photo transmission without explicit consent, consent survives refresh, and removing the key disables processing. The on-device path also returns a color after the same JPEG preparation used by camera/library inputs. Settings now labels that mode **color only**; it does not identify name, brand, or category without OpenAI.

App Review preparation adds public privacy/support links, a web account-deletion shortcut, and an explicit photo-processing consent prompt. Build 3 was uploaded successfully. The approved marketing screenshots were uploaded in capture, details, drafts order; submission remains pending.

The interface update for 1.0 (2) passes all 39 iPhone tests and 28 macOS core tests on Xcode 26.6 / iOS 26.5. It bundles Lato and its license, removes the green accent and inset form cards, and moves the photo-details explanation into a tappable popover.

Simulator review covers the signed-out capture screen, settings, info open/close, API-key field, draft grid, review fields, category picker, disabled remote save, and unsaved-edit confirmation. At the largest Dynamic Type setting, the status moves below the settings heading and the information opens as a sheet so its full text remains readable. The simulator's text size was restored afterward.

A real sign-in attempt exposed missing Keychain access in the unsigned simulator build. An isolated system-Keychain regression test reproduces the failure with `CODE_SIGNING_ALLOWED=NO` and passes with ad-hoc signing, including credential creation, reading after reopening the store, updating, and deletion. The simulator build/test script now keeps ad-hoc signing enabled; it requires no development account. The UI no longer assumes every Keychain failure means the phone is locked. TestFlight uses Apple's distribution signing separately.

The sign-in/capture-companion change passes 38 iPhone XCTest tests and 28 shared macOS core tests locally with Xcode 26.6 / iOS 26.5. The iPhone simulator build also passes with compiler warnings treated as errors. Tests cover the PKCE request and callback, cancellation, Keychain session persistence, account-bound drafts, failed-save recovery, exact-body idempotency, request limits, image processing, and success cleanup.

Capsule’s companion server suite verifies code exchange against a disposable local Postgres database: origin/account checks, PKCE, concurrent single-use consumption, expiry, session revocation, restricted scopes, and token revocation. No production wardrobe is modified by these tests.

The earlier local photo flow was manually verified in the iPhone 17 Pro simulator: a 2000 × 2400 sample was imported, identified as blue, edited, saved, and reopened after restart. The stored JPEG was 1333 × 1600. The new sign-in-to-upload flow still needs a real account for end-to-end verification.

## Device and live-service checklist

Use a physical iPhone with iOS 17 or newer and a development signing team:

- Fresh install: choose **sign in to capsule**, complete the existing web login, confirm the connection, and return to capture. Cancel sign-in once and confirm it can be retried.
- Relaunch: capture opens without another login. Settings shows the account and **sign out**; there is no integration-token field.
- Allow camera access, photograph one garment, review all fields, and tap **save to capsule**. Verify the photo and fields in the capsule web app. Success returns to capture and removes the scan from drafts.
- On build 5 or newer, photograph a laid-out garment on a contrasting surface. Verify the cutout retains edges and removes the surface, compare **original / cutout**, and confirm the chosen photo appears in capsule. Try a cluttered or low-contrast scene and use the original if the mask is wrong. Test in airplane mode: isolation should still run without a key or server request. Choosing **use original** during processing must prevent a late cutout from replacing it.
- Deny camera access: verify the Settings link and photo-library alternative. Cancel each picker without creating a draft.
- Choose a high-resolution portrait/landscape photo; confirm orientation. Close the review, choose **save draft**, restart, and reopen it under the tray button.
- In airplane mode after sign-in, attempt a save and confirm the failed draft remains. Restore the connection and retry; check there is only one remote item.
- Revoke the connection in capsule Settings → Integrations, retry a save, and confirm the app asks for sign-in while retaining the draft. Sign back into the same account and retry.
- Sign into another account: the first account’s drafts must stay hidden and must never be uploaded to the new account.
- Sign out with connectivity and confirm the connection is revoked on the server.
- With an optional OpenAI key, verify extraction for one photo. Remove the key and verify on-device extraction still works.

Physical camera behavior, Google login with a real account, and live wardrobe/OpenAI requests cannot be verified by mocked unit tests or an unsigned build.

## Native wishlist — September 23, 2026

- Added online wishlist grid, manual create/edit with all photo views, half-star ratings, sort options, interactive price history, on-demand source checks, and atomic move to wardrobe.
- Passed 44 core tests and 69 simulator tests on Xcode 26.6 / iPhone 17 Pro simulator; simulator and unsigned device builds succeeded.
- Web API: 317 tests passed, 2 unrelated database tests skipped; integration/PKCE/price/move/delete checks ran against an isolated local PostgreSQL database. Lint, TypeScript, and production build passed.
- Explicit native wishlist scope migration is saved and applied in Supabase under `20260924_native_wishlist.sql` (snippet `ee0d5011-4a91-4935-865b-efd11597b31d`). Existing grants are unchanged.
- Still requires physical-device checks for choosing/taking all photo views, half-star taps, chart scrubbing, and reconnecting a previous wardrobe-only installation. No new build has been submitted to App Review as part of this code PR.
