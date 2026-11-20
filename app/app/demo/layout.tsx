// Page title for /demo (polish pass: one title per route, "<page> · SeatSafe").
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Judge mode" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
