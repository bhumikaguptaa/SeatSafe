"use client";

import { useRouter } from "next/navigation";
import { usePrivy } from "@privy-io/react-auth";
import { LogIn, LogOut, Ticket } from "lucide-react";
import { PRIVY_ENABLED } from "@/lib/privy";
import { Button, buttonVariants } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
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
  const router = useRouter();

  if (!ready) return <Skeleton className="h-7 w-20" />;

  if (!authenticated) {
    return (
      <Button size="sm" onClick={() => login()}>
        <LogIn /> Log in
      </Button>
    );
  }

  const label = user?.email?.address ?? user?.google?.email ?? "Account";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className={buttonVariants({ variant: "ghost", size: "icon" })}
      >
        <Avatar className="size-7">
          <AvatarFallback>{label.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
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
