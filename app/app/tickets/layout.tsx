// Page title for /tickets (polish pass: one title per route, "<page> · SeatSafe").
import type { Metadata } from "next";

export const metadata: Metadata = { title: "My tickets" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
