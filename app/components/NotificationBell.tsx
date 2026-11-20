"use client";

// Owner: A. Nav bell for Stream-triggered notifications (supabase notifications, written by
// lib/server/notify.ts when the QuickNode Stream delivers an event). Realtime INSERTs for the logged-in
// wallet show a toast and bump the badge; 15 s poll if Realtime isn't connected. "Mark all read" is
// remembered per device (localStorage), since clients can't write rows (Privy login, not Supabase Auth).

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { USE_MOCK } from "@/lib/chain";
import { supabase } from "@/lib/supabase";
import { useTxWallet } from "@/lib/tx";
import { useNow } from "@/lib/use-chain";
import { explorerTx } from "@/lib/solana";
import { notifications as mockNotifications } from "@/lib/mock";
import type { AppNotification } from "@/lib/notifications";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const seenKey = (wallet: string) => `seatsafe:notifications-seen:${wallet}`;
function readSeen(wallet: string): string {
  try {
    return localStorage.getItem(seenKey(wallet)) ?? "";
  } catch {
    return "";
  }
}
function writeSeen(wallet: string, iso: string) {
  try {
    localStorage.setItem(seenKey(wallet), iso);
  } catch {
    // private mode / blocked storage: unread state just resets on reload
  }
}

function ago(iso: string, now: number): string {
  if (!now) return "";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const txWallet = useTxWallet();
  const wallet = USE_MOCK ? "user_me" : txWallet?.address.toBase58() ?? null;
  const now = useNow();
  const [items, setItems] = useState<AppNotification[]>(USE_MOCK ? mockNotifications : []);
  // Bumped by "Mark all read"; the value itself lives in localStorage (wallet is only known in the browser).
  const [seenBump, setSeenBump] = useState(0);
  const seen = useMemo(() => (wallet && typeof window !== "undefined" ? readSeen(wallet) : ""), [wallet, seenBump]); // eslint-disable-line react-hooks/exhaustive-deps -- seenBump re-reads storage

  const load = useCallback(async () => {
    if (!supabase || !wallet || USE_MOCK) return;
    const { data, error } = await supabase
      .from("notifications")
      .select("*")
      .eq("wallet", wallet)
      .order("created_at", { ascending: false })
      .limit(20);
    if (!error && data) setItems(data as AppNotification[]);
  }, [wallet]);

  useEffect(() => {
    if (USE_MOCK || !supabase || !wallet) return;
    const db = supabase;
    const first = setTimeout(() => void load(), 0);
    let subscribed = false;
    const channel = db
      .channel(`notifications:${wallet}#${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `wallet=eq.${wallet}` }, (payload) => {
        const n = payload.new as AppNotification;
        setItems((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, 20)));
        toast(`🔔 ${n.title}`, {
          description: n.body || undefined,
          duration: 8000,
          action: n.url ? { label: "Open", onClick: () => router.push(n.url!) } : undefined,
        });
      })
      .subscribe((status) => {
        subscribed = status === "SUBSCRIBED";
      });
    const poll = setInterval(() => {
      if (!subscribed) void load();
    }, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(poll);
      void db.removeChannel(channel);
    };
  }, [wallet, load, router]);

  const unread = useMemo(() => items.filter((n) => !n.read_at && n.created_at > seen).length, [items, seen]);
  const markAllRead = () => {
    if (!wallet || !items[0]) return;
    writeSeen(wallet, items[0].created_at);
    setSeenBump((n) => n + 1);
  };

  if (!wallet) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "relative")}
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-accent-pink px-1 text-[10px] leading-4 font-bold text-black">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between px-1.5 py-1">
          <DropdownMenuLabel className="p-0">Notifications</DropdownMenuLabel>
          {unread > 0 && (
            <button type="button" onClick={markAllRead} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
              Mark all read
            </button>
          )}
        </div>
        <DropdownMenuSeparator />
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing yet. Sales, refunds and deliveries show up here instantly.</p>
        ) : (
          items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              onClick={() => n.url && router.push(n.url)}
              className="flex items-start gap-2 py-2"
            >
              <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", !n.read_at && n.created_at > seen ? "bg-primary" : "bg-transparent")} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-snug font-medium">{n.title}</span>
                {n.body && <span className="block text-xs text-muted-foreground">{n.body}</span>}
                <span className="block text-[11px] text-muted-foreground">{ago(n.created_at, now)}</span>
              </span>
              {n.tx_signature && (
                <a
                  href={explorerTx(n.tx_signature)}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                  aria-label="View transaction on Solana Explorer"
                >
                  <ExternalLink className="size-3.5" />
                </a>
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
