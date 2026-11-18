"use client";

// Owner: A. /simulator = SeatSafe Live Lab (real devnet state, ./LiveLab.tsx). The scripted animation from
// PR #28 stays as an emergency "Offline backup" (?offline=1, ./SimulatedLab.tsx).
// useSearchParams needs a Suspense boundary (Cache Components).

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LiveLab } from "./LiveLab";
import { SimulatedLab } from "./SimulatedLab";

function Switch() {
  const offline = useSearchParams().get("offline") === "1";
  return (
    <>
      {offline ? <SimulatedLab /> : <LiveLab />}
      <p className="mx-auto max-w-7xl px-4 pb-6 text-right text-[11px] text-white/40">
        {offline ? (
          <Link href="/simulator" className="underline underline-offset-2">Back to Live Lab</Link>
        ) : (
          <Link href="/simulator?offline=1" className="underline underline-offset-2">Offline backup</Link>
        )}
      </p>
    </>
  );
}

export default function SimulatorPage() {
  return (
    <Suspense fallback={<div className="mx-auto mt-8 h-96 max-w-6xl animate-pulse rounded-3xl bg-white/5" />}>
      <Switch />
    </Suspense>
  );
}
