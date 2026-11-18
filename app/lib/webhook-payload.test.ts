import assert from "node:assert/strict";
import test from "node:test";
import { extractTransactions } from "./webhook-payload.ts";

test("a QuickNode-style batch and a curl replay both become transactions", () => {
  const batch = extractTransactions({
    transactions: [
      { signature: "sig1", logs: ["Program data: abc"], slot: 4 },
      { signature: "sig1", logs: ["duplicate"] },
    ],
  });
  assert.equal(batch.length, 1);
  assert.equal(batch[0]?.signature, "sig1");

  const block = extractTransactions({
    data: [{
      transactions: [{
        transaction: { signatures: ["sig2"] },
        meta: { logMessages: ["Program log: ok"], err: null },
      }],
    }],
  });
  assert.equal(block[0]?.signature, "sig2");
  assert.deepEqual(block[0]?.logs, ["Program log: ok"]);
});

test("failed transactions are dropped", () => {
  const txs = extractTransactions({ signature: "bad", logs: ["x"], err: { InstructionError: [0, "Custom"] } });
  assert.equal(txs.length, 0);
});
