import { timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function presentedSecret(req: NextRequest): string {
  const header = req.headers.get("x-webhook-secret") || req.headers.get("x-qn-token") || "";
  if (header) return header;
  const auth = req.headers.get("authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return req.nextUrl.searchParams.get("secret") || req.nextUrl.searchParams.get("token") || "";
}

/**
 * QuickNode should send STREAM_WEBHOOK_SECRET in `x-webhook-secret` (or as `?secret=`).
 * With no secret configured, local dev is open and production is closed.
 */
export function webhookAuthorized(req: NextRequest): { ok: true } | { ok: false; error: string } {
  const expected = process.env.STREAM_WEBHOOK_SECRET?.trim() ?? "";
  if (!expected) {
    if (process.env.NODE_ENV === "production") {
      return { ok: false, error: "STREAM_WEBHOOK_SECRET is not set" };
    }
    return { ok: true };
  }
  const got = presentedSecret(req);
  if (!got || !same(got, expected)) return { ok: false, error: "Invalid webhook secret" };
  return { ok: true };
}

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Local dev with no secret is allowed. */
export function cronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET?.trim() ?? "";
  const header = req.headers.get("authorization") || "";
  const alt = req.headers.get("x-cron-secret") || "";
  const presented = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : alt;
  if (!expected) return process.env.NODE_ENV !== "production";
  return presented.length > 0 && same(presented, expected);
}
