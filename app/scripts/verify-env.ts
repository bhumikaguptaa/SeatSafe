// Imported first by verify-builders.ts: app/lib/solana.ts reads these at import time.
process.env.NEXT_PUBLIC_SOLANA_RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8999";
process.env.NEXT_PUBLIC_PROGRAM_ID = "7fnVUPd18tDr2CbEgjTxt55Emq4CMMskR9qxprjQjypy";
process.env.NEXT_PUBLIC_USE_MOCK = "false";

// lib/ has both event-meta.ts and event-meta.json. Next's bundler resolves "./event-meta" to the .ts
// file; plain Node tries .json first. Make Node (ts-node) prefer .ts like the bundler does.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ext = (require("module") as { _extensions: Record<string, unknown> })._extensions;
const ts = ext[".ts"];
if (ts) {
  const json = ext[".json"];
  delete ext[".json"];
  ext[".json"] = json;
}
export {};
