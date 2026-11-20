// Page title for /orders (polish pass: one title per route, "<page> · SeatSafe").
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Your order" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
