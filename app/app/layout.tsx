import type { Metadata, Viewport } from "next";
import { Geist_Mono, Manrope } from "next/font/google";
import "./globals.css";
import { Providers } from "@/lib/privy";
import { TopNav, BottomTabs } from "@/components/AppNav";
import { Toaster } from "@/components/ui/sonner";

const manrope = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
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
  themeColor: "#a4bdfd",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // Dark theme by default.
    <html
      lang="en"
      className={`dark ${manrope.variable} ${geistMono.variable} h-full antialiased`}
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
