// Devnet check of the Solana Pay transaction request (/api/pay/swap) end to end:
// GET label/icon -> POST for a throwaway buyer -> fee payer = relayer, relayer signature valid, buyer the
// only missing signer -> buyer signs -> send -> confirmed swap. Plus the error cases.
//
//   (app running with NEXT_PUBLIC_USE_MOCK=false and RELAYER_SECRET_KEY set)
//   APP_URL=http://localhost:3000 [LISTING=<pda>] npm run check:pay
//
// The buyer is a new keypair with 0 SOL, funded with exactly the listing price in devnet USDC by the seed
// seller (.keys/seed-seller.json); the deployer pays that funding tx's fee. Never prints secret keys.

/* eslint-disable @typescript-eslint/no-explicit-any -- test script */
process.env.RPC_URL ??= "https://api.devnet.solana.com";
import "./verify-env";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import nacl from "tweetnacl";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import * as P from "../lib/program";
import { connection } from "../lib/solana";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const EVENT = new PublicKey("EMhrDn2puUvJac9PZ15CCTUftj2Axv6E7wp81oV1RzxE");
const root = path.resolve(__dirname, "../..");
const loadKey = (f: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8"))));
const seller = loadKey(path.join(root, ".keys/seed-seller.json"));
const deployer = loadKey(process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/id.json"));
const program = P.getProgram(connection);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = "") => {
  results.push([name, ok, detail]);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};

async function post(listing: string, account: string) {
  const res = await fetch(`${APP}/api/pay/swap?listing=${listing}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ account }),
  });
  return { status: res.status, cors: res.headers.get("access-control-allow-origin"), body: (await res.json()) as any };
}

async function main() {
  const relayer = new PublicKey(((await (await fetch(`${APP}/api/relay`)).json()) as any).relayer);
  console.log("App:", APP, "| relayer:", relayer.toBase58());

  // Listing: LISTING env, or the seed seller's first open listing on Battle of the Bands.
  let listingKey = process.env.LISTING ? new PublicKey(process.env.LISTING) : null;
  if (!listingKey) {
    const open = await program.account.listing.all([{ memcmp: { offset: 8, bytes: seller.publicKey.toBase58() } }]);
    const mine = open.filter((l) => l.account.event.equals(EVENT));
    if (!mine.length) throw new Error("No open seed-seller listing: run `cd program && anchor run reset-demo --provider.cluster devnet`");
    mine.sort((a, b) => Number(a.account.price.toString()) - Number(b.account.price.toString()));
    listingKey = mine[0].publicKey; // cheapest, to spend as little devnet USDC as possible
  }
  const listing = await program.account.listing.fetch(listingKey);
  const price = P.fromBaseUnits(listing.price);
  console.log("Listing:", listingKey.toBase58(), `$${price}`, "| ticket mint", listing.ticketMint.toBase58());

  // GET
  const g = await fetch(`${APP}/api/pay/swap?listing=${listingKey.toBase58()}`);
  const gb = (await g.json()) as any;
  check("GET label + icon", g.status === 200 && gb.label === "SeatSafe" && /^https?:\/\/.+\.svg$/.test(gb.icon), JSON.stringify(gb));
  check("GET CORS *", g.headers.get("access-control-allow-origin") === "*");
  const opt = await fetch(`${APP}/api/pay/swap`, { method: "OPTIONS" });
  check("OPTIONS preflight", opt.status === 204 && opt.headers.get("access-control-allow-origin") === "*");

  // Error cases
  const own = await post(listingKey.toBase58(), seller.publicKey.toBase58());
  check("POST as the seller is refused", own.status === 400 && /seller/i.test(own.body.message), own.body.message);
  const gone = await post(Keypair.generate().publicKey.toBase58(), Keypair.generate().publicKey.toBase58());
  check("POST for a missing listing is refused", gone.status === 410, gone.body.message);
  const broke = await post(listingKey.toBase58(), Keypair.generate().publicKey.toBase58());
  check("POST for a buyer without USDC gives a friendly error", broke.status === 400 && /not enough USDC/i.test(broke.body.message), broke.body.message);

  // Throwaway buyer funded with exactly the price, by whichever of seller / deployer has enough.
  // Checked BEFORE moving anything, so a short balance never strands USDC in a throwaway wallet.
  const buyer = Keypair.generate();
  const mint = (await P.getConfig(program)).usdc.mint;
  const ata = (o: PublicKey) => getAssociatedTokenAddressSync(mint, o, true, TOKEN_PROGRAM_ID);
  const bal = async (o: PublicKey) => BigInt((await connection.getTokenAccountBalance(ata(o)).catch(() => null))?.value.amount ?? "0");
  const need = BigInt(listing.price.toString());
  const funder = (await bal(seller.publicKey)) >= need ? seller : (await bal(deployer.publicKey)) >= need ? deployer : null;
  if (!funder) throw new Error(`Neither the seed seller nor the deployer has $${price} devnet USDC to fund the test buyer.`);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const fund = new Transaction({ feePayer: deployer.publicKey, blockhash, lastValidBlockHeight }).add(
    createAssociatedTokenAccountIdempotentInstruction(deployer.publicKey, ata(buyer.publicKey), buyer.publicKey, mint, TOKEN_PROGRAM_ID),
    createTransferCheckedInstruction(ata(funder.publicKey), mint, ata(buyer.publicKey), funder.publicKey, need, 6, [], TOKEN_PROGRAM_ID),
  );
  fund.sign(...(funder === deployer ? [deployer] : [deployer, funder]));
  const fundSig = await connection.sendRawTransaction(fund.serialize());
  await connection.confirmTransaction({ signature: fundSig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log("Buyer:", buyer.publicKey.toBase58(), `funded $${price} USDC by the ${funder === deployer ? "deployer" : "seed seller"} (setup tx ${fundSig})`);

  // POST for the buyer
  const r = await post(listingKey.toBase58(), buyer.publicKey.toBase58());
  check("POST returns a transaction + message", r.status === 200 && typeof r.body.transaction === "string", r.body.message ?? r.body.error);
  check("POST CORS *", r.cors === "*");
  const tx = VersionedTransaction.deserialize(Buffer.from(r.body.transaction, "base64"));
  const keys = tx.message.staticAccountKeys;
  const signers = keys.slice(0, tx.message.header.numRequiredSignatures);
  const msgBytes = tx.message.serialize();
  const empty = (s: Uint8Array) => s.every((b) => b === 0);
  check("fee payer is the relayer", keys[0].equals(relayer));
  check("relayer signature present and valid", nacl.sign.detached.verify(msgBytes, tx.signatures[0], relayer.toBytes()));
  const missing = signers.filter((_, i) => empty(tx.signatures[i]));
  check("buyer is the only missing signer", missing.length === 1 && missing[0].equals(buyer.publicKey), `signers: ${signers.map((s) => s.toBase58().slice(0, 6)).join(", ")}`);

  // Buyer signs (what the wallet does) and sends
  tx.sign([buyer]);
  const sig = await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: "confirmed" });
  const conf = await connection.confirmTransaction(
    { signature: sig, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: (await connection.getLatestBlockhash()).lastValidBlockHeight },
    "confirmed",
  );
  check("swap confirmed on devnet", !conf.value.err, `https://explorer.solana.com/tx/${sig}?cluster=devnet`);
  const held = await connection.getTokenAccountBalance(P.ticketAta(listing.ticketMint, buyer.publicKey));
  check("buyer now holds the ticket", held.value.uiAmount === 1);
  check("buyer still has 0 SOL", (await connection.getBalance(buyer.publicKey)) === 0);
  check("listing closed", !(await connection.getAccountInfo(listingKey)));
  const again = await post(listingKey.toBase58(), Keypair.generate().publicKey.toBase58());
  check("re-scan after sale says sold", again.status === 410, again.body.message);

  console.log(`\nSwap signature: ${sig}`);
  const failed = results.filter(([, ok]) => !ok).length;
  console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL PAY CHECKS PASSED");
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
