# verification

## Automated checks

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
