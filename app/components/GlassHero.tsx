import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Owner: D. Hero card for Discover's featured event, the order tracker's money card and the gate pass.
// Orange theme (Nov 19): a flat SOLID surface (#1A1A1A, thin #333333 border; no glass or blur). `brand` swaps
// in the brand gradient (globals.css `bg-brand`), which is used in only two places: the Discover featured
// card and the order-page vault. The name is kept so existing imports keep working.

export function GlassHero({
  className,
  children,
  as: Tag = "div",
  brand = false,
}: {
  className?: string;
  children: ReactNode;
  as?: "div" | "section" | "article";
  /** Brand gradient background (use rarely: Discover featured card, order-page vault). */
  brand?: boolean;
}) {
  return (
    <Tag
      className={cn(
        "relative isolate overflow-hidden rounded-3xl border",
        brand ? "border-0 bg-brand" : "border-border bg-card",
        className,
      )}
    >
      {children}
    </Tag>
  );
}
