// Page title for /agent (polish pass: one title per route, "<page> · SeatSafe").
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agent" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
