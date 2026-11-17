// Normalizes the bodies QuickNode (and a curl replay) may POST to /api/stream-webhook.
// The Stream filter in docs/backend.md returns `{ transactions: [...] }`. We also accept
// a raw transaction, an array, and a block payload with `meta.logMessages`.

export interface InboundTx {
  signature: string;
  logs: string[];
  slot?: number;
  blockTime?: number;
}

function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((l) => typeof l === "string")) return null;
  return value;
}

function asTx(node: Record<string, unknown>): InboundTx | null {
  const nested = node.transaction as { signatures?: unknown } | undefined;
  const signature =
    (typeof node.signature === "string" && node.signature) ||
    (Array.isArray(nested?.signatures) && typeof nested.signatures[0] === "string" ? nested.signatures[0] : "");
  const meta = node.meta as { logMessages?: unknown; err?: unknown } | undefined;
  const logs = asStringArray(node.logs) ?? asStringArray(node.logMessages) ?? asStringArray(meta?.logMessages);
  if (!signature || !logs) return null;
  if (meta && meta.err) return null;
  if (node.err) return null;
  return {
    signature,
    logs,
    slot: typeof node.slot === "number" ? node.slot : undefined,
    blockTime: typeof node.blockTime === "number" ? node.blockTime : undefined,
  };
}

/** Pull every successful transaction that carries logs out of a webhook body. */
export function extractTransactions(body: unknown): InboundTx[] {
  const out: InboundTx[] = [];
  const seen = new Set<string>();

  const visit = (node: unknown) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object") return;
    const rec = node as Record<string, unknown>;
    const tx = asTx(rec);
    if (tx) {
      if (!seen.has(tx.signature)) {
        seen.add(tx.signature);
        out.push(tx);
      }
      return;
    }
    if (rec.transactions) visit(rec.transactions);
    if (rec.data) visit(rec.data);
    if (rec.matchedTransactions) visit(rec.matchedTransactions);
    if (rec.result) visit(rec.result);
  };

  visit(body);
  return out;
}
