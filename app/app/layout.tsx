import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope, Oxanium } from "next/font/google";
import "./globals.css";
import { Providers } from "@/lib/privy";
import { TopNav, BottomTabs } from "@/components/AppNav";
import { Toaster } from "@/components/ui/sonner";
import { WaveBackground } from "@/components/WaveBackground"; // D: animated wireframe wave behind every page

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

export const metadata: Metadata = {
  title: "SeatSafe",
  description: "Tickets you can trust. Fair resale, protected payments.",
};

export const viewport: Viewport = {
  themeColor: "#000000",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark theme by default.
    <html
      lang="en"
      className={`dark ${manrope.variable} ${oxanium.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <WaveBackground />
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
