// Owner: A. "Add to calendar" for a ticket's event: a Google Calendar link and an RFC 5545 .ics file
// (Apple Calendar, Outlook). Pure functions, no React; components/AddToCalendar.tsx is the UI.

import type { Event } from "./types";

export type CalendarEvent = Pick<Event, "id" | "title" | "startsAt" | "venue" | "city">;

/** Events don't store an end time onchain; assume 3 hours. */
export const DEFAULT_DURATION_MS = 3 * 60 * 60 * 1000;

/** Absolute origin for links inside the calendar entry. */
export function appOrigin(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}

export function eventUrl(event: Pick<Event, "id">, origin = appOrigin()): string {
  return `${origin}/events/${encodeURIComponent(event.id)}`;
}

/** 2026-12-16T00:00:00.000Z -> 20261216T000000Z (UTC "basic" format, used by both Google and iCalendar). */
export function toUtcStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function times(event: CalendarEvent) {
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid event start: ${event.startsAt}`);
  return { start, end: new Date(start.getTime() + DEFAULT_DURATION_MS) };
}

const location = (e: CalendarEvent) => [e.venue, e.city].filter(Boolean).join(", ");
const description = (e: CalendarEvent, origin: string) =>
  `Your SeatSafe ticket: ${eventUrl(e, origin)}\nOpen My tickets on SeatSafe for your gate pass.`;

/** Google Calendar "create event" link. */
export function googleCalendarUrl(event: CalendarEvent, origin = appOrigin()): string {
  const { start, end } = times(event);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toUtcStamp(start)}/${toUtcStamp(end)}`,
    details: description(event, origin),
    location: location(event),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** RFC 5545 TEXT escaping: backslash, semicolon, comma, newline. */
function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 §3.1: lines longer than 75 octets are folded with CRLF + one space. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = "";
  let octets = 0;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    const limit = out.length === 0 ? 75 : 74; // continuation lines start with a space
    if (octets + n > limit) {
      out.push(cur);
      cur = "";
      octets = 0;
    }
    cur += ch;
    octets += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

/** A complete .ics file (VCALENDAR with one VEVENT and a reminder 24 h before). CRLF line endings. */
export function icsFile(event: CalendarEvent, origin = appOrigin(), now = new Date()): string {
  const { start, end } = times(event);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SeatSafe//Tickets//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@seatsafe`,
    `DTSTAMP:${toUtcStamp(now)}`,
    `DTSTART:${toUtcStamp(start)}`,
    `DTEND:${toUtcStamp(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `LOCATION:${escapeText(location(event))}`,
    `DESCRIPTION:${escapeText(description(event, origin))}`,
    `URL:${eventUrl(event, origin)}`,
    "BEGIN:VALARM",
    "TRIGGER:-PT24H",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`Tomorrow: ${event.title}`)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
}

/** Browser only: downloads seatsafe-<slug>.ics. */
export function downloadIcs(event: CalendarEvent): void {
  const blob = new Blob([icsFile(event)], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `seatsafe-${slugify(event.title)}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
