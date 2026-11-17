// Owner: A. Program errors -> short messages for users. Source of truth: docs/program.md "Errors"
// (codes 6000-6018, same order as the IDL). Show with toastError() from lib/tx-toast.

import idl from "./idl/seatsafe.json";

export type ProgramErrorName =
  | "AboveResaleCap" | "DeadlineNotReached" | "DeadlinePassed" | "InvalidState" | "Unauthorized"
  | "SoldOut" | "BuyerIsSeller" | "PriceAboveMax" | "RatingTooLow" | "MathOverflow"
  | "InvalidResaleCap" | "InvalidRoyalty" | "InvalidBps" | "InvalidAmount" | "InvalidWindow"
  | "SeatTooLong" | "TicketNotHeld" | "WrongEvent" | "OrderFilled";

/** Values the UI already has, used to make messages specific. All optional. */
export interface ErrorContext {
  resaleCapUsd?: number | null;
  priceUsd?: number;
  maxPriceUsd?: number;
  feePct?: number;
  quantity?: number;
  /** Which escrow step was attempted, for deadline messages. */
  action?: "refund" | "release" | "markSent" | "dispute" | "timeout";
}

const usd = (n: number) => `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`;

const MESSAGES: Record<ProgramErrorName, (c: ErrorContext) => string> = {
  AboveResaleCap: (c) =>
    c.resaleCapUsd != null
      ? `This artist caps resale at ${usd(c.resaleCapUsd)}. Lower your price to ${usd(c.resaleCapUsd)} or less.`
      : "That price is above this event's resale cap.",
  DeadlineNotReached: (c) =>
    c.action === "refund"
      ? "Not yet: the seller still has time to send the ticket."
      : c.action === "release"
        ? "Not yet: the buyer still has time to confirm."
        : c.action === "timeout"
          ? "Not yet: the arbiter still has time to decide this dispute."
          : "Not yet. Try again after the deadline.",
  DeadlinePassed: (c) =>
    c.action === "markSent"
      ? "Too late: the ship deadline has passed, so the buyer can claim a refund."
      : c.action === "dispute"
        ? "Too late to open a dispute: the deadline has passed."
        : "Too late: the deadline for this step has passed.",
  InvalidState: () => "This order has already moved on. Refresh to see its current status.",
  Unauthorized: () => "Only the buyer, seller or arbiter of this order can do that.",
  SoldOut: () => "Sold out. Check resale listings for this event.",
  BuyerIsSeller: () => "You can't buy your own ticket.",
  PriceAboveMax: (c) =>
    c.priceUsd != null && c.maxPriceUsd != null
      ? `Listing at ${usd(c.priceUsd)} is above your max of ${usd(c.maxPriceUsd)}.`
      : "That listing is above your max price.",
  RatingTooLow: () => "Seller's rating is below your minimum.",
  MathOverflow: () => "Those numbers are too large. Try a smaller amount or time window.",
  InvalidResaleCap: (c) =>
    c.priceUsd != null
      ? `The resale cap must be at least the ticket price (${usd(c.priceUsd)}).`
      : "The resale cap must be at least the ticket price.",
  InvalidRoyalty: (c) =>
    `Royalty is too high: royalty plus the ${c.feePct ?? 3}% platform fee can't exceed 50%.`,
  InvalidBps: () => "Percentage must be between 0% and 100%.",
  InvalidAmount: () => "Enter an amount greater than zero.",
  InvalidWindow: () => "Choose a time window longer than zero.",
  SeatTooLong: () => "Seat label is too long (max 32 characters).",
  TicketNotHeld: () => "You don't hold this ticket anymore. Refresh your tickets.",
  WrongEvent: () => "That listing is for a different event.",
  OrderFilled: (c) =>
    c.quantity != null
      ? `Your agent already bought all ${c.quantity} tickets for this order.`
      : "This standing order is already filled.",
};

const BY_CODE = new Map<number, ProgramErrorName>(
  (idl.errors as { code: number; name: string }[]).map((e) => [e.code, e.name as ProgramErrorName]),
);

export interface FriendlyError {
  message: string;
  /** Program error name, if we recognised one. */
  name?: ProgramErrorName;
  /** Present when the transaction was sent (show an explorer link). */
  signature?: string;
}

/** Thrown by sendWithRelayer: carries the program logs and, if it got that far, the signature. */
export class TxError extends Error {
  constructor(
    message: string,
    public logs: string[] = [],
    public signature?: string,
  ) {
    super(message);
    this.name = "TxError";
  }
}

/** Finds the program error in Anchor logs or a "custom program error: 0x..." message. */
export function programErrorName(err: unknown): ProgramErrorName | undefined {
  const texts: string[] = [];
  if (err instanceof TxError) texts.push(err.message, ...err.logs);
  else if (err instanceof Error) texts.push(err.message);
  else texts.push(String(err));
  const e = err as { logs?: unknown; error?: { errorCode?: { code?: string } } };
  if (Array.isArray(e?.logs)) texts.push(...e.logs.map(String));
  if (e?.error?.errorCode?.code) texts.push(`Error Code: ${e.error.errorCode.code}.`);

  for (const t of texts) {
    const named = /Error Code: (\w+)\./.exec(t);
    if (named && named[1] in MESSAGES) return named[1] as ProgramErrorName;
    const hex = /custom program error: 0x([0-9a-f]+)/i.exec(t);
    if (hex) {
      const name = BY_CODE.get(parseInt(hex[1], 16));
      if (name) return name;
    }
  }
  return undefined;
}

export function friendlyError(err: unknown, ctx: ErrorContext = {}): FriendlyError {
  const signature = err instanceof TxError ? err.signature : undefined;
  const name = programErrorName(err);
  if (name) return { message: MESSAGES[name](ctx), name, signature };

  const raw = err instanceof Error ? err.message : String(err);
  if (/user rejected|rejected the request|cancel/i.test(raw)) {
    return { message: "You cancelled the request.", signature };
  }
  // SPL Token's InsufficientFunds is custom error 0x1 (not one of ours: those start at 0x1770).
  const logs = err instanceof TxError ? err.logs.join("\n") : "";
  if (/insufficient (funds|lamports)|custom program error: 0x1\b/i.test(`${raw}\n${logs}`)) {
    return { message: "Not enough USDC in your wallet for this.", signature };
  }
  if (/AccountNotInitialized|could not find account|Account does not exist/i.test(raw)) {
    return {
      message: "Your wallet has no USDC account yet. Get devnet USDC at faucet.circle.com first.",
      signature,
    };
  }
  return { message: "Something went wrong.", signature };
}
