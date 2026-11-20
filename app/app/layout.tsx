import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope, Oxanium } from "next/font/google";
import "./globals.css";
import { Providers } from "@/lib/privy";
import { TopNav, BottomTabs } from "@/components/AppNav";
import { Toaster } from "@/components/ui/sonner";

const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

// D: headings use Motech (public/fonts, see globals.css); Oxanium is the free stand-in until the file is added.
const oxanium = Oxanium({
  variable: "--font-oxanium",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://seat-safe-chi.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "SeatSafe", template: "%s · SeatSafe" },
  description: "Your money only moves when the ticket does. Fair resale capped by the artist, outside tickets held in escrow.",
  applicationName: "SeatSafe",
  openGraph: {
    title: "SeatSafe",
    description: "Your money only moves when the ticket does.",
    siteName: "SeatSafe",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: "SeatSafe", description: "Your money only moves when the ticket does." },
};

export const viewport: Viewport = {
  themeColor: "#0B0B0F",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark theme by default.
    <html
      lang="en"
      className={`dark ${manrope.variable} ${oxanium.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Providers>
          <TopNav />
          {/* bottom padding leaves room for the mobile tab bar */}
          <main className="flex flex-1 flex-col pb-20 md:pb-0">{children}</main>
          <BottomTabs />
          <Toaster theme="dark" />
        </Providers>
      </body>
    </html>
  );
}
