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
  // Inline rules (the program allows more; the app keeps royalties in a fair 0–20% band).
  const royaltyOut = royalty !== "" && (!Number.isFinite(r) || r < 0 || r > 20);
  const priceBad = price !== "" && !(p > 0);
  const supplyBad = supply !== "" && !(s > 0);
  const valid = title.trim() && p > 0 && s > 0 && !capTooLow && royalty !== "" && !royaltyOut;

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

      <Card variant="solid" className="mt-6 p-4 md:p-6">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="c-title" hint="e.g. Neon Harbor: Midnight Tides Tour" className="sm:col-span-2">
            <Input id="c-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
          </Field>
          <Field label="Category" htmlFor="c-category">
            <NativeSelect id="c-category" value={category} onChange={(e) => setCategory(e.target.value as Event["category"])}>
              <option value="concert">Concert</option>
              <option value="sports">Sports</option>
              <option value="campus">Campus</option>
            </NativeSelect>
          </Field>
          <Field label="Artist / organizer name" htmlFor="c-org" hint="e.g. Neon Harbor">
            <Input id="c-org" value={organizerName} onChange={(e) => setOrganizerName(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Venue" htmlFor="c-venue" hint="e.g. Riverside Amphitheater">
            <Input id="c-venue" value={venue} onChange={(e) => setVenue(e.target.value)} maxLength={120} />
          </Field>
          <Field label="City" htmlFor="c-city" hint="e.g. Austin, TX">
            <Input id="c-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={80} />
          </Field>
          <Field label="Date and time" htmlFor="c-start" hint="Leave empty for next Saturday, 8 PM." className="sm:col-span-2">
            <Input id="c-start" type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Ticket price (USD)" htmlFor="c-price" hint={priceBad ? <span className="text-disputed">Enter a price above $0.</span> : "e.g. 75"}>
            <Input id="c-price" type="number" inputMode="decimal" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} aria-invalid={priceBad || undefined} />
          </Field>
          <Field label="Tickets available" htmlFor="c-supply" hint={supplyBad ? <span className="text-disputed">At least 1 ticket.</span> : undefined}>
            <Input id="c-supply" type="number" inputMode="numeric" min="1" step="1" value={supply} onChange={(e) => setSupply(e.target.value)} aria-invalid={supplyBad || undefined} />
          </Field>
          <Field
            label="Resale cap (USD)"
            htmlFor="c-cap"
            hint={
              capTooLow ? (
                <span className="text-disputed">Must be at least the ticket price ({formatUsd(p)}).</span>
              ) : (
                p > 0 && cap === "" ? `Fans can't resell above this. Empty = ${formatUsd(c)} (150% of price).` : "Fans can't resell above this. Must be at least the ticket price."
              )
            }
          >
            <Input id="c-cap" type="number" inputMode="decimal" min="0" step="0.01" value={cap} onChange={(e) => setCap(e.target.value)} aria-invalid={capTooLow || undefined} />
          </Field>
          <Field
            label="Your royalty on resales (%)"
            htmlFor="c-royalty"
            hint={royaltyOut ? <span className="text-disputed">Royalty must be between 0% and 20%.</span> : "Paid to you on every resale. 0–20%."}
          >
            <Input id="c-royalty" type="number" inputMode="decimal" min="0" max="20" step="0.5" value={royalty} onChange={(e) => setRoyalty(e.target.value)} aria-invalid={royaltyOut || undefined} />
          </Field>
          <Button type="submit" className="h-10 sm:col-span-2" disabled={!valid || busy}>
            {busy ? <Loader2 className="animate-spin" /> : <CalendarPlus />} Create event
          </Button>
        </form>
      </Card>
    </section>
  );
}
