import type { Metadata, Viewport } from "next";
import { Lato } from "next/font/google";
import { OfflineSupport } from "@/components/offline";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme";
import "./globals.css";
const lato = Lato({ variable: "--font-lato", weight: "400", subsets: ["latin"], display: "swap" });
export const metadata: Metadata = { title: "capsule", description: "Your personal wardrobe.", applicationName: "capsule", manifest: "/manifest.webmanifest", icons: { icon: "/icon.svg", apple: "/icon.svg" }, appleWebApp: { capable: true, title: "capsule", statusBarStyle: "default" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} /></head><body className={`${lato.variable} font-sans antialiased`}>{children}<OfflineSupport /></body></html>; }
