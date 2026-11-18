import { GraduationCap, Music, Trophy, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/types";

// Owner: D (used on A's pages too). Event artwork in the SeatSafe palette.
// Every event gets one royal/navy shade (picked from its id, so it's stable) and its category icon,
// so events stay distinguishable without per-event rainbow colours.
// event.imageGradient (from mocks / event-meta) is intentionally ignored.

const SHADES = ["#1d3a8a", "#2f6bea", "#3f5fb8", "#16295e"] as const;

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
  event: Pick<Event, "id" | "category">;
  /** tile = small square thumbnail (icon centred); banner = wide header (large faint icon) */
  size?: "tile" | "banner";
  className?: string;
}) {
  const Icon = CATEGORY_ICON[event.category] ?? Music;
  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden", className)}
      style={{ backgroundColor: shadeFor(event.id) }}
    >
      <div className="absolute inset-0 bg-linear-to-br from-white/20 via-transparent to-transparent" />
      {size === "tile" ? (
        <Icon className="absolute inset-0 m-auto size-6 text-white/90" />
      ) : (
        <Icon className="absolute -right-4 -bottom-6 size-40 text-white/12" strokeWidth={1.25} />
      )}
    </div>
  );
}
