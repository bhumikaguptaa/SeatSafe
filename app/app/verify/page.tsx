// Owner: A. /verify            -> paste a SeatSafe link or address
//           /verify?url=<link> -> resolves /events/<pda> or /orders/<pda> links (or a bare address) and checks it
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { addressFromInput } from "@/lib/chain";
import { VerifyForm, VerifyView } from "./VerifyView";

export default function VerifyPage({ searchParams }: PageProps<"/verify">) {
  return (
    <Suspense fallback={<Skeleton className="mx-auto mt-8 h-48 max-w-2xl rounded-xl" />}>
      <FromSearch searchParams={searchParams} />
    </Suspense>
  );
}

async function FromSearch({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const url = typeof sp.url === "string" ? sp.url : "";
  if (url) return <VerifyView address={addressFromInput(url)} />;
  return (
    <section className="mx-auto w-full max-w-2xl px-4 py-6 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight">Is this listing protected?</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Paste the link or address a seller sent you. We check it on the Solana blockchain before you pay.
      </p>
      <VerifyForm />
    </section>
  );
}
