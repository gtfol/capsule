# verification

## Automated checks

The iPhone simulator build, XCTest suite, unsigned physical-device build, and shared macOS core tests pass in GitHub Actions with Xcode 26.6 / iOS 26.5. See [PR #1 checks](https://github.com/gtfol/capsule-scan/pull/1/checks) for the exact tested commit and result. The final suite includes 28 iPhone tests and 23 shared core tests on macOS.

Local checks so far: core Swift compilation with Swift 6.3.2 (Swift 6 language mode), project and Info.plist syntax validation. Local XCTest/simulator verification is pending the Xcode installation; Command Line Tools alone do not contain XCTest.

## Before calling the device flow verified

Use a physical iPhone with iOS 17 or newer and a development signing team:

- Fresh install, no keys: allow camera access, capture one garment, review all fields, save, and reopen it from the local grid. Confirm the display name is `capsule scan`.
- Deny camera access: verify the Settings link and photo-library alternative. Cancel each picker without creating an item.
- Choose a high-resolution portrait/landscape photo; check orientation, local reopen after force quit, and a JPEG long edge at most 1600 px.
- On a simulator, import a sample image through Photos, select it, and complete the same local flow.
- With a real `wardrobe:write` token, save a named item and verify its photo and fields in the capsule web app. The unit suite mocks this request; no live wardrobe has been modified by tests.
- In airplane mode, save to capsule and confirm a local failed item remains. Restore the connection and retry; check there is only one remote item.
- Revoke the token, retry a save, and confirm the app disconnects without removing the local item. Replace the token and retry.
- With an optional OpenAI key, verify extraction succeeds for one photo. Remove the key and verify on-device extraction still works.

Physical camera behavior, real credentials, and provider-backed end-to-end saves cannot be verified by mocked unit tests or an unsigned build.
