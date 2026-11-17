// Initializes the SeatSafe Config on devnet. Safe to re-run: exits if Config already exists.
//
//   cd program && anchor run init-devnet --provider.cluster devnet
//
// admin = treasury = deployer (ANCHOR_WALLET, default ~/.config/solana/id.json)
// arbiter = public key of ../.keys/arbiter.json
// usdc_mint = Circle devnet USDC, fee = 3%, dispute window = 72 h
// Prints public keys only.

import * as anchor from "@anchor-lang/core";
import { BN, Program } from "@anchor-lang/core";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import idl from "../target/idl/seatsafe.json";
import { Seatsafe } from "../target/types/seatsafe";

const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const FEE_BPS = 300;
const DISPUTE_WINDOW_SECS = 72 * 60 * 60;

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new Program<Seatsafe>(idl as Seatsafe, provider);

  const arbiterFile = path.resolve(__dirname, "../../.keys/arbiter.json");
  const arbiter = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(arbiterFile, "utf8")))
  ).publicKey;
  const deployer = provider.wallet.publicKey;
  const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

  console.log("Program ID :", program.programId.toBase58());
  console.log("Cluster    :", provider.connection.rpcEndpoint);
  console.log("Config PDA :", config.toBase58());

  if (await provider.connection.getAccountInfo(config)) {
    const c = await program.account.config.fetch(config);
    console.log("Config already initialized:");
    console.log({
      admin: c.admin.toBase58(),
      arbiter: c.arbiter.toBase58(),
      treasury: c.treasury.toBase58(),
      usdcMint: c.usdcMint.toBase58(),
      feeBps: c.feeBps,
      disputeWindowSecs: c.disputeWindowSecs.toNumber(),
    });
    return;
  }

  const sig = await program.methods
    .initConfig(arbiter, deployer, FEE_BPS, new BN(DISPUTE_WINDOW_SECS))
    .accountsPartial({ payer: deployer, admin: deployer, usdcMint: DEVNET_USDC })
    .rpc({ commitment: "confirmed" });

  console.log("init_config tx:", sig);
  console.log({
    admin: deployer.toBase58(),
    arbiter: arbiter.toBase58(),
    treasury: deployer.toBase58(),
    usdcMint: DEVNET_USDC.toBase58(),
    feeBps: FEE_BPS,
    disputeWindowSecs: DISPUTE_WINDOW_SECS,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
