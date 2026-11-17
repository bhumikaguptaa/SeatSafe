// Keyword floor for the chat scam detector. The server runs this AND an LLM.
// A keyword hit is always "high", even if the model says low. The order chat uses
// the same rules for the live draft warning, so the banner and the preview match.

export interface RiskVerdict {
  risk: "low" | "high";
  reason?: string;
}

const RULES: { pattern: RegExp; reason: string }[] = [
  { pattern: /\bzelle\b/i, reason: "Asks to pay with Zelle, outside SeatSafe." },
  { pattern: /\bvenmo\b/i, reason: "Asks to pay with Venmo, outside SeatSafe." },
  { pattern: /\bcash\s?app\b|\$[a-z][a-z0-9_]{2,}/i, reason: "Asks to pay with Cash App, outside SeatSafe." },
  { pattern: /\bpaypal\b/i, reason: "Asks to pay with PayPal, outside SeatSafe." },
  { pattern: /\b(wire|western union|moneygram|gift\s?cards?)\b/i, reason: "Asks for a payment method SeatSafe cannot protect." },
  { pattern: /\b(apple pay|google pay|cash only|pay me|send me the money)\b/i, reason: "Asks to pay outside the SeatSafe vault." },
  { pattern: /\b(whatsapp|telegram|signal|dm me|text me|email me)\b/i, reason: "Tries to move the deal off SeatSafe chat." },
  {
    pattern: /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(?:com|net|org|io|ly|me|app|co|xyz|link)\b/i,
    reason: "Contains a link. Links in chat can lead to fake ticket or payment pages.",
  },
  {
    pattern: /\b(hurry|right now|last chance|act fast|don't tell|do not tell|no time|asap|or i(?:'| wi)ll sell)\b/i,
    reason: "Pressure tactics. A real SeatSafe sale does not need you to rush off the app.",
  },
];

/** First matching reason, or a low verdict when nothing matches. */
export function assessMessageRisk(body: string): RiskVerdict {
  const reason = RULES.find((r) => r.pattern.test(body))?.reason;
  return reason ? { risk: "high", reason } : { risk: "low" };
}
