import type { Metadata, Viewport } from "next";
import { OfflineSupport } from "@/components/offline";
import "./globals.css";
export const metadata: Metadata = { title: "capsule", description: "Your personal wardrobe.", applicationName: "capsule", manifest: "/manifest.webmanifest", icons: { icon: "/icon.svg", apple: "/icon.svg" }, appleWebApp: { capable: true, title: "capsule", statusBarStyle: "default" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#ffffff" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}<OfflineSupport /></body></html>; }
