"use client";

// Owner: A. "Add to calendar" menu (Google Calendar / Apple & Outlook .ics) and a compact inline
// version for success toasts. Helpers are in lib/calendar.ts.

import { useEffect } from "react";
import { CalendarPlus } from "lucide-react";
import { swivelLogo } from "@/lib/brand-motion"; // D: logo swivel on purchase
import { downloadIcs, googleCalendarUrl, type CalendarEvent } from "@/lib/calendar";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const openGoogle = (event: CalendarEvent) => window.open(googleCalendarUrl(event), "_blank", "noopener");

export function AddToCalendar({
  event,
  defaultOpen = false,
  size = "sm",
  className,
}: {
  event: CalendarEvent;
  /** Open the menu on mount (deep link `?calendar=1`). */
  defaultOpen?: boolean;
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <DropdownMenu defaultOpen={defaultOpen}>
      <DropdownMenuTrigger className={cn(buttonVariants({ size, variant: "outline" }), className)}>
        <CalendarPlus /> Add to calendar
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onClick={() => openGoogle(event)}>Google Calendar</DropdownMenuItem>
        <DropdownMenuItem onClick={() => downloadIcs(event)}>Apple &amp; Outlook (.ics)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Two plain links, for places a popup menu doesn't fit (toasts). */
export function CalendarLinks({ event }: { event: CalendarEvent }) {
  // D: these links only render in purchase-success toasts, so mounting = a purchase landed: spin the logo.
  useEffect(() => swivelLogo(), []);
  const link = "underline underline-offset-2 hover:text-foreground";
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-2 text-xs">
      <CalendarPlus className="size-3.5" aria-hidden />
      <span>Add to calendar:</span>
      <button type="button" className={link} onClick={() => openGoogle(event)}>Google</button>
      <span aria-hidden>·</span>
      <button type="button" className={link} onClick={() => downloadIcs(event)}>Apple / Outlook</button>
    </span>
  );
}
