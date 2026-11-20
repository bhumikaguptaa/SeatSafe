// Display formatting helpers. Users only ever see dollars, never token units.

/**
 * One price format everywhere: whole dollars without cents ("$75"), otherwise two decimals ("$75.50").
 * Never "$75.00". Thousands get separators ("$1,240").
 */
export function formatUsd(amount: number): string {
  const n = Math.round(amount * 100) / 100;
  const whole = Number.isInteger(n);
  return `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  })}`;
}

/**
 * Relative time: "just now" under a minute, then "4m ago", "13h ago", "2d ago" (no space).
 * `now` comes from useNow() and is 0 during prerender, so nothing is shown until mounted.
 */
export function timeAgo(iso: string, now: number): string {
  if (!now) return "";
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

/** Base58 address -> "7fnV…jypy". */
export function shortAddress(address: string, chars = 4): string {
  return address.length <= chars * 2 + 1 ? address : `${address.slice(0, chars)}…${address.slice(-chars)}`;
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
