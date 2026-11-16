// Owner: A. The user's tickets (Tier 1 onchain + Tier 2 escrowed) go here.
import Link from "next/link";
import { getEvent, MOCK_USER_ID, tickets } from "@/lib/mock";
import { Badge } from "@/components/ui/badge";
import { PagePlaceholder } from "@/components/PagePlaceholder";

export default function TicketsPage() {
  const mine = tickets.filter((t) => t.ownerId === MOCK_USER_ID);

  return (
    <PagePlaceholder
      title="My tickets"
      description="Your tickets, with a gate pass for each one."
      owner="A"
    >
      <ul className="space-y-2 text-sm">
        {mine.map((t) => (
          <li key={t.id}>
            <Link
              href={`/tickets/${t.id}/pass`}
              className="flex items-center justify-between rounded-lg border border-border p-3 hover:bg-muted"
            >
              <span>
                {getEvent(t.eventId)?.title} · Sec {t.section}, Row {t.row}, Seat {t.seat}
              </span>
              <Badge variant="outline">Tier {t.tier}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    </PagePlaceholder>
  );
}
