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

// Browser extensions (e.g. MetaMask's inpage.js: "Failed to connect to MetaMask") inject scripts that can
// throw on their own. The app never uses them, but the Next.js dev overlay reports every uncaught page error.
// This capture-phase listener runs before the overlay's and stops errors whose stack is entirely extension
// code. They still appear in the browser console; errors from app code are untouched.
const IGNORE_EXTENSION_ERRORS = `(() => {
  const ext = /(chrome|moz|safari(-web)?)-extension:\\/\\//;
  const fromExtension = (err, file) => {
    if (file && ext.test(file)) return true;
    const stack = err && typeof err.stack === "string" ? err.stack : "";
    if (!stack || !ext.test(stack)) return false;
    return stack.split("\\n").filter((l) => /^\\s*at |@/.test(l)).every((l) => ext.test(l));
  };
  addEventListener("unhandledrejection", (e) => {
    if (fromExtension(e.reason)) e.stopImmediatePropagation();
  }, true);
  addEventListener("error", (e) => {
    if (fromExtension(e.error, e.filename)) e.stopImmediatePropagation();
  }, true);
})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark theme by default.
    <html
      lang="en"
      className={`dark ${manrope.variable} ${oxanium.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: IGNORE_EXTENSION_ERRORS }} />
      </head>
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
