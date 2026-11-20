// Page title for /scan (polish pass: one title per route, "<page> · SeatSafe").
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Scan to buy" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
