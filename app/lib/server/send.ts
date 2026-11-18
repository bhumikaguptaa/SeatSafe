import { Connection } from "@solana/web3.js";
import type { BuiltTx } from "@/lib/program";
import { RPC_URL } from "@/lib/solana";
import type { Keypair } from "@solana/web3.js";

/** Sign with the relayer (fee payer and, for crank instructions, the only signer) and confirm. */
export async function sendAsRelayer(built: BuiltTx, relayer: Keypair): Promise<string> {
  built.tx.sign([relayer]);
  const conn = new Connection(RPC_URL, "confirmed");
  const signature = await conn.sendRawTransaction(built.tx.serialize(), {
    preflightCommitment: "confirmed",
  });
  const res = await conn.confirmTransaction(
    {
      signature,
      blockhash: built.tx.message.recentBlockhash,
      lastValidBlockHeight: built.lastValidBlockHeight,
    },
    "confirmed",
  );
  if (res.value.err) {
    throw new Error(`Transaction failed: ${JSON.stringify(res.value.err)}`);
  }
  return signature;
}
