# capsule scan privacy policy

Effective September 18, 2026. capsule scan is operated by gtfol, LLC. Contact [team@gtfol.dev](mailto:team@gtfol.dev) about privacy or your data.

## on your iPhone

capsule scan processes the photo you take or select, creates a resized JPEG, and removes original location and camera metadata from that JPEG. Foreground isolation and color estimation run on your device without sending the photo to a server. You can choose the original photo or the cutout before saving. The system photo picker provides access only to photos you select; the app does not request access to your entire photo library.

Unfinished scans and failed uploads can be saved locally as drafts, with their photos and item details. Successful uploads remove the local photo and upload body, retaining a small receipt to prevent duplicate submissions. Credentials are stored in this device's Keychain, not in the item database or source code.

## your capsule account

Signing in uses capsule's website and authentication provider. capsule stores account information such as your name, email address, and account identifier. The app receives an account identifier, display name, and a credential to save items to your account; it does not receive your Google password.

When you tap **save to capsule**, the reviewed item details and photo are sent to capsule and stored with your account. This includes any name, brand, category, color, size, price, and currency you provide. Capsule uses hosting and database providers to operate this service. Network providers may process connection information, such as IP addresses, for delivery, security, and operational logs.

## optional OpenAI processing

OpenAI processing is off by default. If you provide your own API key and explicitly allow photo processing, newly selected garment photos are sent directly to OpenAI to suggest item details. Your key authenticates those requests and is not sent to capsule's server. OpenAI may process the image content and associated request information under its own policies. API usage is charged to your OpenAI account.

Requests disable Responses API storage with `store: false`. This does not eliminate all provider retention, including applicable abuse-monitoring logs. See [OpenAI's API data controls](https://platform.openai.com/docs/guides/your-data). Remove your key in Settings to stop future OpenAI photo processing.

## retention and deletion

Local drafts remain on your iPhone until removed with the app. Saved wardrobe items remain in capsule until you delete them or your account. Open **delete account** in capsule scan Settings to reach [capsule settings](https://capsule.gtfol.dev/?view=settings), sign in if needed, and complete deletion. Deleting your cloud account does not erase drafts stored on your iPhone. You can also contact us for help with a deletion request.

Signing out revokes this app's capsule connection. Removing the OpenAI key deletes it from the app's Keychain storage. These actions do not delete previously saved wardrobe items.

## analytics and advertising

The native app has no advertising or analytics SDK and does not track you across other companies' apps or websites. The separately hosted capsule website has its own operational and analytics behavior. The app does not sell your personal data.

## updates

We may update this policy as the service changes. The effective date above identifies the current version.
