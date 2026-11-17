// Owner: D. Agent console: standing orders ("2 tickets under $90"), budget vault, decision log and
// voice approval. The UI lives in ./AgentConsole.tsx.
import { PageShell } from "@/components/PageShell";
import { AgentConsoleClient } from "./AgentConsoleClient";

export default function AgentPage() {
  return (
    <PageShell
      title="Agent"
      description="Set a standing order and let your AI agent buy within a capped budget."
      width="narrow"
    >
      <AgentConsoleClient />
    </PageShell>
  );
}
