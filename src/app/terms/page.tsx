import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "terms · capsule",
  description: "Terms for using capsule and capsule scan.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalPage title="terms of service">
    <p>These terms cover capsule and capsule scan, provided by gtfol, LLC. By using the services, you agree to these terms. Contact <a href="mailto:team@gtfol.dev">team@gtfol.dev</a> with questions.</p>
    <section><h2>using capsule</h2><p>capsule helps you record clothing, manage a wishlist, and render outfits. capsule scan photographs items for your capsule wardrobe. Keep your account and integration credentials secure. Use the services lawfully, without accessing another person’s data, bypassing security, or disrupting the service.</p></section>
    <section><h2>your content</h2><p>You retain ownership of your photos and item data. Only upload or share content you have permission to use. You give us permission to store, process, and display it as needed to provide the features you select, including sync, rendering, and share links. This permission does not transfer ownership.</p><p>Anyone with a share link may view and copy its contents. Check what you are sharing before publishing a link. Removing a link does not recall copies already saved by others.</p></section>
    <section><h2>generated details and external services</h2><p>Image cutouts, suggested details, product imports, prices, and outfit renders may be inaccurate or incomplete. Review results before saving or relying on them. Rendered outfits do not guarantee fit, appearance, availability, or purchase prices.</p><p>Optional OpenAI features use your key and may incur charges from OpenAI. External stores, sign-in providers, payment processors, and AI services have their own terms. capsule does not sell the clothing shown in your wardrobe or wishlist.</p></section>
    <section><h2>cost and support</h2><p>capsule and capsule scan currently have no subscription or paywall. Voluntary support payments are optional and do not unlock features. Contact us about payment problems. External API charges are separate and controlled by your provider account.</p></section>
    <section><h2>data and availability</h2><p>Our <Link href="/privacy">privacy policy</Link> explains storage and processing. Local data can be lost if you clear browser data, remove the app, or lose access to your device. Export web data you want to keep. We cannot guarantee uninterrupted service, recovery of local data, or that external product pages remain available.</p><p>To the extent permitted by law, the services are provided as available, without guarantees that every result will be accurate or error-free. Nothing in these terms limits consumer rights or liabilities that cannot legally be excluded.</p></section>
    <section><h2>ending use</h2><p>You can stop using the services at any time. Use <Link href="/?view=settings">Settings</Link> to delete your account or clear browser data. We may restrict access where reasonably necessary to address abuse, security risks, or legal requirements. The privacy policy explains which local copies and shared content can remain after deletion.</p></section>
    <section><h2>the iPhone app and source code</h2><p>The App Store version of capsule scan is also licensed under <a href="https://www.apple.com/legal/internet-services/itunes/dev/stdeula/">Apple’s Standard License Agreement</a>. These service terms do not replace that license. Open-source components remain subject to their respective licenses.</p></section>
    <section><h2>changes and contact</h2><p>We may update these terms as the service changes. Revisions will be published here with an updated effective date, with notice through the service for material changes. Questions can be sent to <a href="mailto:team@gtfol.dev">team@gtfol.dev</a>.</p></section>
  </LegalPage>;
}
