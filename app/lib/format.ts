// Display formatting helpers. Users only ever see dollars, never token units.

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 95 -> "$95.00" */
export function formatUsd(amount: number): string {
  return usd.format(amount);
}

/**
 * Milliseconds left -> "1h 59m 03s" (or "2d 4h" when over a day). Returns "Expired" at or below 0.
 * The caller owns the ticking (e.g. a 1 s interval), so this stays a pure function.
 */
export function formatCountdown(msLeft: number): string {
  if (msLeft <= 0) return "Expired";
  const totalSeconds = Math.floor(msLeft / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${pad(minutes)}m ${pad(seconds)}s`;
  return `${minutes}m ${pad(seconds)}s`;
}

/**
 * ISO -> "Sat, Nov 21 · 8:00 PM". Defaults to US Central so server and client render the same text
 * (all demo events are in Texas). Pass another IANA zone if needed.
 */
export function formatDate(iso: string, timeZone = "America/Chicago"): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  return `${day} · ${time}`;
}
