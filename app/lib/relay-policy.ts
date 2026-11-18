// Owner: B to review. Minimal relayer added by A for integration.
//
// What the relayer is willing to co-sign. Pure function (no env, no secrets) so the API route
// and the integration test script share it.
//
// The relayer's signature authorizes two things: paying the fee, and acting as the `payer`
// account (rent) in SeatSafe instructions. So besides "only allowlisted programs" we must make
// sure no instruction can move the relayer's own SOL or tokens.

import { ComputeBudgetProgram, PublicKey, SystemProgram, type VersionedTransaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

/** Max instructions per relayed transaction (our builders use at most 2). */
const MAX_INSTRUCTIONS = 6;
/** Cap on priority fees so a client can't make the relayer overpay. */
const MAX_CU_PRICE_MICROLAMPORTS = BigInt(100_000);
const MAX_CU_LIMIT = 1_400_000;

export type PolicyResult = { ok: true } | { ok: false; reason: string };

export function checkRelayTx(
  tx: VersionedTransaction,
  relayer: PublicKey,
  seatsafeProgramId: PublicKey,
  /**
   * requireOtherSignatures (default true): /api/relay receives txs the user already signed.
   * Solana Pay (/api/pay/swap) is the reverse: the relayer signs a tx WE built, and the buyer's wallet
   * signs afterwards, so the buyer's slot is still empty. Every other check still applies.
   */
  opts: { requireOtherSignatures?: boolean } = {},
): PolicyResult {
  const msg = tx.message;
  const fail = (reason: string): PolicyResult => ({ ok: false, reason });

  if (msg.addressTableLookups.length > 0) {
    return fail("address lookup tables are not allowed");
  }
  const keys = msg.staticAccountKeys;
  if (!keys[0]?.equals(relayer)) return fail("fee payer must be the relayer");

  const instructions = msg.compiledInstructions;
  if (instructions.length === 0) return fail("no instructions");
  if (instructions.length > MAX_INSTRUCTIONS) return fail("too many instructions");

  // Every required signer except the relayer must already have signed.
  const zero = (sig: Uint8Array) => sig.every((b) => b === 0);
  for (let i = 1; opts.requireOtherSignatures !== false && i < msg.header.numRequiredSignatures; i++) {
    if (!tx.signatures[i] || zero(tx.signatures[i])) {
      return fail(`missing signature for ${keys[i].toBase58()}`);
    }
  }

  const relayerIndex = 0;
  for (const ix of instructions) {
    const programId = keys[ix.programIdIndex];
    const usesRelayer = ix.accountKeyIndexes.includes(relayerIndex);

    if (programId.equals(seatsafeProgramId)) {
      // The relayer may appear as `payer` (rent) or `caller` (anyone-can-call payouts).
      // It holds no USDC or tickets, so it can't be made to pay in any other role.
      continue;
    }
    if (programId.equals(ComputeBudgetProgram.programId)) {
      const r = checkComputeBudget(ix.data);
      if (!r.ok) return r;
      continue;
    }
    if (programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
      // Only Create (data empty or [0]) and CreateIdempotent ([1]). The relayer may only be
      // account 0, the rent funder. RecoverNested ([2]) is refused.
      const kind = ix.data.length === 0 ? 0 : ix.data[0];
      if (kind !== 0 && kind !== 1) return fail("only ATA create is allowed");
      if (ix.accountKeyIndexes.slice(1).includes(relayerIndex)) {
        return fail("relayer may only fund ATA creation");
      }
      continue;
    }
    if (
      programId.equals(SystemProgram.programId) ||
      programId.equals(TOKEN_PROGRAM_ID) ||
      programId.equals(TOKEN_2022_PROGRAM_ID)
    ) {
      // Users may move their own SOL/tokens, but never the relayer's.
      if (usesRelayer) return fail("instruction may not touch the relayer account");
      continue;
    }
    return fail(`program not allowed: ${programId.toBase58()}`);
  }
  return { ok: true };
}

function checkComputeBudget(data: Uint8Array): PolicyResult {
  const view = Buffer.from(data);
  switch (view[0]) {
    case 2: // SetComputeUnitLimit(u32)
      return view.readUInt32LE(1) <= MAX_CU_LIMIT
        ? { ok: true }
        : { ok: false, reason: "compute unit limit too high" };
    case 3: // SetComputeUnitPrice(u64 micro-lamports)
      return view.readBigUInt64LE(1) <= MAX_CU_PRICE_MICROLAMPORTS
        ? { ok: true }
        : { ok: false, reason: "priority fee too high" };
    case 1: // RequestHeapFrame(u32)
      return { ok: true };
    default:
      return { ok: false, reason: "compute budget instruction not allowed" };
  }
}
