import assert from "node:assert/strict";
import test from "node:test";
import { canAdvance } from "./order-state.ts";

test("a new order can enter any state", () => {
  assert.equal(canAdvance(null, "HELD"), true);
  assert.equal(canAdvance(null, "SWAPPED"), true);
});

test("escrow only moves forward", () => {
  assert.equal(canAdvance("HELD", "IN_TRANSIT"), true);
  assert.equal(canAdvance("IN_TRANSIT", "HELD"), false);
  assert.equal(canAdvance("HELD", "RELEASED"), true);
  assert.equal(canAdvance("RELEASED", "REFUNDED"), false);
  assert.equal(canAdvance("REFUNDED", "RELEASED"), false);
  assert.equal(canAdvance("HELD", "HELD"), false);
});

test("a dispute is a side path and can settle", () => {
  assert.equal(canAdvance("IN_TRANSIT", "DISPUTED"), true);
  assert.equal(canAdvance("DISPUTED", "RELEASED"), true);
  assert.equal(canAdvance("DISPUTED", "REFUNDED"), true);
  assert.equal(canAdvance("DISPUTED", "IN_TRANSIT"), false);
  assert.equal(canAdvance("SWAPPED", "DISPUTED"), false);
});
