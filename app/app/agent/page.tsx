// Owner: D. Standing orders ("2 tickets under $90"), budget vault, chat and voice approval go here.
import { PagePlaceholder } from "@/components/PagePlaceholder";
import { OrderChat } from "@/components/OrderChat";
import { VoiceApproval } from "@/components/VoiceApproval";

export default function AgentPage() {
  return (
    <PagePlaceholder
      title="Agent"
      description="Set a standing order and let your AI agent buy within a capped budget."
      owner="D"
    >
      <div className="grid gap-4 md:grid-cols-2">
        <OrderChat />
        <VoiceApproval />
      </div>
    </PagePlaceholder>
  );
}
