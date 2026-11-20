// Page title for /verify (polish pass: one title per route, "<page> · SeatSafe").
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Verify a ticket" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
