import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import "./wallet-adapter.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Flash Terminal | AI-Powered Perpetual Trading",
    template: "%s | Flash Terminal",
  },
  description:
    "Chat-first perpetual trading terminal for SOL, BTC, ETH and 20+ markets on Solana. Instant execution, real-time PnL, AI-powered trade analysis.",
  keywords: ["perpetual trading", "solana", "defi", "flash trade", "AI trading", "SOL", "BTC", "ETH"],
  authors: [{ name: "Flash Trade" }],
  creator: "Flash Trade",
  openGraph: {
    type: "website",
    locale: "en_US",
    title: "Flash Terminal | AI-Powered Perpetual Trading",
    description: "Chat-first perpetual trading on Solana. 20+ markets, instant execution, AI-powered analysis.",
    siteName: "Flash Terminal",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Flash Terminal — AI-Powered Perpetual Trading",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Flash Terminal | AI-Powered Perpetual Trading",
    description: "Chat-first perpetual trading on Solana. 20+ markets, instant execution.",
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  metadataBase: new URL("https://app.flash.trade"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      style={{ height: "100dvh" }}
    >
      <body className="h-full">{children}</body>
    </html>
  );
}
