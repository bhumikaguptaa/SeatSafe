"use client";

// Owner: D. Loads the agent console in the browser only (ssr: false).
// Why: the console imports lib/chain -> lib/program -> @coral-xyz/anchor, and in `next dev`
// Turbopack's server render of Anchor's ESM build throws "exports is not defined" (A's /sell page
// hits the same thing). Production builds are fine. The console is fully interactive anyway, so
// skipping its server render costs nothing.

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

export const AgentConsoleClient = dynamic(() => import("./AgentConsole").then((m) => m.AgentConsole), {
  ssr: false,
  loading: () => <Skeleton className="h-72 rounded-3xl" />,
});
