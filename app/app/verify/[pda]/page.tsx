// Owner: A. Public "Is this listing protected?" page for one listing / escrow / event address.
// The <Suspense> is required: `params` is request-time data under Cache Components.
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { VerifyView } from "../VerifyView";

export default function VerifyPdaPage({ params }: PageProps<"/verify/[pda]">) {
  return (
    <Suspense fallback={<VerifySkeleton />}>
      <FromParams params={params} />
    </Suspense>
  );
}

async function FromParams({ params }: { params: Promise<{ pda: string }> }) {
  const { pda } = await params;
  return <VerifyView address={decodeURIComponent(pda)} />;
}

function VerifySkeleton() {
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 py-8">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
