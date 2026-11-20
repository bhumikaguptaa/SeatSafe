// One command before recording: fresh devnet demo data + a checklist of URLs to open.
//
//   cd program && npm run demo:prep          (= anchor run demo-prep --provider.cluster devnet)
//   APP_URL=http://localhost:3000 npm run demo:prep   (report the over-cap attempt to a local app instead)
//
// 1. Checks the seed seller's devnet USDC. Below $200 it says so and links the faucet: there is no top-up
//    script in this repo (devnet USDC only comes from faucet.circle.com), so nothing is moved automatically.
// 2. Runs reset-demo.ts (fresh $10 ticket on a stadium seat, a rejected $50 above-cap attempt reported to the
//    Discover ticker so "scalpers blocked" >= 1, a fair resale listing, a $20 outside-ticket escrow, bond 0).
// 3. Prints the URLs to open for recording.
// Never prints secret keys.

import * as anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAccount, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const APP_URL = process.env.APP_URL ?? "https://seat-safe-chi.vercel.app";
const EVENT = "EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE";
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const TARGET = 200;

async function main() {
  const env = anchor.AnchorProvider.env();
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? env.connection.rpcEndpoint;
  const conn = new Connection(rpcUrl, "confirmed");
  const seller = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../.keys/seed-seller.json"), "utf8"))));
  const ata = getAssociatedTokenAddressSync(USDC_MINT, seller.publicKey, true, TOKEN_PROGRAM_ID);
  const have = Number((await getAccount(conn, ata, "confirmed").catch(() => ({ amount: BigInt(0) }))).amount) / 1e6;

  console.log(`\n== 1. Seed seller balance: $${have} devnet USDC (${seller.publicKey.toBase58()})`);
  if (have < TARGET) {
    console.log(`   Below $${TARGET}. No top-up script exists (devnet USDC only comes from the faucet), so skipping.`);
    console.log(`   Top up at https://faucet.circle.com (Solana devnet) -> ${seller.publicKey.toBase58()}`);
  }

  console.log("\n== 2. reset-demo (fresh listings + above-cap attempt)");
  const r = spawnSync("npx", ["ts-node", "-P", "./tsconfig.json", "scripts/reset-demo.ts"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, APP_URL },
  });
  if (r.status !== 0) {
    console.log("   reset-demo failed (see above). The checklist below still works with the existing data.");
  }

  console.log("\n== 3. Open for recording");
  const urls: [string, string][] = [
    ["Discover (ticker, featured event)", `${APP_URL}/`],
    ["Event + seat map", `${APP_URL}/events/${EVENT}`],
    ["Live Lab, auto-prepared", `${APP_URL}/simulator?demo=1`],
    ["Verify (protected resale)", `${APP_URL}/verify`],
    ["My tickets", `${APP_URL}/tickets`],
    ["First-visit intro", `${APP_URL}/?intro=1`],
  ];
  for (const [what, url] of urls) console.log(`   [ ] ${what.padEnd(36)} ${url}`);
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
