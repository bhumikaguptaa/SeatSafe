import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import { assert } from "chai";
import { Seatsafe } from "../target/types/seatsafe";

describe("seatsafe", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.seatsafe as Program<Seatsafe>;

  it("initialize logs 'SeatSafe skeleton ready' and emits SkeletonPing", async () => {
    const [counter] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("counter")],
      program.programId
    );

    const sig = await program.methods
      .initialize()
      .accountsPartial({ counter })
      .rpc({ commitment: "confirmed" });
    console.log("Initialize transaction signature", sig);

    const tx = await provider.connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const logs = tx?.meta?.logMessages ?? [];
    assert.isTrue(
      logs.some((l) => l.includes("SeatSafe skeleton ready")),
      "missing skeleton log"
    );

    const parser = new anchor.EventParser(program.programId, program.coder);
    const events = [...parser.parseLogs(logs)];
    const ping = events.find((e) => e.name.toLowerCase() === "skeletonping");
    assert.exists(ping, "SkeletonPing event not emitted");
    assert.isAbove(Number(ping!.data.at), 0, "SkeletonPing.at should be a unix timestamp");
  });
});
