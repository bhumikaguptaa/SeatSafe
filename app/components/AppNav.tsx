"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, Compass, FlaskConical, MoreHorizontal, Palette, ScanLine, Tag, Ticket } from "lucide-react";
import { cn } from "@/lib/utils";
import { AuthButton } from "@/components/AuthButton";
import { UsdcBalance } from "@/components/UsdcBalance";
import { NotificationBell } from "@/components/NotificationBell";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { BrandMark } from "@/components/BrandMark"; // D: new logo (replaces the shield icon)
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Polish pass (A): "Creator" is "For artists" (route unchanged), "Live Lab" (/simulator) is in the nav with a
// green devnet dot, and phones get a 5-tab bar (Discover, Tickets, Scan, Sell, More).
const NAV_ITEMS = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/tickets", label: "My tickets", icon: Ticket },
  { href: "/scan", label: "Scan to buy", icon: ScanLine },
  { href: "/sell", label: "Sell", icon: Tag },
  { href: "/agent", label: "Agent", icon: Bot },
  { href: "/creator", label: "For artists", icon: Palette },
  { href: "/simulator", label: "Live Lab", icon: FlaskConical, devnet: true },
] as const;

const TABS = [
  { href: "/", label: "Discover", icon: Compass },
  { href: "/tickets", label: "Tickets", icon: Ticket },
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/sell", label: "Sell", icon: Tag },
] as const;
const MORE = NAV_ITEMS.filter((n) => !TABS.some((t) => t.href === n.href));

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/** Small pulsing green dot: this page runs on Solana devnet. */
function DevnetDot() {
  return (
    <span className="relative ml-1.5 inline-flex size-1.5 align-middle" title="Runs on Solana devnet" aria-label="devnet">
      <span className="absolute inline-flex size-full animate-ping rounded-full bg-released opacity-60 motion-reduce:hidden" />
      <span className="relative inline-flex size-1.5 rounded-full bg-released" />
    </span>
  );
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
    <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={isActive(pathname, item.href) ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm whitespace-nowrap text-white/80 transition-colors hover:text-white",
            isActive(pathname, item.href) && "bg-primary/15 text-white",
          )}
        >
          {item.label}
          {"devnet" in item && <DevnetDot />}
        </Link>
      ))}
    </nav>
  );
}

function MobileTabs({ pathname }: { pathname: string | null }) {
  const tab = "relative flex w-full flex-col items-center gap-0.5 py-2 text-[11px] text-[#A1A1AA]";
  const active = "text-white after:absolute after:top-0 after:h-0.5 after:w-8 after:rounded-full after:bg-primary";
  const moreActive = MORE.some((m) => isActive(pathname, m.href));
  return (
    <ul className="grid grid-cols-5">
      {TABS.map(({ href, label, icon: Icon }) => (
        <li key={href}>
          <Link href={href} aria-current={isActive(pathname, href) ? "page" : undefined} className={cn(tab, isActive(pathname, href) && active)}>
            <Icon className="size-5" aria-hidden />
            {label}
          </Link>
        </li>
      ))}
      <li>
        <DropdownMenu>
          <DropdownMenuTrigger aria-label="More pages" className={cn(tab, moreActive && active)}>
            <MoreHorizontal className="size-5" aria-hidden />
            More
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-48">
            {MORE.map((item) => (
              <DropdownMenuItem key={item.href} render={<Link href={item.href} />}>
                <item.icon aria-hidden /> {item.label}
                {"devnet" in item && <DevnetDot />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </li>
    </ul>
  );
}

/** Top bar: logo + links (desktop), balance + login (all sizes). Solid, no blur. */
export function TopNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#26262E] bg-[#0B0B0F]">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4 lg:gap-6">
        <Link href="/" aria-label="SeatSafe home" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
          <BrandMark priority swivel className="h-6" />
          <span className="font-heading text-lg tracking-wide">SeatSafe</span>
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
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-[#26262E] bg-[#0B0B0F] pb-[env(safe-area-inset-bottom)] md:hidden">
      <Suspense fallback={<MobileTabs pathname={null} />}>
        <ActiveMobileTabs />
      </Suspense>
    </nav>
  );
}
