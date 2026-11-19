"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Compass, Palette, ScanLine, ShieldCheck, Tag, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthButton } from "@/components/AuthButton";
import { UsdcBalance } from "@/components/UsdcBalance";
import { NotificationBell } from "@/components/NotificationBell";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const NAV_ITEMS = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/tickets", label: "My tickets", icon: Ticket },
  { href: "/scan", label: "Scan to buy", icon: ScanLine },
  { href: "/sell", label: "Sell", icon: Tag },
  { href: "/agent", label: "Agent", icon: Bot },
  { href: "/creator", label: "Creator", icon: Palette },
] as const;

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

// With Cache Components on, usePathname() must sit behind <Suspense> so dynamic routes
// (e.g. /orders/[id]) can still prerender a static shell. The Suspense fallback is the
// same links without the active highlight.
function ActiveDesktopLinks() {
  return <DesktopLinks pathname={usePathname()} />;
}

function ActiveMobileTabs() {
  return <MobileTabs pathname={usePathname()} />;
}

function DesktopLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className="hidden items-center gap-1 md:flex">
      {NAV_ITEMS.map(({ href, label }) => (
        <Link
          key={href}
          href={href}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm text-white/80 transition-colors hover:text-white",
            isActive(pathname, href) && "bg-[#1d1d24] text-white",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

function MobileTabs({ pathname }: { pathname: string | null }) {
  return (
    <ul className="grid grid-cols-5">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <Link
            href={href}
            className={cn(
              "relative flex flex-col items-center gap-0.5 py-2 text-[11px] text-muted-foreground",
              isActive(pathname, href) &&
                "text-foreground after:absolute after:top-0 after:h-0.5 after:w-8 after:rounded-full after:bg-primary",
            )}
          >
            <Icon className="size-5" />
            {label}
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Top bar: logo + links (desktop), balance + login (all sizes). */
export function TopNav() {
  return (
    // Transparent over the page gradient; the blur keeps it legible once content scrolls underneath.
    <header className="sticky top-0 z-40 border-b border-border bg-background">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <ShieldCheck className="size-5 text-white" />
          SeatSafe
        </Link>
        <Suspense fallback={<DesktopLinks pathname={null} />}>
          <ActiveDesktopLinks />
        </Suspense>
        <div className="ml-auto flex items-center gap-2">
          {/* A failure in the account area must never take down the page. */}
          <ErrorBoundary
            label="nav user area"
            fallback={
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-xs text-muted-foreground underline-offset-4 hover:underline"
              >
                Account unavailable, reload
              </button>
            }
          >
            <UsdcBalance />
            <NotificationBell />
            <AuthButton />
          </ErrorBoundary>
        </div>
      </div>
    </header>
  );
}

/** Bottom tab bar (mobile only). */
export function BottomTabs() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background md:hidden">
      <Suspense fallback={<MobileTabs pathname={null} />}>
        <ActiveMobileTabs />
      </Suspense>
    </nav>
  );
}
