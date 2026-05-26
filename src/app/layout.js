import { Geist, Geist_Mono, Bricolage_Grotesque } from "next/font/google";
import { SerwistProvider } from "@serwist/turbopack/react";
import "./globals.css";
import { NavTracker } from "./nav-tracker";
import { PwaInstallPrompt } from "./pwa-install-prompt";
import { SwUpdatePrompt } from "./sw-update-prompt";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Distinctive display face for the brand wordmark and section headings — a
// characterful grotesque that reads athletic without shouting.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
  display: "swap",
});

export const metadata = {
  title: "DinkMaster — Smart Paddle Stacking & Partnership Mixing",
  description:
    "Run your pickleball open play: stack the rack, mix partnerships fairly, and track matches in real time.",
  // iOS standalone (Add to Home Screen) behaviour + status bar appearance.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "DinkMaster",
  },
  icons: {
    apple: "/icons/apple-touch-icon.png",
  },
};

export const viewport = {
  // Drives the browser/standalone UI tint; matches the manifest theme_color.
  themeColor: "#059669",
};

// Disable the service worker in development so we never fight stale caches while
// iterating; it only registers in production builds.
const swDisabled = process.env.NODE_ENV === "development";

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${bricolage.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <SerwistProvider swUrl="/serwist/sw.js" disable={swDisabled}>
          <NavTracker />
          {children}
          {/* Shared stack so the install and update prompts never overlap when
              both are visible — they sit in a column, bottom-anchored. Lifted
              above the arena mobile-nav FAB on small screens (it sits at
              bottom-4), back to bottom-4 once the FAB is hidden at md. */}
          <div className="fixed inset-x-4 bottom-20 z-50 mx-auto flex max-w-sm flex-col gap-2 md:bottom-4">
            <PwaInstallPrompt />
            <SwUpdatePrompt />
          </div>
        </SerwistProvider>
      </body>
    </html>
  );
}
