import type { Metadata, Viewport } from "next";
import { Lato } from "next/font/google";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { OfflineSupport } from "@/components/offline";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";
const lato = Lato({ variable: "--font-lato", weight: "400", subsets: ["latin"], display: "swap" });
export const metadata: Metadata = {
  metadataBase: new URL("https://capsule.gtfol.dev"),
  title: "capsule", description: "Your personal wardrobe.", applicationName: "capsule",
  openGraph: { type: "website", siteName: "capsule", title: "capsule", description: "Your personal wardrobe.", images: [{ url: "/social-preview.png", width: 1200, height: 630, alt: "capsule — Your personal wardrobe. Wardrobe, Wishlist, Outfits." }] },
  twitter: { card: "summary_large_image", title: "capsule", description: "Your personal wardrobe.", images: [{ url: "/social-preview.png", alt: "capsule — Your personal wardrobe. Wardrobe, Wishlist, Outfits." }] },
  manifest: "/manifest.webmanifest", icons: { icon: "/icon.svg", apple: "/icon.svg" },
  appleWebApp: { capable: true, title: "capsule", statusBarStyle: "default" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head><body className={`${lato.variable} font-sans antialiased`}><NuqsAdapter>{children}</NuqsAdapter><OfflineSupport /></body></html>; }
