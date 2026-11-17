"use client";

// Owner: A. Artist/organizer dashboard: create an event with a resale cap and royalty.
// Price, supply, cap, royalty and start time go onchain (create_event). Title, venue, etc. are
// display data saved through /api/event-meta (Supabase when B configures it).

import Link from "next/link";
import { useState } from "react";
import { CalendarPlus, Loader2 } from "lucide-react";
import { USE_MOCK } from "@/lib/chain";
import { createEvent } from "@/lib/program";
import { GRADIENTS, saveMeta } from "@/lib/event-meta";
import { mockTx, useRunTx } from "@/lib/tx";
import { formatUsd } from "@/lib/format";
import type { Event } from "@/lib/types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/form";

/** Next Saturday 8 PM local. Computed at submit time (not render) so prerendered HTML matches. */
function nextSaturdayEvening(): Date {
  const d = new Date();
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7));
  d.setHours(20, 0, 0, 0);
  return d;
}

export default function CreatorPage() {
  const { run } = useRunTx();
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Event["category"]>("concert");
  const [organizerName, setOrganizerName] = useState("");
  const [venue, setVenue] = useState("");
  const [city, setCity] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [price, setPrice] = useState("");
  const [supply, setSupply] = useState("100");
  const [cap, setCap] = useState("");
  const [royalty, setRoyalty] = useState("5");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  const p = Number(price);
  const c = cap === "" ? Math.round(p * 1.5 * 100) / 100 : Number(cap);
  const r = Number(royalty);
  const s = Math.floor(Number(supply));
  const capTooLow = p > 0 && c < p;
  const royaltyTooHigh = r + 3 > 50;
  const valid = title.trim() && p > 0 && s > 0 && !capTooLow && r >= 0 && !royaltyTooHigh;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const opts = {
      pending: "Creating your event…",
      success: "Event created. Fans can buy tickets now.",
      errorContext: { priceUsd: p, feePct: 3 },
    };
    if (USE_MOCK) {
      if (await mockTx(opts)) setCreated("evt_neon_harbor");
    } else {
      const sent = await run(
        (ctx) =>
          createEvent(ctx, {
            priceUsd: p,
            supply: s,
            resaleCapUsd: c,
            royaltyBps: Math.round(r * 100),
            startsAt: startsAt ? new Date(startsAt) : nextSaturdayEvening(),
          }),
        opts,
      );
      if (sent?.address) {
        const id = sent.address.toBase58();
        await saveMeta({
          kind: "event",
          id,
          data: {
            title: title.trim(),
            category,
            venue: venue.trim() || "Venue TBA",
            city: city.trim(),
            imageGradient: GRADIENTS[category],
            organizerName: organizerName.trim() || "Independent organizer",
          },
        });
        setCreated(id);
      }
    }
    setBusy(false);
  };

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-6 md:py-8">
      <h1 className="text-2xl font-bold tracking-tight">Create an event</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Set your price, a resale cap and your royalty. SeatSafe enforces both on every resale.
      </p>

      {created && (
        <div className="mt-6 rounded-xl border border-released/40 bg-released/10 p-4 text-sm">
          Your event is live.{" "}
          <Link href={`/events/${created}`} className={buttonVariants({ size: "sm", variant: "outline", className: "ml-2" })}>
            Open event page
          </Link>
        </div>
      )}

      <Card className="mt-6 p-4 md:p-6">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="c-title" className="sm:col-span-2">
            <Input id="c-title" placeholder="Neon Harbor: Midnight Tides Tour" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Category" htmlFor="c-category">
            <NativeSelect id="c-category" value={category} onChange={(e) => setCategory(e.target.value as Event["category"])}>
              <option value="concert">Concert</option>
              <option value="sports">Sports</option>
              <option value="campus">Campus</option>
            </NativeSelect>
          </Field>
          <Field label="Artist / organizer name" htmlFor="c-org">
            <Input id="c-org" placeholder="Neon Harbor" value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Venue" htmlFor="c-venue">
            <Input id="c-venue" placeholder="Riverside Amphitheater" value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={120} />
          </Field>
          <Field label="City" htmlFor="c-city">
            <Input id="c-city" placeholder="Austin, TX" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Date and time" htmlFor="c-start" hint="Leave empty for next Saturday, 8 PM." className="sm:col-span-2">
            <Input id="c-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Ticket price (USD)" htmlFor="c-price">
            <Input id="c-price" type="number" inputMode="decimal" min="0" step="0.01" placeholder="75" value={price} onChange={(e) => setPrice(e.target.value)} />
          </Field>
          <Field label="Tickets available" htmlFor="c-supply">
            <Input id="c-supply" type="number" inputMode="numeric" min="1" step="1" value={supply} onChange={(e) => setSupply(e.target.value)} />
          </Field>
          <Field
            label="Resale cap (USD)"
            htmlFor="c-cap"
            hint={
              capTooLow ? (
                <span className="text-disputed">Must be at least the ticket price ({formatUsd(p)}).</span>
              ) : (
                "Fans can't resell above this. Default 150% of price."
              )
            }
          >
            <Input id="c-cap" type="number" inputMode="decimal" min="0" step="0.01" placeholder={p > 0 ? String(c) : "120"} value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={capTooLow || undefined} />
          </Field>
          <Field
            label="Your royalty on resales (%)"
            htmlFor="c-royalty"
            hint={royaltyTooHigh ? <span className="text-disputed">Royalty + 3% fee can&apos;t exceed 50%.</span> : "Paid to you on every resale."}
          >
            <Input id="c-royalty" type="number" inputMode="decimal" min="0" max="47" step="0.5" value={royalty} onChange={(e) => setRoyalty(e.target.value)} aria-invalid={royaltyTooHigh || undefined} />
          </Field>
          <Button type="submit" className="h-10 sm:col-span-2" disabled={!valid || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <CalendarPlus />} Create event
          </Button>
        </form>
      </Card>
    </section>
  );
}
