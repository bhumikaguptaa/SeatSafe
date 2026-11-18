import { GraduationCap, Music, Trophy, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Event } from "@/lib/types";

// Owner: D (used on A's pages too). Event artwork in the SeatSafe palette.
// Every event gets one flat shade of the branding palette (picked from its id, so it's stable) and
// its category icon, so events stay distinguishable without per-event rainbow colours.
// event.imageGradient (from mocks / event-meta) is intentionally ignored.
// `featured` is the one place event art uses the branding gradient (Discover's featured card).

const SHADES = ["#003d58", "#004a6b", "#00638e", "#2f7c9e"] as const;

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
  featured = false,
  className,
}: {
  event: Pick<Event, "id" | "category">;
  /** tile = small square thumbnail (icon centred); banner = wide header (large faint icon) */
  size?: "tile" | "banner";
  featured?: boolean;
  className?: string;
}) {
  const Icon = CATEGORY_ICON[event.category] ?? Music;
  return (
    <div
      aria-hidden
      className={cn("relative overflow-hidden", className)}
      style={featured ? { backgroundImage: "var(--brand-gradient)" } : { backgroundColor: shadeFor(event.id) }}
    >
      {size === "tile" ? (
        <Icon className="absolute inset-0 m-auto size-6 text-white/90" />
      ) : (
        <Icon className="absolute -right-4 -bottom-6 size-40 text-white/10" strokeWidth={1.25} />
      )}
    </div>
  );
}
