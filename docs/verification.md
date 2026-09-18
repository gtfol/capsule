# verification

## Automated checks

The App Store preparation for 1.0 (3) passes 40 iPhone tests and 28 macOS core tests. Its Release archive builds without warnings on Xcode 26.6. New coverage verifies that an existing OpenAI key cannot enable photo transmission without explicit consent, consent survives refresh, and removing the key disables processing. The on-device path also returns a color after the same JPEG preparation used by camera/library inputs. Settings now labels that mode **color only**; it does not identify name, brand, or category without OpenAI.

App Review preparation adds public privacy/support links, a web account-deletion shortcut, and an explicit photo-processing consent prompt. Live camera/save verification and App Store submission are still pending.

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
- Deny camera access: verify the Settings link and photo-library alternative. Cancel each picker without creating a draft.
- Choose a high-resolution portrait/landscape photo; confirm orientation. Close the review, choose **save draft**, restart, and reopen it under the tray button.
- In airplane mode after sign-in, attempt a save and confirm the failed draft remains. Restore the connection and retry; check there is only one remote item.
- Revoke the connection in capsule Settings → Integrations, retry a save, and confirm the app asks for sign-in while retaining the draft. Sign back into the same account and retry.
- Sign into another account: the first account’s drafts must stay hidden and must never be uploaded to the new account.
- Sign out with connectivity and confirm the connection is revoked on the server.
- With an optional OpenAI key, verify extraction for one photo. Remove the key and verify on-device extraction still works.

Physical camera behavior, Google login with a real account, and live wardrobe/OpenAI requests cannot be verified by mocked unit tests or an unsigned build.
