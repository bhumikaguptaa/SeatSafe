// Small footer on every page: "Built on Solana devnet · Program 7fnV…jypy ↗ · GitHub ↗".
// Server component; the program id comes from NEXT_PUBLIC_PROGRAM_ID (falls back to the IDL address).

import idl from "@/lib/idl/seatsafe.json";
import { shortAddress } from "@/lib/format";

const PROGRAM_ID = process.env.NEXT_PUBLIC_PROGRAM_ID || (idl as { address: string }).address;
const GITHUB = "https://github.com/bhumikaguptaa/SeatSafe";

export function SiteFooter() {
  return (
    <footer className="border-t border-[#26262E] bg-[#0B0B0F] pb-20 md:pb-0">
      <p className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-5 py-4 text-xs text-[#A1A1AA]">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-released" aria-hidden /> Built on Solana devnet
        </span>
        <span aria-hidden>·</span>
        <a
          href={`https://explorer.solana.com/address/${PROGRAM_ID}?cluster=devnet`}
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-white"
          title={PROGRAM_ID}
        >
          Program <span className="font-mono">{shortAddress(PROGRAM_ID)}</span> ↗
        </a>
        <span aria-hidden>·</span>
        <a href={GITHUB} target="_blank" rel="noopener noreferrer" className="hover:text-white">
          GitHub ↗
        </a>
      </p>
    </footer>
  );
}
