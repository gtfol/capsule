import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "privacy · capsule",
  description: "How capsule on the web and iPhone store and use your data.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalPage title="privacy policy" effectiveDate="September 24, 2026">
    <p>This policy covers capsule at capsule.gtfol.dev and the capsule iPhone app, operated by gtfol, LLC. Contact <a href="mailto:team@gtfol.dev">team@gtfol.dev</a> about privacy or your data.</p>
    <section><h2>on your device</h2>
      <p>The web app stores your wardrobe, wishlist, photos, outfits, and preferences in this browser. You can use it without an account. Local storage can be lost if you clear browser data or your device removes it.</p>
      <p>The capsule iPhone app processes photos you take or select, resizes them, and removes original location and camera metadata from its JPEGs. Foreground isolation and color estimation happen on device. The photo picker gives access only to selected photos. Unfinished scans and failed uploads can remain as local drafts; successful uploads remove the local photo and request body, keeping a small receipt to prevent duplicate saves. App credentials stay in Keychain. Device backups may include local app data.</p>
    </section>
    <section><h2>accounts and sync</h2>
      <p>Signing in gives us your account identifier, name, email address, and authentication information from your sign-in provider. The capsule iPhone app uses the same capsule account. We use this information to authenticate you and operate account features.</p>
      <p>With sync enabled, wardrobe and wishlist records, their photos and links, ratings, price history, and saved outfits are stored with your account. The capsule iPhone app sends the reviewed photo and item details when you select save to capsule. When signed in, your model photo is stored privately with your account and reused across the web and iPhone apps. Existing device-only model photos migrate when the account has no saved photo. Replacing or removing the photo syncs across devices; it is never included in public share links. Guest model photos stay in the browser.</p>
    </section>
    <section><h2>imports, sharing, and integrations</h2>
      <p>Pasting a product URL or refetching a price sends that URL to our server and the listing site so we can retrieve product information and images. External image hosts can receive requests when their photos are displayed.</p>
      <p>Creating a share link uploads a snapshot. Anyone with the link can view it, including the display name and content you share, and may keep a copy. Links expire at your chosen time or can be removed. Removing a link cannot remove copies others already saved.</p>
      <p>An integration token lets an AI agent or other tool access synced data within its permissions. Revoke tokens in Settings. Unsynced browser data is not available through the integration API.</p>
    </section>
    <section><h2>optional OpenAI processing</h2>
      <p>In the capsule iPhone app, adding a key and explicitly allowing photo processing sends newly selected garment photos directly to OpenAI to suggest details. Requests disable Responses API storage, but OpenAI’s provider retention policies still apply. Remove the key to stop this processing.</p>
      <p>In either app, selecting Render outfit sends your model photo, selected garment images, and render instructions through our server to OpenAI. Your own key authorizes the request, and OpenAI bills your account. Guest keys remain in memory for the page session. Keys saved to a capsule account are encrypted in our database; the server decrypts them when needed for rendering. The optional iPhone photo-detail extraction key stays in Keychain.</p>
      <p>See <a href="https://openai.com/policies/privacy-policy/">OpenAI’s privacy policy</a> for its handling of data.</p>
    </section>
    <section><h2>providers and analytics</h2>
      <p>We use Vercel for hosting and Supabase for our database. Authentication providers process sign-in requests. If you choose to support capsule, Stripe processes your payment; capsule does not receive your full card number. Providers may process network information, including IP addresses, for delivery, security, and operational logs.</p>
      <p>The web app uses PostHog for page visits and selected feature events, such as item counts and render durations. It uses cookies and local storage, and associates activity with your account ID when signed in. We exclude names, email addresses, item text, prices, photos, keys, product URLs, and raw share IDs from the events we send. Session recording and automatic input capture are disabled. The iPhone app also uses PostHog for selected screen visits and feature events, app and device versions, and a generated installation identifier. Activity is associated with your account ID when signed in. The same content exclusions apply; screen recording, automatic input capture, crash capture, and location enrichment are disabled. Turn off usage analytics in iPhone Settings to stop further collection on that device. Debug and automated test builds do not send analytics. There is no advertising SDK. We do not sell personal data or use it for advertising.</p>
    </section>
    <section><h2>retention and your choices</h2>
      <p>Use <Link href="/?view=settings">Settings</Link> to export the data available in your browser, remove saved keys, revoke integrations, clear guest data, or delete your account. Account deletion removes account records and synced content. It revokes share links managed by the current browser; links created in other browsers must be removed there. Offline copies, separate guest data, native drafts, and copies saved by other people remain on their devices.</p>
      <p>In the capsule iPhone app, Settings links directly to web account deletion. You may need to sign in there. Signing out revokes the app connection but does not delete your wardrobe. Local drafts remain until removed with the app.</p>
      <p>We retain cloud content while needed to provide the features you use, until you delete it or an applicable share expires. Limited security records, backups, or records required by law may persist under provider retention practices. We may disclose information when legally required or necessary to protect users and the service. Providers may process data outside your country.</p>
      <p>Contact <a href="mailto:team@gtfol.dev">team@gtfol.dev</a> to request access, correction, deletion, or other privacy rights available where you live. We may need to verify your identity. We do not knowingly collect children’s personal information; contact us if you believe a child has provided it.</p>
    </section>
    <section><h2>changes</h2><p>Updates will appear here with a revised effective date. Material changes to how we handle your data will be communicated through the service.</p></section>
  </LegalPage>;
}
