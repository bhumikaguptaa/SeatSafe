// LLM calls for standing-order parsing, scam detection and dispute summaries.
// Keyword / rule parsers always run. A missing API key or a failed call falls back to them.

import { assessMessageRisk, type RiskVerdict } from "@/lib/scam-rules";
import { parseStandingOrderText, type ParsedStandingOrder } from "@/lib/parse-standing-order";
import type { Event } from "@/lib/types";

interface ChatMessageLite {
  role: "user" | "assistant";
  content: string;
}

function provider(): "openai" | "anthropic" | null {
  const choice = process.env.LLM_PROVIDER?.toLowerCase();
  if (choice === "openai" && process.env.OPENAI_API_KEY) return "openai";
  if (choice === "anthropic" && process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  return null;
}

export function llmConfigured(): boolean {
  return provider() !== null;
}

async function complete(system: string, user: string): Promise<string | null> {
  const which = provider();
  if (!which) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    if (which === "openai") {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: process.env.OPENAI_MODEL || "gpt-4o-mini",
          temperature: 0,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
      });
      if (!res.ok) return null;
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return json.choices?.[0]?.message?.content ?? null;
    }
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-latest",
        max_tokens: 500,
        temperature: 0,
        system,
        messages: [{ role: "user", content: user } satisfies ChatMessageLite],
      }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { content?: { text?: string }[] };
    return json.content?.map((c) => c.text ?? "").join("") || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function jsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function parseOrderWithLlm(text: string, events: Event[], nowMs = Date.now()): Promise<ParsedStandingOrder> {
  const fallback = parseStandingOrderText(text, events, nowMs);
  const catalog = events.map((e) => ({ id: e.id, title: e.title, startsAt: e.startsAt })).slice(0, 40);
  const raw = await complete(
    "You convert a fan's ticket request into JSON. Reply with JSON only, no markdown. Keys: eventId (string, one of the catalog ids, or null), quantity (integer), maxPrice (number or null), minRating (number 0-5 or null), deadline (ISO-8601 string or null). Do not invent an event id.",
    JSON.stringify({ request: text, catalog, now: new Date(nowMs).toISOString() }),
  );
  const parsed = jsonObject(raw);
  if (!parsed) return fallback;
  const eventId = typeof parsed.eventId === "string" && events.some((e) => e.id === parsed.eventId) ? parsed.eventId : fallback.eventId;
  const quantity = Number(parsed.quantity);
  const maxPrice = parsed.maxPrice === null ? null : Number(parsed.maxPrice);
  const minRating = parsed.minRating === null ? null : Number(parsed.minRating);
  const deadline = typeof parsed.deadline === "string" && !Number.isNaN(Date.parse(parsed.deadline)) ? new Date(parsed.deadline).toISOString() : fallback.deadline;
  return {
    eventId,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.min(8, Math.floor(quantity)) : fallback.quantity,
    maxPrice: maxPrice !== null && Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : fallback.maxPrice,
    minRating: minRating !== null && Number.isFinite(minRating) ? Math.min(5, Math.max(0, minRating)) : fallback.minRating,
    deadline,
  };
}

export async function assessWithLlm(body: string): Promise<RiskVerdict> {
  const floor = assessMessageRisk(body);
  if (floor.risk === "high") return floor;
  const raw = await complete(
    'You screen a ticket-marketplace chat message. Reply with JSON only: {"risk":"low"|"high","reason":string}. High means off-app payment (Zelle, Venmo, Cash App, PayPal, wire, gift card), a link, or pressure to leave the app. Ordinary scheduling is low.',
    body.slice(0, 2000),
  );
  const parsed = jsonObject(raw);
  if (parsed?.risk === "high" && typeof parsed.reason === "string" && parsed.reason.trim()) {
    return { risk: "high", reason: parsed.reason.trim().slice(0, 240) };
  }
  return floor;
}

export async function summarizeDispute(messages: { sender: string; body: string; risk: string }[]): Promise<string> {
  const transcript = messages
    .map((m) => `${m.sender}${m.risk === "high" ? " [flagged]" : ""}: ${m.body}`)
    .join("\n")
    .slice(0, 6000);
  const raw = await complete(
    "You write a 3-5 sentence dispute summary for a ticket escrow. Mention who asked to pay off-app, whether a ticket was claimed sent, and what is still unresolved. Plain English. No bullet characters. Reply with JSON {\"summary\": string}.",
    transcript || "No messages.",
  );
  const parsed = jsonObject(raw);
  if (typeof parsed?.summary === "string" && parsed.summary.trim()) return parsed.summary.trim();
  const flagged = messages.filter((m) => m.risk === "high").length;
  if (messages.length === 0) return "No chat messages are on file for this order.";
  return `This order has ${messages.length} chat message${messages.length === 1 ? "" : "s"}${flagged ? `, ${flagged} flagged as a possible off-app payment or pressure tactic` : ""}. The vault still follows the onchain deadline: the buyer is refunded, bond included, if the ticket never arrives.`;
}
