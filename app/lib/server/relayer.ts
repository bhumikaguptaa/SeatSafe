import { Keypair, Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { utils } from "@coral-xyz/anchor";
import { RPC_URL } from "@/lib/solana";

/** RELAYER_SECRET_KEY as a JSON byte array ("[12,34,...]") or a base58 string. */
export function loadRelayer(): Keypair | null {
  const raw = process.env.RELAYER_SECRET_KEY?.trim();
  if (!raw) return null;
  try {
    const bytes = raw.startsWith("[")
      ? Uint8Array.from(JSON.parse(raw) as number[])
      : utils.bytes.bs58.decode(raw);
    return Keypair.fromSecretKey(bytes);
  } catch {
    console.error("RELAYER_SECRET_KEY is set but could not be parsed");
    return null;
  }
}

const LOW_SOL = 1;

export async function relayerBalance(pubkey?: PublicKey): Promise<{ sol: number; low: boolean } | null> {
  const key = pubkey ?? loadRelayer()?.publicKey;
  if (!key) return null;
  const conn = new Connection(RPC_URL, "confirmed");
  const lamports = await conn.getBalance(key, "confirmed");
  const sol = lamports / LAMPORTS_PER_SOL;
  return { sol, low: sol < LOW_SOL };
}
