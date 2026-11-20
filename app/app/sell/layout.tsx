// Page title for /sell (polish pass: one title per route, "<page> · SeatSafe").
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sell" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
