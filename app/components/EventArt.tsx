import Image from "next/image";
import { GraduationCap, Music, Trophy, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/types";

// Owner: D (used on A's pages too). Event artwork in the orange theme: flat.
// Every event gets one solid dark-grey shade (picked from its id, so it's stable) and its orange category icon,
// so events stay distinguishable without per-event rainbow colours.
// event.imageGradient (from mocks / event-meta) is intentionally ignored.
// When the event has an imageUrl (a photo under /public/events), that photo is shown instead.

const SHADES = ["#242424", "#2b2b2b", "#1f1f1f", "#303030"] as const;

const CATEGORY_ICON: Record<Event["category"], LucideIcon> = {
  concert: Music,
  sports: Trophy,
  campus: GraduationCap,
};

function shadeFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return SHADES[h % SHADES.length];
}

export function EventArt({
  event,
  size = "banner",
  className,
}: {
  event: Pick<Event, "id" | "category" | "imageUrl">;
  /** tile = small square thumbnail (icon centred); banner = wide header (large faint icon) */
  size?: "tile" | "banner";
  className?: string;
}) {
  if (event.imageUrl) {
    return (
      <div aria-hidden className={cn("relative overflow-hidden bg-[#242424]", className)}>
        <Image
          src={event.imageUrl}
          alt=""
          fill
          sizes={size === "tile" ? "80px" : "(min-width: 1024px) 1024px, 100vw"}
          className="object-cover"
        />
      </div>
    );
  }
  const Icon = CATEGORY_ICON[event.category] ?? Music;
  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden", className)}
      style={{ backgroundColor: shadeFor(event.id) }}
    >
      {size === "tile" ? (
        <Icon className="absolute inset-0 m-auto size-6 text-primary" />
      ) : (
        <Icon className="absolute -right-4 -bottom-6 size-40 text-primary/25" strokeWidth={1.25} />
      )}
    </div>
  );
}
