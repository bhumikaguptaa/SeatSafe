import Image from "next/image";
import { cn } from "@/lib/utils";
import { eventImage } from "@/lib/event-image";
import type { Event } from "@/lib/types";

// Owner: D (used on A's pages too). Event artwork: the event's image (public/events/, original abstract
// renders, lib/event-image.ts) on a dark base. Polish pass (A): replaces the flat grey + icon.

export function EventArt({
  event,
  size = "banner",
  className,
  priority = false,
}: {
  event: Pick<Event, "id" | "category"> & { imageUrl?: string };
  /** tile = small square thumbnail; banner = wide header */
  size?: "tile" | "banner";
  className?: string;
  priority?: boolean;
}) {
  return (
    <div aria-hidden className={cn("relative overflow-hidden bg-[#15151B]", className)}>
      <Image
        src={eventImage(event)}
        alt=""
        fill
        priority={priority}
        sizes={size === "tile" ? "80px" : "(min-width: 1024px) 1100px, 100vw"}
        className="object-cover"
      />
    </div>
  );
}
