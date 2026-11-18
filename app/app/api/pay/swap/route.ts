// Owner: A. Solana Pay transaction request for in-person resale ("Sell in person" QR at the gate).
// Spec: https://github.com/solana-labs/solana-pay/blob/master/SPEC.md#specification-transaction-request
//
//   GET  /api/pay/swap?listing=<listing PDA>   -> { label, icon }
//   POST /api/pay/swap?listing=<listing PDA>   body { account: <buyer pubkey> }
//        -> { transaction: base64, message }   the existing swap_resale, fee payer = relayer,
//           already signed by the relayer; only the buyer's signature is missing.
//
// Wallets (our /scan page, or Phantom etc.) call this cross-origin, so every response has CORS headers.
// The relayer key is read lazily; a missing/invalid key returns a clear 503 and never affects other routes.
// Same checks as /api/relay (lib/relay-policy.ts) before the relayer signs anything.

import { connection as dynamicRequest, NextResponse, type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { getProgram, pdas, swapResale, fromBaseUnits } from "@/lib/program";
import { checkRelayTx } from "@/lib/relay-policy";
import { friendlyError, TxError } from "@/lib/errors";
import { connection, PROGRAM_ID } from "@/lib/solana";
import { loadRelayer } from "@/lib/server/relayer";
import { formatUsd } from "@/lib/format";
import idl from "@/lib/idl/seatsafe.json";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Accept-Encoding",
};

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { ...CORS, "Content-Type": "application/json" } });
/** Solana Pay wallets show `error`/`message`; keep both short and human. */
const fail = (status: number, message: string) => json({ error: message, message }, status);

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  await dynamicRequest();
  const origin = new URL(req.url).origin;
  return json({ label: "SeatSafe", icon: `${origin}/seatsafe-icon.svg` });
}

function parseKey(value: unknown): PublicKey | null {
  if (typeof value !== "string") return null;
  try {
    return new PublicKey(value);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  await dynamicRequest();
  const listingKey = parseKey(new URL(req.url).searchParams.get("listing"));
  if (!listingKey) return fail(400, "This QR code has no valid SeatSafe listing.");

  const body = (await req.json().catch(() => null)) as { account?: unknown } | null;
  const buyer = parseKey(body?.account);
  if (!buyer) return fail(400, "Missing or invalid `account` (the buyer's wallet address).");

  const relayer = loadRelayer();
  if (!relayer) {
    const why = process.env.RELAYER_SECRET_KEY?.trim() ? "RELAYER_SECRET_KEY is set but invalid" : "RELAYER_SECRET_KEY not configured";
    return fail(503, `Gas sponsorship is unavailable (${why}).`);
  }

  const program = getProgram(connection, PROGRAM_ID ?? new PublicKey(idl.address));
  const listing = await program.account.listing.fetchNullable(listingKey).catch(() => null);
  if (!listing) return fail(410, "This ticket was already sold or the listing was cancelled.");
  if (listing.seller.equals(buyer)) return fail(400, "You're the seller of this ticket. Scan with the buyer's wallet.");

  const [event, record] = await Promise.all([
    program.account.event.fetch(listing.event),
    program.account.ticketRecord.fetchNullable(pdas(program.programId).ticketRecord(listing.ticketMint)),
  ]);
  const price = fromBaseUnits(listing.price);
  const cap = fromBaseUnits(event.resaleCap);
  if (price > cap) return fail(400, `Listed above the artist's ${formatUsd(cap)} cap. SeatSafe won't sell it.`);

  let built;
  try {
    built = await swapResale({ program, user: buyer, payer: relayer.publicKey }, { ticketMint: listing.ticketMint });
  } catch (err) {
    return fail(500, friendlyError(err).message);
  }

  const verdict = checkRelayTx(built.tx, relayer.publicKey, program.programId, { requireOtherSignatures: false });
  if (!verdict.ok) return fail(500, `Rejected by relay policy: ${verdict.reason}`);

  // Catch "not enough USDC" etc. now, as a friendly message, instead of a failed send in the wallet.
  const sim = await connection.simulateTransaction(built.tx, { sigVerify: false, replaceRecentBlockhash: false });
  if (sim.value.err) {
    // "insufficient funds" = some USDC but too little; AccountNotInitialized on buyer_usdc = no USDC account yet.
    if ((sim.value.logs ?? []).some((l) => /insufficient funds|account: buyer_usdc\. Error Code: AccountNotInitialized/i.test(l))) {
      return fail(400, `Not enough USDC in this wallet: the ticket costs ${formatUsd(price)}.`);
    }
    return fail(400, friendlyError(new TxError("Simulation failed", sim.value.logs ?? []), { resaleCapUsd: cap }).message);
  }

  built.tx.sign([relayer]); // fee payer signs; the buyer's signature slot stays empty
  const seat = record?.seat || "General admission";
  return json({
    transaction: Buffer.from(built.tx.serialize()).toString("base64"),
    message: `Buying ${seat} for ${formatUsd(price)}. Protected by SeatSafe.`,
  });
}
