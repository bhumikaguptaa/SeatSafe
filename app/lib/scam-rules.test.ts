import assert from "node:assert/strict";
import test from "node:test";
import { assessMessageRisk } from "./scam-rules.ts";

test("off-app payment, links and pressure are high", () => {
  assert.equal(assessMessageRisk("just pay me on Zelle").risk, "high");
  assert.equal(assessMessageRisk("venmo is faster").risk, "high");
  assert.match(assessMessageRisk("see https://tickets.example").reason ?? "", /link/i);
  assert.equal(assessMessageRisk("hurry, last chance or I will sell it").risk, "high");
});

test("a normal scheduling message stays low", () => {
  const verdict = assessMessageRisk("I'll transfer it tonight after work.");
  assert.equal(verdict.risk, "low");
  assert.equal(verdict.reason, undefined);
});
