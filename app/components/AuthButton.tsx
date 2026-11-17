"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { Check, Copy, ExternalLink, Loader2, LogIn, LogOut, Ticket } from "lucide-react";
import { PRIVY_ENABLED } from "@/lib/privy";
import { explorerAddress } from "@/lib/solana";
import { shortAddress, useSolanaWallet } from "@/lib/useSolanaWallet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AuthButton() {
  if (!PRIVY_ENABLED) {
    return (
      <Button size="sm" disabled title="Add NEXT_PUBLIC_PRIVY_APP_ID to enable login">
        <LogIn /> Log in
      </Button>
    );
  }
  return <PrivyAuthButton />;
}

// Only rendered inside PrivyProvider.
function PrivyAuthButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { address } = useSolanaWallet();
  const router = useRouter();
  const [copied, setCopied] = useState(false);

  if (!ready) return <Skeleton className="h-7 w-20" />;

  if (!authenticated) {
    return (
      <Button size="sm" onClick={() => login()}>
        <LogIn /> Log in
      </Button>
    );
  }

  const email = user?.email?.address ?? user?.google?.email ?? "Account";

  const copyAddress = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.warn("Copy failed", err);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <Avatar className="size-7">
          <AvatarFallback>{email.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {/* Base UI's GroupLabel must sit inside a Group (error #31 otherwise). */}
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {address ? (
          <>
            <DropdownMenuItem closeOnClick={false} onClick={copyAddress} title={address}>
              {copied ? <Check className="text-released" /> : <Copy />}
              <span className="font-mono">{shortAddress(address)}</span>
              <span className="ml-auto text-xs text-muted-foreground">{copied ? "Copied" : "Copy"}</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              render={<a href={explorerAddress(address)} target="_blank" rel="noopener noreferrer" />}
            >
              <ExternalLink /> View on Solana Explorer (devnet)
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem disabled>
            <Loader2 className="animate-spin" /> Creating wallet…
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/tickets")}>
          <Ticket /> My tickets
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => logout()}>
          <LogOut /> Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
